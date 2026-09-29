/**
 * Sensors on a property (§8): Bluetooth sensors, weather stations (cloud with your keys, or on your
 * Wi-Fi) and CSV imports, each with its latest readings and how fresh they are.
 */
import { METRIC_LABEL, freshness, type Metric } from '@plotwright/core';
import { EXPOSURE_LABEL, formatMetric } from '../../src/components/sensorFormat';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEntitlements } from '../../src/billing/entitlements';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { listParcels } from '../../src/db/parcels';
import { latestValues, listSensors, type SensorRecord } from '../../src/db/sensors';
import { collectOnOpen } from '../../src/services/ble';
import { localOffsetMin } from '../../src/services/sensorInsights';
import { useSettings } from '../../src/services/settings';
import { STATION_LABEL, refreshAllStations, type StationProtocol } from '../../src/services/stations';

const SHOWN: Metric[] = ['temperature', 'humidity', 'soilMoisture', 'soilTemperature', 'soilTension', 'illuminance', 'solarRadiation', 'rainDaily', 'windSpeed', 'co2', 'battery'];
const EXPECTED_MS: Record<string, number> = { ble: 6 * 3_600_000, cloud: 15 * 60_000, local: 5 * 60_000, csv: 7 * 86_400_000 };

type Row = { s: SensorRecord; latest: Awaited<ReturnType<typeof latestValues>> };

export default function Sensors() {
  const params = useLocalSearchParams<{ parcelId?: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const ent = useEntitlements((s) => s.entitlements);
  const [parcelId, setParcelId] = useState<string | undefined>(params.parcelId);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const pid = params.parcelId ?? (await listParcels())[0]?.id;
    setParcelId(pid);
    if (!pid) return setRows([]);
    const sensors = await listSensors(pid);
    setRows(await Promise.all(sensors.map(async (s) => ({ s, latest: await latestValues(s.id) }))));
  }, [params.parcelId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!rows) return <Body>Loading…</Body>;
  if (!parcelId) return <Body>Add a property first.</Body>;

  const topBle = rows.filter((r) => r.s.kind === 'ble' && !r.s.parentId).length;
  const stations = rows.filter((r) => (r.s.kind === 'cloud' || r.s.kind === 'local') && !r.s.parentId).length;
  const bleFull = topBle >= ent.limits.bleSensors;
  const stationFull = stations >= ent.limits.stationAccounts;

  const collect = async () => {
    setBusy('Listening for Bluetooth sensors and refreshing stations…');
    try {
      await Promise.all([collectOnOpen(localOffsetMin()), refreshAllStations(localOffsetMin(), true)]);
    } finally {
      setBusy(null);
      await load();
    }
  };

  const groups: Array<{ title: string; items: Row[] }> = [];
  const parents = rows.filter((r) => !r.s.parentId);
  for (const p of parents) {
    const kids = rows.filter((r) => r.s.parentId === p.s.id);
    groups.push({ title: p.s.kind === 'cloud' || p.s.kind === 'local' ? `${p.s.name} · ${STATION_LABEL[p.s.protocol as StationProtocol] ?? p.s.protocol}` : '', items: p.s.kind === 'cloud' || p.s.kind === 'local' ? kids : [p, ...kids] });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Body muted>Readings stay on your phone (daily summaries sync to your own iCloud). Station keys are kept in the phone’s keychain.</Body>
      {rows.length === 0 && (
        <Card title="No sensors yet">
          <Body>Cheap Bluetooth thermometers (Govee, SwitchBot, Xiaomi, Inkbird, RuuviTag, BTHome), plant sensors (Xiaomi Flower Care), and home weather stations (Ecowitt, Ambient, Davis, Tempest) all work. Readings sharpen planting dates, watering and frost alerts.</Body>
        </Card>
      )}
      {groups.filter((g) => g.items.length || g.title).map((g, gi) => (
        <View key={gi}>
          {g.title ? <Text style={[styles.group, { color: t.muted }]} accessibilityRole="header">{g.title}</Text> : null}
          {g.items.map(({ s, latest }) => {
            const fr = freshness(s.lastSeen, Date.now(), EXPECTED_MS[s.kind] ?? 3_600_000);
            const vals = SHOWN.filter((m) => latest[m]).slice(0, 4);
            return (
              <Pressable key={s.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/sensors/[id]', params: { id: s.id } })}
                style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '600', fontSize: 16 }}>{s.name}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>{[s.model ?? s.vendor, EXPOSURE_LABEL[s.exposure], s.location ? 'pinned' : 'not pinned on the map'].filter(Boolean).join(' · ')}</Text>
                  <Text style={{ color: t.text }}>{vals.length ? vals.map((m) => `${METRIC_LABEL[m]} ${formatMetric(m, latest[m]!.value, units)}`).join(' · ') : 'No readings yet'}</Text>
                </View>
                <Text style={{ color: fr === 'fresh' ? t.accent : fr === 'late' ? t.warn : t.bad, fontSize: 12 }} accessibilityLabel={`Readings ${fr}`}>
                  {fr === 'never' ? 'waiting' : fr}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      {busy && <Body muted>{busy}</Body>}
      <Button title="Collect readings now" onPress={collect} disabled={!!busy || rows.length === 0} />
      <Button
        title="Add a Bluetooth sensor"
        kind="secondary"
        onPress={() => (bleFull ? Alert.alert('Sensor limit', `Your plan includes ${ent.limits.bleSensors} Bluetooth sensor${ent.limits.bleSensors === 1 ? '' : 's'}. Upgrade for more.`) : router.push({ pathname: '/sensors/scan', params: { parcelId } }))}
      />
      <Button
        title="Connect a weather station"
        kind="secondary"
        onPress={() => (stationFull ? Alert.alert('Station limit', ent.limits.stationAccounts ? `Your plan includes ${ent.limits.stationAccounts} station.` : 'Weather stations are part of Grower and Homestead Pro.') : router.push({ pathname: '/sensors/station', params: { parcelId } }))}
      />
      <Button title="Import readings from a CSV file" kind="secondary" onPress={() => router.push({ pathname: '/sensors/import', params: { parcelId } })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  group: { fontWeight: '700', marginTop: 8, marginBottom: 6 },
});
