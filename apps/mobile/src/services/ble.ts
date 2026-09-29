/**
 * Bluetooth LE sensor scanning (§8.1): passive advertisement scanning only (no pairing, no
 * connection). iOS doesn't let apps scan in the background without special modes, so sensors are
 * collected while the app is open: a short scan when it opens ("collect on open") and a live scan on
 * the sensors screen. react-native-ble-plx (Apache-2.0).
 */
import {
  decodeAdvertisement, deviceKey, hexToBytes, toReadings, type Advertisement, type DecodedAdvert, type MetricValues,
} from '@plotwright/core';
import { fromBase64 } from '@plotwright/providers';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';
import { findSensor, insertReadings, listSensors, touchSensor, type SensorRecord } from '../db/sensors';
import { getSecret } from './secrets';

let manager: BleManager | null = null;
const ble = () => (manager ??= new BleManager());

export function toAdvertisement(d: Device): Advertisement {
  const serviceData: Record<string, Uint8Array> = {};
  for (const [uuid, b64] of Object.entries(d.serviceData ?? {})) if (b64) serviceData[uuid] = fromBase64(b64);
  return {
    id: d.id,
    name: d.localName ?? d.name,
    manufacturerData: d.manufacturerData ? fromBase64(d.manufacturerData) : null,
    serviceData,
    rssi: d.rssi,
  };
}

/** Ask for Bluetooth permission. Android 12+ uses BLUETOOTH_SCAN ("never for location"); older versions need location. */
export async function ensureBlePermission(): Promise<'ok' | 'denied' | 'off'> {
  if (Platform.OS === 'android') {
    const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    const perms = api >= 31 ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const res = await PermissionsAndroid.requestMultiple(perms);
    if (!Object.values(res).every((r) => r === PermissionsAndroid.RESULTS.GRANTED)) return 'denied';
  }
  const state = await ble().state();
  if (state === State.Unauthorized) return 'denied';
  if (state !== State.PoweredOn) {
    // iOS reports Unknown briefly on first use; wait for the real state.
    const s = await new Promise<State>((resolve) => {
      const sub = ble().onStateChange((st) => {
        if (st !== State.Unknown && st !== State.Resetting) { sub.remove(); resolve(st); }
      }, true);
      setTimeout(() => { sub.remove(); resolve(State.PoweredOff); }, 3000);
    });
    if (s === State.Unauthorized) return 'denied';
    if (s !== State.PoweredOn) return 'off';
  }
  return 'ok';
}

export interface SeenDevice {
  key: string;
  adv: Advertisement;
  decoded: DecodedAdvert;
  /** Values merged across packets (MiFlora sends one reading per packet). */
  values: MetricValues;
  lastSeen: number;
  known?: SensorRecord;
}

/**
 * Scan and report decodable sensors as they're heard. Known sensors are decoded with their bindkey.
 * Returns a stop function. Active scanning is on because Govee and SwitchBot put data in scan responses.
 */
export async function scanSensors(onDevice: (d: SeenDevice) => void): Promise<() => void> {
  const known = new Map<string, SensorRecord>();
  for (const s of await listSensors()) if (s.kind === 'ble' && s.deviceKey) known.set(s.deviceKey, s);
  const keys = new Map<string, { key?: Uint8Array; mac?: string }>();
  for (const s of known.values()) {
    const sec = await getSecret(s.id);
    keys.set(s.deviceKey!, { key: sec?.bindkey ? hexToBytes(sec.bindkey) : undefined, mac: s.mac });
  }
  const seen = new Map<string, SeenDevice>();
  ble().startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
    if (error || !device) return;
    const adv = toAdvertisement(device);
    // First pass without a key to learn the device identity, then decode with its key if we have one.
    const probe = decodeAdvertisement(adv, {});
    if (!probe) return;
    const key = deviceKey(adv, probe);
    const k = keys.get(key);
    const rec = known.get(key);
    const decoded = k || rec?.modelHint ? decodeAdvertisement(adv, { key: k?.key, mac: k?.mac ?? rec?.mac, modelHint: rec?.modelHint }) ?? probe : probe;
    const prev = seen.get(key);
    const d: SeenDevice = { key, adv, decoded, values: { ...(prev?.values ?? {}), ...decoded.values }, lastSeen: Date.now(), known: rec };
    seen.set(key, d);
    onDevice(d);
  });
  return () => ble().stopDeviceScan();
}

/** Minimum spacing between stored readings per sensor, so a 1-second broadcaster doesn't flood the database. */
const STORE_EVERY_MS = 60_000;
const lastStored = new Map<string, number>();

/** Store readings for known sensors from a seen device (called from scans). Returns true if stored. */
export async function ingestSeen(d: SeenDevice, offsetMin: number): Promise<boolean> {
  const s = d.known;
  if (!s || d.decoded.needsKey) return false;
  const now = Date.now();
  if (now - (lastStored.get(s.id) ?? 0) < STORE_EVERY_MS) return false;
  if (!Object.keys(d.values).length) return false;
  lastStored.set(s.id, now);
  await insertReadings(toReadings(s.id, now, d.values), offsetMin);
  // Extra channels (second probe, Govee remote) become child sensors of the same device.
  for (const [ch, values] of Object.entries(d.decoded.channels ?? {})) {
    const child = await findSensor(s.protocol, s.deviceKey!, ch);
    if (child) await insertReadings(toReadings(child.id, now, values), offsetMin);
  }
  await touchSensor(s.id, now, d.decoded.counter);
  return true;
}

/** "Collect on open": a short scan that stores readings from known Bluetooth sensors. */
export async function collectOnOpen(offsetMin: number, durationMs = 12_000): Promise<number> {
  const sensors = (await listSensors()).filter((s) => s.kind === 'ble');
  if (!sensors.length) return 0;
  if ((await ensureBlePermission()) !== 'ok') return 0;
  let stored = 0;
  const stop = await scanSensors((d) => {
    if (d.known) void ingestSeen(d, offsetMin).then((ok) => { if (ok) stored++; });
  });
  await new Promise((r) => setTimeout(r, durationMs));
  stop();
  return stored;
}
