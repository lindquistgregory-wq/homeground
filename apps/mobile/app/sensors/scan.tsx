/**
 * Find Bluetooth sensors nearby (§8.1, §14 "appears within 10 s of foreground scanning"). Shows every
 * advertisement we can decode, live, with its readings; tap one to add it to the property.
 */
import { METRIC_LABEL, type Exposure, type Metric } from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Chip } from '../../src/components/plants';
import { EXPOSURE_LABEL, formatMetric } from '../../src/components/sensorFormat';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { listSensors, saveSensor, setBleAlias, type SensorRecord } from '../../src/db/sensors';
import { checkThresholdsNow } from '../../src/services/alerts';
import { normalizeMac } from '../../src/components/sensorFormat';
import { ensureBlePermission, ingestSeen, knownSensorsChanged, scanSensors, type SeenDevice } from '../../src/services/ble';
import { setSecret } from '../../src/services/secrets';
import { localOffsetMin } from '../../src/services/sensorInsights';
import { useSettings } from '../../src/services/settings';

const EXPOSURES: Exposure[] = ['open-air', 'shaded-air', 'greenhouse', 'soil', 'indoor'];

export default function Scan() {
  const { parcelId } = useLocalSearchParams<{ parcelId: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const [devices, setDevices] = useState<Record<string, SeenDevice>>({});
  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied' | 'off'>('starting');
  const [adding, setAdding] = useState<SeenDevice | null>(null);
  const pending = useRef<Record<string, SeenDevice>>({});

  useEffect(() => {
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const p = await ensureBlePermission();
      if (p !== 'ok') return setStatus(p);
      setStatus('scanning');
      stop = await scanSensors((d) => {
        pending.current[d.key] = d;
        if (d.known) void ingestSeen(d, localOffsetMin()).then((stored) => { if (stored) void checkThresholdsNow(); }).catch(() => undefined);
      });
      // Batch UI updates: sensors broadcast several times a second.
      timer = setInterval(() => {
        if (Object.keys(pending.current).length) {
          const batch = pending.current;
          pending.current = {};
          setDevices((prev) => ({ ...prev, ...batch }));
        }
      }, 700);
    })();
    return () => { stop?.(); if (timer) clearInterval(timer); };
  }, []);

  const list = Object.values(devices).sort((a, b) => Number(!!a.known) - Number(!!b.known) || (b.adv.rssi ?? -200) - (a.adv.rssi ?? -200));

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {status === 'denied' && <Body>Bluetooth permission is off. Allow Plotwright to use Bluetooth in your phone’s Settings.</Body>}
      {status === 'off' && <Body>Bluetooth is turned off. Turn it on and come back.</Body>}
      {status === 'scanning' && <Body muted>Listening… Keep the phone near the sensor. Most sensors broadcast every few seconds.</Body>}
      {list.length === 0 && status === 'scanning' && (
        <Body muted>Nothing yet. Supported: Govee, SwitchBot meters, Xiaomi/Qingping (stock or ATC/pvvx firmware), Xiaomi Flower Care, Inkbird IBS-TH, RuuviTag and BTHome devices.</Body>
      )}
      {list.map((d) => (
        <Pressable key={d.key} accessibilityRole="button" disabled={!!d.known} onPress={() => setAdding(d)}
          style={[styles.row, { backgroundColor: t.card, borderColor: d.known ? t.accent : t.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '600' }}>{d.known?.name ?? `${d.decoded.vendor} ${d.decoded.model}`}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              {d.decoded.mac ?? (Platform.OS === 'ios' ? 'MAC hidden by iOS' : d.adv.id)}{d.adv.rssi ? ` · signal ${d.adv.rssi} dBm` : ''}
            </Text>
            <Text style={{ color: d.decoded.needsKey ? t.warn : t.text }}>
              {d.decoded.needsKey ? 'Encrypted: needs its bindkey' : d.decoded.error ?? ((Object.entries(d.values) as Array<[Metric, number]>).map(([m, v]) => `${METRIC_LABEL[m]} ${formatMetric(m, v, units)}`).join(' · ') || 'Waiting for readings…')}
            </Text>
          </View>
          <Text style={{ color: d.known ? t.accent : t.accent, fontWeight: '600' }}>{d.known ? 'Added' : 'Add'}</Text>
        </Pressable>
      ))}
      {adding && (
        <AddForm d={adding} parcelId={parcelId} heardIds={new Set(list.map((x) => x.known?.id).filter((x): x is string => !!x))}
          onDone={() => { setAdding(null); router.back(); }} onCancel={() => setAdding(null)} />
      )}
    </ScrollView>
  );
}

function AddForm({ d, parcelId, heardIds, onDone, onCancel }: { d: SeenDevice; parcelId: string; heardIds: Set<string>; onDone: () => void; onCancel: () => void }) {
  const t = useTheme();
  const plant = d.values.soilMoisture !== undefined || d.values.conductivity !== undefined;
  const [name, setName] = useState(`${d.decoded.vendor} ${d.decoded.model}`);
  const [exposure, setExposure] = useState<Exposure>(plant ? 'soil' : 'open-air');
  const [bindkey, setBindkey] = useState('');
  const [mac, setMac] = useState(d.decoded.mac ?? (Platform.OS === 'android' ? d.adv.id : ''));
  const needsKey = !!d.decoded.needsKey;
  // Sensors added on another phone arrive by sync, but iOS gives each phone its own Bluetooth ids.
  const [existing, setExisting] = useState<SensorRecord[]>([]);
  useEffect(() => {
    // Sensors this phone is already hearing under their own id are other devices: don't offer them.
    void listSensors(parcelId).then((all) => setExisting(all.filter((x) => x.kind === 'ble' && !x.parentId && x.protocol === d.decoded.protocol && x.deviceKey !== d.key && !heardIds.has(x.id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelId, d.key, d.decoded.protocol, [...heardIds].sort().join(',')]);

  /** The key and MAC typed in the form, validated; null (after telling the user) when they're needed but wrong. */
  const credentials = (): { key?: string; mac?: string } | null => {
    const key = bindkey.replace(/[\s:-]/g, '');
    // Only older Xiaomi (MiBeacon v2/v3) keys are 24 characters; everything else is AES-128 (32).
    const keyOk = /^[0-9a-f]{32}$/i.test(key) || (d.decoded.protocol === 'xiaomi' && /^[0-9a-f]{24}$/i.test(key));
    if (needsKey && !keyOk) {
      Alert.alert('Bindkey', d.decoded.protocol === 'xiaomi' ? 'Enter the 32-character hex bindkey (24 characters for older Xiaomi firmware).' : 'Enter the 32-character hex bindkey.');
      return null;
    }
    const m = normalizeMac(mac);
    if (needsKey && !m) {
      Alert.alert('MAC address', 'Enter the sensor’s MAC address as AA:BB:CC:DD:EE:FF (printed on the device or shown in its app).');
      return null;
    }
    return { key: needsKey ? key.toLowerCase() : undefined, mac: m ?? undefined };
  };

  const link = async (s: SensorRecord) => {
    // An encrypted sensor needs its key on this phone too (keys never leave the phone they're entered on).
    const c = credentials();
    if (!c) return;
    await setBleAlias(d.key, s.id);
    if (c.key) await setSecret(s.id, { bindkey: c.key });
    if (c.mac && !s.mac) await saveSensor({ ...s, mac: c.mac });
    knownSensorsChanged();
    onDone();
  };

  const save = async () => {
    const c = credentials();
    if (!c) return;
    const m = c.mac;
    const s = await saveSensor({
      parcelId, kind: 'ble', protocol: d.decoded.protocol, vendor: d.decoded.vendor, model: d.decoded.model, name: name.trim() || d.decoded.model,
      deviceKey: d.key, exposure, mac: m ?? undefined, modelHint: d.decoded.protocol === 'switchbot' ? d.decoded.model : undefined,
    });
    for (const ch of Object.keys(d.decoded.channels ?? {})) {
      await saveSensor({ parcelId, kind: 'ble', protocol: s.protocol, vendor: s.vendor, model: s.model, name: `${s.name} (${ch === 'remote' ? 'remote probe' : `probe ${ch}`})`, deviceKey: d.key, channel: ch, parentId: s.id, exposure });
    }
    if (c.key) await setSecret(s.id, { bindkey: c.key });
    else await ingestSeen({ ...d, known: s }, localOffsetMin());
    knownSensorsChanged();
    onDone();
  };

  return (
    <Card title="Add sensor">
      {existing.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Body>Already added this sensor on another phone? Link it to keep one history{needsKey ? ' (enter its key below first)' : ''}:</Body>
          {existing.map((x) => <Button key={x.id} title={`This is “${x.name}”`} kind="secondary" onPress={() => void link(x)} />)}
        </View>
      )}
      <TextInput value={name} onChangeText={setName} accessibilityLabel="Sensor name" style={[styles.input, { color: t.text, borderColor: t.border }]} placeholder="Name (e.g. Greenhouse)" placeholderTextColor={t.muted} />
      <Text style={{ color: t.text, marginTop: 8, fontWeight: '600' }}>Where is it?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {EXPOSURES.map((e) => <Chip key={e} label={EXPOSURE_LABEL[e]} active={exposure === e} onPress={() => setExposure(e)} />)}
      </View>
      <Body muted>Outdoors in the open is best for frost and watering; “in the soil” feeds planting dates. You can pin it on the map afterwards.</Body>
      {needsKey && (
        <View>
          <TextInput value={bindkey} onChangeText={setBindkey} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Bindkey"
            style={[styles.input, { color: t.text, borderColor: t.border }]} placeholder="Bindkey (hex)" placeholderTextColor={t.muted} />
          <TextInput value={mac} onChangeText={setMac} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="MAC address"
            style={[styles.input, { color: t.text, borderColor: t.border }]} placeholder="MAC address AA:BB:CC:DD:EE:FF" placeholderTextColor={t.muted} />
          <Body muted>Encrypted Xiaomi and BTHome sensors need their key. It stays in this phone’s keychain.</Body>
        </View>
      )}
      <Button title="Add" onPress={save} />
      <Button title="Cancel" kind="secondary" onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 44, marginTop: 8, fontSize: 16 },
});
