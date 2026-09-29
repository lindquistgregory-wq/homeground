/**
 * Connect a home weather station (§8.2, §8.3; §14 "valid Ecowitt keys import current readings and
 * backfill available history"). Keys are the owner's own, created free in their station account, kept
 * in the keychain, and sent only to that station's service.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ambientDevices, ecowittLocal, ecowittRealtime, isLocalAddress, weatherLinkCurrent, weatherLinkLive, weatherLinkStations, type StationDevice } from '@plotwright/providers';
import { useEntitlements } from '../../src/billing/entitlements';
import { Chip } from '../../src/components/plants';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { deleteSensor, saveSensor } from '../../src/db/sensors';
import { http } from '../../src/services/http';
import { deleteSecrets, setSecret, type SensorSecret } from '../../src/services/secrets';
import { normalizeMac } from '../../src/components/sensorFormat';
import { localOffsetMin } from '../../src/services/sensorInsights';
import { STATION_LABEL, backfillStation, discoverTempest, refreshStation, type BackfillProgress, type StationProtocol } from '../../src/services/stations';

const HELP: Record<StationProtocol, string> = {
  ecowitt: 'In your ecowitt.net account: User Center → Private Center → API Keys. Create an Application Key and an API Key (both free). The MAC is your gateway’s, shown under Devices.',
  ambient: 'At AmbientWeather.net: Account → API Keys. Create an API Key, and an Application Key too (both free). We don’t share one app key across users, so you create your own.',
  weatherlink: 'At weatherlink.com: Account → “Generate v2 Key”. Copy the API Key and API Secret. Current readings work on the free plan; history needs WeatherLink Pro.',
  'ecowitt-local': 'Your gateway’s IP address on your Wi-Fi (in the Ecowitt / WS View app under device settings, e.g. 192.168.1.40). The phone must be on the same Wi-Fi.',
  'wll-local': 'Your WeatherLink Live’s IP address on your Wi-Fi (shown in the WeatherLink app’s device info). The phone must be on the same Wi-Fi.',
  'tempest-udp': 'Your Tempest hub broadcasts readings on your Wi-Fi. Keep the phone on the same network and tap Find. (Tempest’s cloud API isn’t used: its terms don’t allow commercial apps.)',
};

export default function ConnectStation() {
  const { parcelId } = useLocalSearchParams<{ parcelId: string }>();
  const t = useTheme();
  const ent = useEntitlements((s) => s.entitlements);
  const [proto, setProto] = useState<StationProtocol>('ecowitt');
  const [f, setF] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<StationDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const local = proto === 'ecowitt-local' || proto === 'wll-local' || proto === 'tempest-udp';
  const localLocked = local && !ent.has('sensors.localNetwork');

  const field = (key: string, label: string, secure = false) => (
    <TextInput key={key} value={f[key] ?? ''} onChangeText={(v) => setF((x) => ({ ...x, [key]: v }))} placeholder={label} placeholderTextColor={t.muted}
      autoCapitalize="none" autoCorrect={false} secureTextEntry={secure} accessibilityLabel={label} style={[styles.input, { color: t.text, borderColor: t.border }]} />
  );
  const v = (k: string) => (f[k] ?? '').trim();

  /** Validate, then create the station and pull its readings and history. */
  const connect = async (deviceKey: string, name: string, secret: SensorSecret | null) => {
    const station = await saveSensor({ parcelId, kind: local ? 'local' : 'cloud', protocol: proto, vendor: STATION_LABEL[proto], name, deviceKey, exposure: 'open-air' });
    if (secret) await setSecret(station.id, secret);
    try {
      setBusy('Reading current conditions…');
      const now = await refreshStation(station, localOffsetMin());
      if (now && now.status !== 'ok') throw new Error(now.reason);
      if (!local) {
        setBusy('Downloading history…');
        const p = await backfillStation(station, localOffsetMin(), setProgress);
        if (p.note) Alert.alert('History', p.note);
      }
      router.back();
    } catch (e) {
      // Remove the half-made station, its channels, and the keys just saved for it.
      await deleteSecrets(await deleteSensor(station.id));
      Alert.alert('Couldn’t connect', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    try {
      setBusy('Checking…');
      if (proto === 'ecowitt') {
        // Ecowitt wants the MAC with colons; people paste it with dashes or none.
        const mac = normalizeMac(v('mac'));
        const keys = { applicationKey: v('app'), apiKey: v('api'), mac: mac ?? '' };
        if (!keys.applicationKey || !keys.apiKey || !mac) throw new Error('Enter both keys and the gateway MAC (AA:BB:CC:DD:EE:FF).');
        const r = await ecowittRealtime(http, keys);
        if (r.status !== 'ok') throw new Error(r.reason);
        await connect(keys.mac, 'Ecowitt station', { applicationKey: keys.applicationKey, apiKey: keys.apiKey });
      } else if (proto === 'ambient') {
        const r = await ambientDevices(http, { applicationKey: v('app'), apiKey: v('api') });
        if (r.status !== 'ok') throw new Error(r.reason);
        if (!r.value.length) throw new Error('No stations on that Ambient account.');
        setChoices(r.value);
      } else if (proto === 'weatherlink') {
        const st = await weatherLinkStations(http, { apiKey: v('api'), apiSecret: v('secret') });
        if (!st.length) throw new Error('No stations on that WeatherLink account.');
        setChoices(st);
      } else if (proto === 'ecowitt-local' || proto === 'wll-local') {
        if (!isLocalAddress(v('host'))) throw new Error('Enter an address on your home network, e.g. 192.168.1.40.');
        const r = proto === 'ecowitt-local' ? await ecowittLocal(http, v('host')) : await weatherLinkLive(http, v('host'));
        if (r.status !== 'ok') throw new Error(r.reason);
        await connect(v('host'), proto === 'ecowitt-local' ? 'Ecowitt gateway' : 'WeatherLink Live', null);
      } else if (proto === 'tempest-udp') {
        setBusy('Listening for your Tempest hub (up to 70 s)…');
        const serial = await discoverTempest();
        if (!serial) throw new Error('No Tempest broadcast heard. Check the phone is on the same Wi-Fi (on iPhone, Local Network access must be allowed).');
        await connect(serial, `Tempest ${serial}`, null);
      }
    } catch (e) {
      Alert.alert('Couldn’t connect', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pick = async (d: StationDevice) => {
    setChoices(null);
    if (proto === 'ambient') await connect(d.id, d.name, { applicationKey: v('app'), apiKey: v('api') });
    else {
      const probe = await weatherLinkCurrent(http, { apiKey: v('api'), apiSecret: v('secret'), stationId: d.id });
      if (probe.status !== 'ok') return Alert.alert('Couldn’t connect', probe.reason);
      await connect(d.id, d.name, { apiKey: v('api'), apiSecret: v('secret') });
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {(Object.keys(STATION_LABEL) as StationProtocol[]).map((p) => <Chip key={p} label={STATION_LABEL[p]} active={proto === p} onPress={() => { setProto(p); setChoices(null); }} />)}
      </View>
      <Card title={STATION_LABEL[proto]}>
        <Body muted>{HELP[proto]}</Body>
        {localLocked ? <Body>Reading stations over your Wi-Fi is part of Homestead Pro.</Body> : (
          <View>
            {proto === 'ecowitt' && [field('app', 'Application Key', true), field('api', 'API Key', true), field('mac', 'Gateway MAC (AA:BB:CC:DD:EE:FF)')]}
            {proto === 'ambient' && [field('app', 'Application Key', true), field('api', 'API Key', true)]}
            {proto === 'weatherlink' && [field('api', 'API Key', true), field('secret', 'API Secret', true)]}
            {(proto === 'ecowitt-local' || proto === 'wll-local') && field('host', 'IP address, e.g. 192.168.1.40')}
            {choices?.map((d) => <Button key={d.id} title={`Use “${d.name}”`} kind="secondary" onPress={() => void pick(d)} />)}
            {!choices && <Button title={proto === 'tempest-udp' ? 'Find my hub' : busy ?? 'Connect'} onPress={test} disabled={!!busy} />}
          </View>
        )}
        {busy && <Body muted>{busy}</Body>}
        {progress && progress.total > 0 && <Body muted>History: {progress.done} of {progress.total} · {progress.readings.toLocaleString()} readings</Body>}
      </Card>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        Your keys are stored in this phone’s keychain and sent only to {proto.includes('local') || proto === 'tempest-udp' ? 'your own device on your Wi-Fi' : 'your station’s own service'}. They don’t sync to your other devices; enter them again there.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 44, marginTop: 8, fontSize: 16 },
});
