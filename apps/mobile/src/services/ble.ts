/**
 * Bluetooth LE sensor scanning (§8.1): passive advertisement scanning only (no pairing, no
 * connection). iOS doesn't let apps scan in the background without special modes, so sensors are
 * collected while the app is open: a short scan when it opens ("collect on open") and a live scan on
 * the sensors screen. react-native-ble-plx (Apache-2.0).
 */
import {
  decodeAdvertisement, deviceKey, hexToBytes, toReadings, type Advertisement, type DecodedAdvert, type MetricValues, type Offset,
} from '@plotwright/core';
import { fromBase64 } from '@plotwright/providers';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';
import { bleAliases, findSensor, insertReadings, listSensors, touchSensor, type SensorRecord } from '../db/sensors';
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
 * One native scan shared by every listener (collect-on-open, the scan screen): starting a second scan
 * or stopping one would otherwise cut the other off. The scan runs while anyone is subscribed.
 */
type Listener = (adv: Advertisement) => void;
const listeners = new Set<Listener>();
let scanning = false;

function startNativeScan() {
  if (scanning) return;
  scanning = true;
  // Active scanning, because Govee and SwitchBot put their data in scan responses.
  ble().startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
    if (error || !device) return;
    let adv: Advertisement;
    try {
      adv = toAdvertisement(device);
    } catch {
      return;
    }
    for (const l of [...listeners]) {
      // A bad packet or a bad key must never throw out of the native callback (a fatal error in release builds).
      try {
        l(adv);
      } catch {
        // ignore this packet for this listener
      }
    }
  });
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  startNativeScan();
  return () => {
    listeners.delete(l);
    if (!listeners.size && scanning) {
      scanning = false;
      ble().stopDeviceScan();
    }
  };
}

interface KnownIndex {
  /** Sensors by device key, and by this phone's Bluetooth id (aliases), top-level sensors only. */
  byKey: Map<string, SensorRecord>;
  keys: Map<string, { key?: Uint8Array; mac?: string }>;
}

async function knownIndex(): Promise<KnownIndex> {
  const byKey = new Map<string, SensorRecord>();
  const keys = new Map<string, { key?: Uint8Array; mac?: string }>();
  // Probe/remote channels share their parent's device key: only the parent identifies the device.
  const top = (await listSensors()).filter((s) => s.kind === 'ble' && s.deviceKey && !s.parentId && !s.channel);
  const byId = new Map(top.map((s) => [s.id, s]));
  for (const s of top) byKey.set(s.deviceKey!, s);
  for (const [platformKey, sensorId] of await bleAliases()) {
    const s = byId.get(sensorId);
    if (s) byKey.set(platformKey, s);
  }
  for (const [k, s] of byKey) {
    const sec = await getSecret(s.id);
    keys.set(k, { key: bindkeyBytes(sec?.bindkey), mac: s.mac });
  }
  return { byKey, keys };
}

/** Bindkey text → bytes; a malformed key is treated as missing (the sensor then shows "needs its key"). */
function bindkeyBytes(hex: string | undefined): Uint8Array | undefined {
  if (!hex || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return undefined;
  try {
    return hexToBytes(hex);
  } catch {
    return undefined;
  }
}

/** Re-read known sensors (after adding one or saving a key) for scans already running. */
let reindex: Array<() => void> = [];
export function knownSensorsChanged(): void {
  for (const f of reindex) f();
}

/**
 * Scan and report decodable sensors as they're heard. Known sensors are decoded with their bindkey.
 * Returns a stop function.
 */
export async function scanSensors(onDevice: (d: SeenDevice) => void): Promise<() => void> {
  let idx = await knownIndex();
  const refresh = () => { void knownIndex().then((i) => (idx = i)); };
  reindex.push(refresh);
  const seen = new Map<string, SeenDevice>();
  const unsubscribe = subscribe((adv) => {
    // First pass without a key to learn the device identity, then decode with its key if we have one.
    const probe = decodeAdvertisement(adv, {});
    if (!probe) return;
    const key = deviceKey(adv, probe);
    const rec = idx.byKey.get(key) ?? idx.byKey.get(adv.id);
    const k = idx.keys.get(key) ?? idx.keys.get(adv.id);
    const decoded = k || rec?.modelHint ? decodeAdvertisement(adv, { key: k?.key, mac: k?.mac ?? rec?.mac, modelHint: rec?.modelHint }) ?? probe : probe;
    const prev = seen.get(key);
    const d: SeenDevice = { key, adv, decoded, values: { ...(prev?.values ?? {}), ...decoded.values }, lastSeen: Date.now(), known: rec };
    seen.set(key, d);
    onDevice(d);
  });
  return () => {
    unsubscribe();
    reindex = reindex.filter((f) => f !== refresh);
  };
}

/** Minimum spacing between stored readings per sensor, so a 1-second broadcaster doesn't flood the database. */
const STORE_EVERY_MS = 60_000;
const lastStored = new Map<string, number>();

/** Store readings for known sensors from a seen device (called from scans). Returns true if stored. */
export async function ingestSeen(d: SeenDevice, offsetMin: Offset): Promise<boolean> {
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

/** "Collect on open": a short scan that stores readings from known Bluetooth sensors. Resolves when the writes finish. */
export async function collectOnOpen(offsetMin: Offset, durationMs = 12_000): Promise<number> {
  const sensors = (await listSensors()).filter((s) => s.kind === 'ble');
  if (!sensors.length) return 0;
  if ((await ensureBlePermission()) !== 'ok') return 0;
  let stored = 0;
  const writes: Array<Promise<unknown>> = [];
  const stop = await scanSensors((d) => {
    if (d.known) writes.push(ingestSeen(d, offsetMin).then((ok) => { if (ok) stored++; }).catch(() => undefined));
  });
  await new Promise((r) => setTimeout(r, durationMs));
  stop();
  await Promise.all(writes);
  return stored;
}
