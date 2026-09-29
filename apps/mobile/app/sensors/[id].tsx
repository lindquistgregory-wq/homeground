/**
 * One sensor: latest readings with dew point and VPD, a chart, where it is on the parcel (pin it on
 * the map, assign it to a bed), what it stands for (exposure), alert thresholds, its key, and — for
 * light sensors — how it compares with the shade model.
 */
import {
  METRIC_LABEL, dewPointC, formatTemp, freshness, leafWetHours, vpdKpa, type Exposure, type Metric, type Thresholds,
} from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEntitlements } from '../../src/billing/entitlements';
import { ParcelMap } from '../../src/components/ParcelMap';
import { Chip } from '../../src/components/plants';
import { SensorChart, type ChartPoint } from '../../src/components/SensorChart';
import { EXPOSURE_LABEL, formatMetric } from '../../src/components/sensorFormat';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { getOrCreateDesign } from '../../src/db/designs';
import { getParcel, type ParcelRecord } from '../../src/db/parcels';
import { deleteSensor, getSensor, latestValues, listSensors, readingsBetween, saveSensor, sensorDays, type SensorRecord } from '../../src/db/sensors';
import { bedName, isPlantable } from '../../src/services/garden';
import { deleteSecrets, getSecret, setSecret } from '../../src/services/secrets';
import { localOffsetMin } from '../../src/services/sensorInsights';
import { useSettings } from '../../src/services/settings';
import { calibrateLightSensor, getCalibration, type StoredCalibration } from '../../src/services/sunCalibration';
import { listenTempest, refreshStation } from '../../src/services/stations';
import type { DesignObject } from '@plotwright/core';

const EXPOSURES: Exposure[] = ['open-air', 'shaded-air', 'greenhouse', 'soil', 'indoor'];
const RANGES = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
const EXPECTED_MS: Record<string, number> = { ble: 6 * 3_600_000, cloud: 15 * 60_000, local: 5 * 60_000, csv: 7 * 86_400_000 };

export default function SensorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const imperial = units === 'imperial';
  const ent = useEntitlements((s) => s.entitlements);
  const [s, setS] = useState<SensorRecord | null>(null);
  const [parcel, setParcel] = useState<ParcelRecord | null>(null);
  const [beds, setBeds] = useState<DesignObject[]>([]);
  const [others, setOthers] = useState<SensorRecord[]>([]);
  const [latest, setLatest] = useState<Awaited<ReturnType<typeof latestValues>>>({});
  const [metric, setMetric] = useState<Metric | null>(null);
  const [range, setRange] = useState<keyof typeof RANGES>('24h');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [wetHours, setWetHours] = useState<number | null>(null);
  const [pinning, setPinning] = useState(false);
  const [cal, setCal] = useState<StoredCalibration | null>(null);
  const [calBusy, setCalBusy] = useState(false);

  const load = useCallback(async () => {
    const x = await getSensor(id);
    if (!x) return;
    setS(x);
    const p = await getParcel(x.parcelId);
    setParcel(p ?? null);
    if (p) setBeds((await getOrCreateDesign(p.id)).objects.filter(isPlantable));
    setOthers((await listSensors(x.parcelId)).filter((o) => o.id !== x.id && o.location));
    const l = await latestValues(x.id);
    setLatest(l);
    setMetric((m) => m ?? ((['temperature', 'soilMoisture', 'soilTemperature', 'illuminance', 'humidity'] as Metric[]).find((k) => l[k]) ?? (Object.keys(l)[0] as Metric | undefined) ?? null));
    setCal(await getCalibration(x.id));
    const rh = await readingsBetween(x.id, Date.now() - 86_400_000, Date.now(), 'humidity');
    setWetHours(rh.length >= 6 ? leafWetHours(rh.map((r) => [r.t, r.value])) : null);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Live Tempest broadcasts while this screen is open.
  useEffect(() => {
    if (s?.protocol !== 'tempest-udp' || s.parentId) return;
    let stop: (() => void) | undefined;
    void listenTempest(s, localOffsetMin(), () => undefined).then((f) => (stop = f)).catch(() => undefined);
    return () => stop?.();
  }, [s]);

  useEffect(() => {
    if (!s || !metric) return;
    void (async () => {
      if (range === '30d') {
        const since = new Date(Date.now() - RANGES['30d']).toISOString().slice(0, 10);
        setPoints((await sensorDays(s.id, since)).filter((d) => d.metrics[metric]).map((d) => {
          const m = d.metrics[metric]!;
          return { t: Date.parse(`${d.date}T12:00:00Z`), v: m.mean, lo: m.min, hi: m.max };
        }));
      } else {
        const rs = await readingsBetween(s.id, Date.now() - RANGES[range], Date.now(), metric);
        const step = Math.max(1, Math.ceil(rs.length / 300));
        setPoints(rs.filter((r, i) => r.quality !== 'suspect' && i % step === 0).map((r) => ({ t: r.t, v: r.value })));
      }
    })();
  }, [s, metric, range]);

  const metrics = useMemo(() => Object.keys(latest) as Metric[], [latest]);
  if (!s || !parcel) return <Body>Loading…</Body>;

  const save = async (patch: Partial<SensorRecord>) => {
    const next = await saveSensor({ ...s, ...patch });
    setS(next);
  };
  const fr = freshness(s.lastSeen, Date.now(), EXPECTED_MS[s.kind] ?? 3_600_000);
  const temp = latest.temperature?.value, rh = latest.humidity?.value;
  const isStation = (s.kind === 'cloud' || s.kind === 'local') && !s.parentId;
  const hasLight = !!latest.illuminance;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }} accessibilityRole="header">{s.name}</Text>
      <Body muted>{[s.vendor, s.model, EXPOSURE_LABEL[s.exposure], `readings ${fr === 'never' ? 'not yet received' : fr}`].filter(Boolean).join(' · ')}</Body>

      <Card title="Now">
        {metrics.length === 0 && <Body muted>No readings yet. {s.kind === 'ble' ? 'Open the app near the sensor.' : 'Tap Refresh.'}</Body>}
        {metrics.map((m) => (
          <Body key={m}>{METRIC_LABEL[m]}: {formatMetric(m, latest[m]!.value, units)} <Text style={{ color: t.muted }}>({new Date(latest[m]!.t).toLocaleString()})</Text></Body>
        ))}
        {temp !== undefined && rh !== undefined && (
          <Body>
            Dew point {formatTemp(dewPointC(temp, rh), units)} · VPD {vpdKpa(temp, rh).toFixed(2)} kPa{vpdKpa(temp, rh) < 0.4 ? ' (very humid: fungal disease weather)' : vpdKpa(temp, rh) > 1.6 ? ' (dry air: plants lose water fast)' : ''}
          </Body>
        )}
        {wetHours !== null && <Body muted>Leaf-wet hours in the last 24 h (RH ≥ 90 %): {wetHours.toFixed(1)}{wetHours >= 10 ? '. Long wet spells favour blight and mildew.' : ''}</Body>}
        {s.kind !== 'ble' && s.kind !== 'csv' && (
          <Button title="Refresh" kind="secondary" onPress={async () => {
            const st = s.parentId ? await getSensor(s.parentId) : s;
            if (st) { const r = await refreshStation(st, localOffsetMin()); if (r && r.status !== 'ok') Alert.alert('Refresh', r.reason); }
            await load();
          }} />
        )}
      </Card>

      {metric && (
        <Card title="History">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {metrics.filter((m) => m !== 'battery' && m !== 'voltage').map((m) => <Chip key={m} label={METRIC_LABEL[m]} active={metric === m} onPress={() => setMetric(m)} />)}
          </View>
          <View style={{ flexDirection: 'row' }}>
            {(Object.keys(RANGES) as Array<keyof typeof RANGES>).map((r) => <Chip key={r} label={r} active={range === r} onPress={() => setRange(r)} />)}
          </View>
          <SensorChart points={points} format={(v) => formatMetric(metric, v, units)} label={METRIC_LABEL[metric]} />
          {range === '30d' && <Body muted>Daily mean with the day’s range shaded.</Body>}
        </Card>
      )}

      {!isStation && (
        <Card title="Where it is">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {EXPOSURES.map((e) => <Chip key={e} label={EXPOSURE_LABEL[e]} active={s.exposure === e} onPress={() => void save({ exposure: e })} />)}
          </View>
          <Body muted>
            {s.exposure === 'soil' ? 'Soil readings set sowing dates for this property.' : s.exposure === 'open-air' ? 'Open-air readings feed watering suggestions, measured heat units and frost alerts for this spot.' : s.exposure === 'greenhouse' ? 'Set temperature limits below to get greenhouse alerts.' : 'Shown for reference; not used for planting decisions.'}
          </Body>
          <View style={styles.map}>
            <ParcelMap
              boundary={parcel.geometry}
              markers={[...others.map((o) => ({ id: o.id, lon: o.location!.lon, lat: o.location!.lat, label: o.name })), ...(s.location ? [{ id: s.id, lon: s.location.lon, lat: s.location.lat, label: s.name, highlight: true }] : [])]}
              onPress={pinning ? (lon, lat) => { setPinning(false); void save({ location: { lon, lat } }); } : undefined}
            />
          </View>
          <Button title={pinning ? 'Tap the map where the sensor is…' : s.location ? 'Move the pin' : 'Pin it on the map'} kind="secondary" onPress={() => setPinning((p) => !p)} />
          {beds.length > 0 && (
            <View>
              <Text style={{ color: t.text, fontWeight: '600', marginTop: 6 }}>In a bed?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Chip label="None" active={!s.bedObjectId} onPress={() => void save({ bedObjectId: undefined })} />
                {beds.map((b, i) => <Chip key={b.id} label={bedName(b, i)} active={s.bedObjectId === b.id} onPress={() => void save({ bedObjectId: b.id, location: s.location ?? { lon: b.center[0], lat: b.center[1] } })} />)}
              </View>
            </View>
          )}
          <HeightField value={s.heightM} imperial={imperial} onChange={(heightM) => void save({ heightM })} />
        </Card>
      )}

      {hasLight && (
        <Card title="Sun: measured vs modeled">
          <Body muted>On clear days, when this sensor sees direct sun is compared with when the shade model says its spot is sunny. Needs the pin, and at least 3 clear days before it adjusts the bed’s sun-hours.</Body>
          {cal && (
            <View>
              {cal.clearDays ? (
                <Body>
                  {cal.clearDays} clear day{cal.clearDays === 1 ? '' : 's'}: the sensor saw {Math.round(cal.days.reduce((x, d) => x + d.measuredHours, 0) / cal.clearDays * 10) / 10} h of sun a day vs {Math.round(cal.days.reduce((x, d) => x + d.modeledHours, 0) / cal.clearDays * 10) / 10} h modeled
                  {cal.agreement !== null ? `; they agree ${Math.round(cal.agreement * 100)} % of the time` : ''}.
                  {cal.ratio !== null && cal.clearDays >= 3 ? ` Bed sun-hours here are scaled ×${cal.ratio.toFixed(2)}.` : ''}
                </Body>
              ) : <Body muted>No clear days with enough readings yet.</Body>}
              <Text style={{ color: t.muted, fontSize: 12 }}>Clear days: NASA POWER all-sky vs clear-sky sunlight. Computed {new Date(cal.computedAt).toLocaleDateString()}.</Text>
            </View>
          )}
          <Button title={calBusy ? 'Comparing…' : 'Compare with the shade model'} kind="secondary" disabled={calBusy} onPress={async () => {
            setCalBusy(true);
            const r = await calibrateLightSensor(s).catch((e: Error) => ({ error: e.message }));
            setCalBusy(false);
            if ('error' in r) Alert.alert('Sun comparison', r.error);
            else setCal(r);
          }} />
        </Card>
      )}

      {(s.exposure === 'greenhouse' || s.exposure === 'open-air' || s.exposure === 'soil') && !isStation && (
        <ThresholdsCard s={s} imperial={imperial} locked={!ent.has('sensors.greenhouseAlerts')} onSave={(thresholds) => void save({ thresholds })} />
      )}

      {s.kind === 'ble' && !s.parentId && <BindkeyCard s={s} onSave={(mac) => void save({ mac })} />}

      <TextInput defaultValue={s.name} onEndEditing={(e) => e.nativeEvent.text.trim() && void save({ name: e.nativeEvent.text.trim() })} accessibilityLabel="Sensor name"
        style={[styles.input, { color: t.text, borderColor: t.border }]} />
      <Button title={isStation ? 'Remove this station' : 'Remove this sensor'} kind="secondary" onPress={() =>
        Alert.alert('Remove?', 'Its readings are deleted from this phone, and it’s removed from your other devices.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: async () => { await deleteSecrets(await deleteSensor(s.id)); router.back(); } },
        ])} />
    </ScrollView>
  );
}

function HeightField({ value, imperial, onChange }: { value?: number; imperial: boolean; onChange: (m: number | undefined) => void }) {
  const t = useTheme();
  const shown = value === undefined ? '' : imperial ? String(Math.round((value / 0.3048) * 10) / 10) : String(value);
  return (
    <TextInput defaultValue={shown} keyboardType="decimal-pad" placeholder={`Height above ground (${imperial ? 'ft' : 'm'})`} placeholderTextColor={t.muted}
      accessibilityLabel="Height above ground" style={[styles.input, { color: t.text, borderColor: t.border }]}
      onEndEditing={(e) => { const n = Number(e.nativeEvent.text); onChange(e.nativeEvent.text && Number.isFinite(n) ? (imperial ? n * 0.3048 : n) : undefined); }} />
  );
}

function ThresholdsCard({ s, imperial, locked, onSave }: { s: SensorRecord; imperial: boolean; locked: boolean; onSave: (t: Thresholds | undefined) => void }) {
  const t = useTheme();
  const [th, setTh] = useState<Thresholds>(s.thresholds ?? {});
  const toShown = (c?: number) => (c === undefined ? '' : String(Math.round(imperial ? (c * 9) / 5 + 32 : c)));
  const fromShown = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : imperial ? ((Number(v) - 32) * 5) / 9 : Number(v));
  const u = imperial ? '°F' : '°C';
  const field = (label: string, value: string, on: (v: string) => void) => (
    <TextInput defaultValue={value} keyboardType="numbers-and-punctuation" placeholder={label} placeholderTextColor={t.muted} accessibilityLabel={label}
      editable={!locked} onEndEditing={(e) => on(e.nativeEvent.text)} style={[styles.input, { color: t.text, borderColor: t.border, opacity: locked ? 0.5 : 1 }]} />
  );
  return (
    <Card title="Alerts from this sensor">
      {locked ? <Body muted>Greenhouse and sensor threshold alerts are part of Homestead Pro.</Body> : <Body muted>Get a notification when a reading crosses a limit (checked when the app opens, and about twice a day in the background for stations). Turn on alerts in Settings.</Body>}
      {field(`Alert below (${u})`, toShown(th.minC), (v) => setTh((x) => ({ ...x, minC: fromShown(v) })))}
      {field(`Alert above (${u})`, toShown(th.maxC), (v) => setTh((x) => ({ ...x, maxC: fromShown(v) })))}
      {field('Alert when humidity is above (%)', th.maxRhPct === undefined ? '' : String(th.maxRhPct), (v) => setTh((x) => ({ ...x, maxRhPct: v.trim() ? Number(v) : undefined })))}
      {s.exposure === 'soil' && field('Alert when soil moisture is below (%)', th.minSoilMoisturePct === undefined ? '' : String(th.minSoilMoisturePct), (v) => setTh((x) => ({ ...x, minSoilMoisturePct: v.trim() ? Number(v) : undefined })))}
      <Button title="Save limits" kind="secondary" disabled={locked} onPress={() => onSave(Object.values(th).some((v) => v !== undefined) ? th : undefined)} />
    </Card>
  );
}

function BindkeyCard({ s, onSave }: { s: SensorRecord; onSave: (mac: string | undefined) => void }) {
  const t = useTheme();
  const [key, setKey] = useState('');
  const [has, setHas] = useState(false);
  useEffect(() => { void getSecret(s.id).then((x) => setHas(!!x?.bindkey)); }, [s.id]);
  return (
    <Card title="Encryption key">
      <Body muted>{has ? 'A bindkey is saved in this phone’s keychain.' : 'Only needed for encrypted Xiaomi, pvvx or BTHome sensors.'}</Body>
      <TextInput value={key} onChangeText={setKey} placeholder="New bindkey (hex)" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false}
        accessibilityLabel="Bindkey" style={[styles.input, { color: t.text, borderColor: t.border }]} />
      <TextInput defaultValue={s.mac ?? ''} placeholder="MAC AA:BB:CC:DD:EE:FF" placeholderTextColor={t.muted} autoCapitalize="characters" autoCorrect={false}
        accessibilityLabel="MAC address" onEndEditing={(e) => onSave(e.nativeEvent.text.trim().toUpperCase() || undefined)} style={[styles.input, { color: t.text, borderColor: t.border }]} />
      <Button title="Save key" kind="secondary" onPress={async () => {
        const k = key.replace(/[\s:-]/g, '').toLowerCase();
        if (!/^[0-9a-f]{24}$|^[0-9a-f]{32}$/.test(k)) return Alert.alert('Bindkey', 'Enter the 32-character (or 24 for older Xiaomi) hex key.');
        await setSecret(s.id, { bindkey: k });
        setKey(''); setHas(true);
      }} />
    </Card>
  );
}

const styles = StyleSheet.create({
  map: { height: 220, borderRadius: 12, overflow: 'hidden', marginVertical: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 44, marginTop: 8, fontSize: 16 },
});
