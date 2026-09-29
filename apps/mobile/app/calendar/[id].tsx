/**
 * Planting calendar (§7.3) for everything planned or planted on a property this year: the next six
 * weeks of tasks, the whole season month by month, and frost/heat/wind alerts from the NWS forecast
 * for crops already in the ground.
 */
import { formatDoy, plantById, upcomingTasks, type PlantCalendar } from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useEntitlements } from '../../src/billing/entitlements';
import { Chip } from '../../src/components/plants';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { alertsEnabled, alertsForParcel, type ParcelAlerts } from '../../src/services/alerts';
import { activePlantings, bedName, calendarFor } from '../../src/services/garden';
import { useGarden } from '../../src/services/useGarden';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (doy: number) => new Date(Date.UTC(2023, 0, doy)).getUTCMonth();
const todayDoy = () => {
  const n = new Date();
  return Math.floor((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(n.getFullYear(), 0, 0)) / 86_400_000);
};

export default function CalendarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const ent = useEntitlements((s) => s.entitlements);
  const { state, error } = useGarden(id);
  const [risk, setRisk] = useState<'cautious' | 'typical'>('cautious');
  const [dynamic, setDynamic] = useState(false);
  const [alerts, setAlerts] = useState<ParcelAlerts | null>(null);
  const [notifyOn, setNotifyOn] = useState<boolean | null>(null);
  const year = new Date().getFullYear();

  const active = useMemo(() => (state ? activePlantings(state.plantings, year) : []), [state, year]);
  const cals = useMemo(() => {
    if (!state) return [] as Array<PlantCalendar & { beds: string[] }>;
    const byPlant = new Map<string, string[]>();
    for (const p of active) {
      const i = state.design.objects.findIndex((o) => o.id === p.bedObjectId);
      const name = i >= 0 ? bedName(state.design.objects[i]!, i) : 'removed bed';
      byPlant.set(p.plantId, [...(byPlant.get(p.plantId) ?? []), name]);
    }
    const out: Array<PlantCalendar & { beds: string[] }> = [];
    for (const [plantId, beds] of byPlant) {
      const plant = plantById(plantId);
      const cal = plant && calendarFor(plant, state.site, { risk, dynamicGdd: dynamic && ent.has('planting.dynamicScheduling') });
      if (cal) out.push({ ...cal, beds });
    }
    return out;
  }, [state, active, risk, dynamic, ent]);

  useEffect(() => {
    if (!state?.profile) return;
    void alertsEnabled().then(setNotifyOn);
    const c = state.profile.centroid;
    alertsForParcel(state.parcel.id, state.parcel.name, c.lat, c.lon).then(setAlerts).catch(() => setAlerts(null));
  }, [state]);

  if (error) return <Body>{error}</Body>;
  if (!state) return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading calendar" />;

  const today = todayDoy();
  const soon = upcomingTasks(cals, today, Math.min(365, today + 42));
  const byMonth = new Map<number, Array<{ plantId: string; label: string; start: number; end: number }>>();
  for (const c of cals) for (const e of c.events) {
    const m = monthOf(e.start);
    byMonth.set(m, [...(byMonth.get(m) ?? []), { plantId: c.plantId, label: e.label, start: e.start, end: e.end }]);
  }
  const frost = state.site.frost;
  const climate = state.profile?.climate;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card title="Weather alerts">
        {!state.profile ? <Body muted>Build the site profile first.</Body>
          : !alerts ? <ActivityIndicator accessibilityLabel="Checking the forecast" />
            : alerts.alerts.length ? alerts.alerts.map((a, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={{ color: a.kind === 'heat' || a.kind === 'wind' ? t.warn : t.bad, fontWeight: '700' }}>{a.title}</Text>
                <Body>{a.body}</Body>
              </View>
            )) : (
              <Body muted>{active.some((p) => p.status === 'planted') ? 'No frost, heat or wind trouble in the 7-day forecast for what’s planted.' : 'Mark crops as planted in the bed planner to get alerts for them.'}</Body>
            )}
        {alerts?.forecastNote && <Text style={{ color: t.muted, fontSize: 12 }}>{alerts.forecastNote}</Text>}
        <Text style={{ color: t.muted, fontSize: 12 }}>Forecast: National Weather Service (public domain).</Text>
        {notifyOn === false && <Button title="Turn on alert notifications" kind="secondary" onPress={() => router.push('/settings')} />}
      </Card>

      <Card title="Timing">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="Cautious" active={risk === 'cautious'} onPress={() => setRisk('cautious')} />
          <Chip label="Typical" active={risk === 'typical'} onPress={() => setRisk('typical')} />
          <Chip label={ent.has('planting.dynamicScheduling') ? 'Heat-unit harvest dates' : 'Heat-unit dates (Pro)'} active={dynamic} disabled={!ent.has('planting.dynamicScheduling')} onPress={() => setDynamic((d) => !d)} />
        </View>
        <Body muted>
          Cautious waits for the 1-in-10-years late frost before setting out frost-tender crops; typical uses the median.
          {frost?.lastSpring[32][50] != null && ` Median last frost ${formatDoy(frost.lastSpring[32][50]!)}`}
          {frost?.firstFall[32][50] != null && `, first frost ${formatDoy(frost.firstFall[32][50]!)}.`}
        </Body>
        {climate?.status === 'ok' && <Text style={{ color: t.muted, fontSize: 12 }}>{climate.attribution.source}, adjusted to the parcel’s elevation.</Text>}
      </Card>

      {cals.length === 0 ? (
        <Card title="Nothing planned yet">
          <Body>Add crops to your beds in the bed planner (open Design, tap a bed, then “Plan this bed”).</Body>
          <Button title="Open design" onPress={() => router.push({ pathname: '/design/[id]', params: { id: state.parcel.id } })} />
        </Card>
      ) : (
        <>
          <Card title="Next 6 weeks">
            {soon.length ? soon.map((e, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{plantById(e.plantId)?.commonName}: {e.label}</Text>
                <Body muted>{formatDoy(e.start)}{e.end !== e.start ? ` – ${formatDoy(e.end)}` : ''} · {e.basis}</Body>
              </View>
            )) : <Body muted>No tasks in the next six weeks.</Body>}
          </Card>

          <Card title={`Season ${year}`}>
            {[...byMonth.keys()].sort((a, b) => a - b).map((m) => (
              <View key={m} style={{ marginBottom: 10 }}>
                <Text style={{ color: t.accent, fontWeight: '700' }} accessibilityRole="header">{MONTHS[m]}</Text>
                {byMonth.get(m)!.sort((a, b) => a.start - b.start).map((e, i) => (
                  <Body key={i}>{formatDoy(e.start)}{e.end !== e.start ? `–${formatDoy(e.end)}` : ''} · {plantById(e.plantId)?.commonName}: {e.label}</Body>
                ))}
              </View>
            ))}
          </Card>

          <Card title="Where it’s planted">
            {cals.map((c) => (
              <Body key={c.plantId}>{plantById(c.plantId)?.commonName}: {c.beds.join(', ')}{c.fits ? '' : ' (may not mature before frost)'}</Body>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
