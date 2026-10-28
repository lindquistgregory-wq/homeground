/**
 * "Turn on free alerts", shown where it matters (Home, the calendar, animal housing) when a property
 * has animals on the land or crops in the ground and weather alerts are off. Safety alerts are free on
 * every plan; this puts the switch at the point of use instead of only in Settings. "Not now" hides it
 * for 30 days.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { kvGet, kvSet } from '../db/database';
import { activeHerds } from '../services/animals';
import { alertsEnabled, plantedCrops, setAlertsEnabled } from '../services/alerts';
import { Body, Button, Card } from './ui';

const SNOOZE_KEY = 'alerts.nudgeSnoozedUntil';

export function AlertsNudge({ parcelId, onEnabled }: { parcelId: string; onEnabled?: () => void }) {
  const [show, setShow] = useState(false);
  const [what, setWhat] = useState<'animals' | 'crops' | 'both'>('both');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      if (await alertsEnabled()) return !cancelled && setShow(false);
      const until = Number((await kvGet(SNOOZE_KEY)) ?? 0);
      if (until > Date.now()) return !cancelled && setShow(false);
      const [herds, crops] = await Promise.all([activeHerds(parcelId).catch(() => []), plantedCrops(parcelId).catch(() => [])]);
      if (cancelled) return;
      setWhat(herds.length && crops.length ? 'both' : herds.length ? 'animals' : 'crops');
      setShow(herds.length > 0 || crops.length > 0);
    })();
    return () => { cancelled = true; };
  }, [parcelId]));

  if (!show) return null;
  const body = what === 'animals'
    ? 'Get a notification when heat, hard cold or freezing water could put your animals at risk. Free on every plan.'
    : what === 'crops'
      ? 'Get a notification before frost, a freeze or a heat wave hits what you’ve planted. Free on every plan.'
      : 'Get a notification before frost, heat, hard cold or freezing water could harm your animals or crops. Free on every plan.';
  return (
    <Card title="Turn on free alerts" icon="bell-outline">
      <Body>{body}</Body>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title={busy ? 'Turning on…' : 'Turn on alerts'} disabled={busy} onPress={async () => {
            setBusy(true);
            try {
              const r = await setAlertsEnabled(true);
              if (r.denied) Alert.alert('Notifications are off', 'Allow notifications for Plotwright in your phone’s settings, then try again.');
              else { setShow(false); onEnabled?.(); }
            } finally { setBusy(false); }
          }} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Not now" kind="secondary" onPress={async () => { await kvSet(SNOOZE_KEY, String(Date.now() + 30 * 86_400_000)); setShow(false); }} />
        </View>
      </View>
    </Card>
  );
}
