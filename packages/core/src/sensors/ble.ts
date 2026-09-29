/**
 * Passive Bluetooth LE advertisement decoders (§8.1): no pairing, no connection, just the readings
 * sensors broadcast. Clean-room implementations from published formats; references (all permissive
 * licences, see docs/SENSORS.md): BTHome spec (bthome.io) and bthome-ble (MIT); govee-ble (Apache-2.0);
 * pySwitchbot (MIT); xiaomi-ble (Apache-2.0) and pvvx ATC_MiThermometer (MIT-style); qingping-ble (MIT);
 * inkbird-ble (MIT); Ruuvi data format 5 (docs.ruuvi.com; vectors from ruuvi.endpoints.c, BSD-3).
 *
 * Input is what react-native-ble-plx gives on both platforms: manufacturer data as raw bytes starting
 * with the 2-byte little-endian company ID, and service data keyed by UUID (16- or 128-bit strings).
 */
import { ccmCtrOnly, ccmDecrypt, hexToBytes } from './crypto';
import type { MetricValues } from './types';

export interface Advertisement {
  /** Platform id: the MAC on Android, a per-phone UUID on iOS (Apple hides MACs). */
  id: string;
  name?: string | null;
  /** Raw manufacturer data, starting with the little-endian company ID. */
  manufacturerData?: Uint8Array | null;
  serviceData?: Record<string, Uint8Array> | null;
  rssi?: number | null;
}

export interface DecodeOptions {
  /** 16-byte bindkey (12 bytes for Xiaomi v2/v3 legacy) for encrypted sensors. */
  key?: Uint8Array;
  /** MAC in display order ("A4:C1:38:…"). Needed to decrypt when the phone can't see it (iOS) and the frame doesn't carry it. */
  mac?: string;
  /** Model remembered from an earlier full advertisement (SwitchBot scans can arrive without service data). */
  modelHint?: string;
}

export type Protocol = 'bthome' | 'govee' | 'switchbot' | 'xiaomi' | 'atc' | 'qingping' | 'inkbird' | 'ruuvi';

export interface DecodedAdvert {
  protocol: Protocol;
  vendor: string;
  model: string;
  /** Readings for the main sensor. */
  values: MetricValues;
  /** Extra channels (second probe, remote sensor, repeated BTHome objects), keyed "2", "3" or "remote". */
  channels?: Record<string, MetricValues>;
  /** MAC carried inside the payload, display order. Identifies the device on iOS too. */
  mac?: string;
  /** Packet/frame counter, for de-duplication and replay protection. */
  counter?: number;
  encrypted: boolean;
  /** Encrypted and no (or the wrong) key: readings unavailable. */
  needsKey?: boolean;
  /** Sensor reported an error value. */
  error?: string;
}

// ---------------- byte helpers ----------------

const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const s16le = (b: Uint8Array, i: number) => { const v = u16le(b, i); return v & 0x8000 ? v - 0x10000 : v; };
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const s16be = (b: Uint8Array, i: number) => { const v = u16be(b, i); return v & 0x8000 ? v - 0x10000 : v; };
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)) + b[i + 3]! * 0x1000000;
const f32le = (b: Uint8Array, i: number) => new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, true);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};
const macDisplay = (onAir: Uint8Array) => [...onAir].reverse().map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
const macBytes = (display: string) => hexToBytes(display);
const macBytesOnAir = (display: string) => macBytes(display).reverse();

/** '0000fcd2-0000-1000-8000-00805f9b34fb' or 'FCD2' → 'fcd2'. */
export function shortUuid(uuid: string): string {
  const u = uuid.toLowerCase();
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(u);
  return m ? m[1]! : u.length === 4 ? u : u;
}

function service(adv: Advertisement, uuid16: string): Uint8Array | undefined {
  if (!adv.serviceData) return undefined;
  for (const [k, v] of Object.entries(adv.serviceData)) if (shortUuid(k) === uuid16) return v;
  return undefined;
}

// ---------------- BTHome ----------------

type ObjDef = [size: number, metric: keyof MetricValues | 'packetId' | null, factor: number, signed?: boolean];

/** BTHome v2 object table: size is required to walk past objects we don't store. */
const BTHOME: Record<number, ObjDef> = {
  0x00: [1, 'packetId', 1], 0x01: [1, 'battery', 1], 0x02: [2, 'temperature', 0.01, true], 0x03: [2, 'humidity', 0.01], 0x04: [3, 'pressure', 0.01],
  0x05: [3, 'illuminance', 0.01], 0x06: [2, null, 0.01], 0x07: [2, null, 0.01], 0x08: [2, 'dewPoint', 0.01, true], 0x09: [1, null, 1], 0x0a: [3, null, 0.001],
  0x0b: [3, null, 0.01], 0x0c: [2, 'voltage', 0.001], 0x0d: [2, 'pm25', 1], 0x0e: [2, null, 1], 0x0f: [1, null, 1], 0x10: [1, null, 1], 0x11: [1, null, 1],
  0x12: [2, 'co2', 1], 0x13: [2, null, 1], 0x14: [2, 'soilMoisture', 0.01], 0x2e: [1, 'humidity', 1], 0x2f: [1, 'soilMoisture', 1], 0x3a: [1, null, 1],
  0x3c: [2, null, 1], 0x3d: [2, null, 1], 0x3e: [4, null, 1], 0x3f: [2, null, 0.1, true], 0x40: [2, null, 1], 0x41: [2, null, 0.1], 0x42: [3, null, 0.001],
  0x43: [2, null, 0.001], 0x44: [2, 'windSpeed', 0.01], 0x45: [2, 'temperature', 0.1, true], 0x46: [1, 'uvIndex', 0.1], 0x47: [2, null, 0.1], 0x48: [2, null, 1],
  0x49: [2, null, 0.001], 0x4a: [2, null, 0.1], 0x4b: [3, null, 0.001], 0x4c: [4, null, 0.001], 0x4d: [4, null, 0.001], 0x4e: [4, null, 0.001], 0x4f: [4, null, 0.001],
  0x50: [4, null, 1], 0x51: [2, null, 0.001], 0x52: [2, null, 0.001], 0x55: [4, null, 0.001], 0x56: [2, 'conductivity', 1], 0x57: [1, 'temperature', 1, true],
  0x58: [1, 'temperature', 0.35, true], 0x59: [1, null, 1, true], 0x5a: [2, null, 1, true], 0x5b: [4, null, 1, true], 0x5c: [4, null, 0.01, true], 0x5d: [2, null, 0.001, true],
  0x5e: [2, 'windDirection', 0.01], 0x5f: [2, 'rainTotal', 0.1], 0x60: [1, null, 1], 0x61: [2, null, 1], 0x62: [4, null, 0.000001, true], 0x63: [4, null, 0.000001, true],
  0x64: [1, null, 1], 0x65: [1, null, 1], 0xf0: [2, null, 1], 0xf1: [4, null, 1], 0xf2: [3, null, 1],
};
for (let id = 0x15; id <= 0x2d; id++) BTHOME[id] = [1, null, 1];

function readInt(b: Uint8Array, i: number, size: number, signed: boolean): number {
  let v = 0;
  for (let k = size - 1; k >= 0; k--) v = v * 256 + b[i + k]!;
  if (signed && v >= 2 ** (8 * size - 1)) v -= 2 ** (8 * size);
  return v;
}

/** Collect metric values; later repeats of a metric go to channels "2", "3", … */
class Collector {
  values: MetricValues = {};
  channels: Record<string, MetricValues> = {};
  private seen: Record<string, number> = {};
  add(metric: keyof MetricValues, v: number) {
    const n = (this.seen[metric] = (this.seen[metric] ?? 0) + 1);
    if (n === 1) this.values[metric] = v;
    else (this.channels[String(n)] ??= {})[metric] = v;
  }
  result() {
    return Object.keys(this.channels).length ? { values: this.values, channels: this.channels } : { values: this.values };
  }
}

function parseBthomeObjects(p: Uint8Array): { values: MetricValues; channels?: Record<string, MetricValues>; packetId?: number } {
  const c = new Collector();
  let packetId: number | undefined;
  let i = 0;
  while (i < p.length) {
    const id = p[i++]!;
    if (id === 0x53 || id === 0x54) { i += 1 + (p[i] ?? 0); continue; } // text / raw: length byte
    if (id === 0x3b) { i += 2 + ((p[i] ?? 0) & 0x1f); continue; } // command: args length + opcode
    const def = BTHOME[id];
    if (!def) break; // spec: stop at the first unsupported object id (objects carry no length)
    const [size, metric, factor, signed] = def;
    if (i + size > p.length) break;
    const raw = readInt(p, i, size, !!signed);
    i += size;
    if (metric === 'packetId') packetId = raw;
    else if (metric) c.add(metric, round(raw * factor, 6));
  }
  return { ...c.result(), packetId };
}

export function decodeBthomeV2(sd: Uint8Array, opts: DecodeOptions = {}): DecodedAdvert | null {
  if (sd.length < 1) return null;
  const info = sd[0]!;
  if (info >> 5 !== 2) return null;
  const encrypted = !!(info & 0x01);
  let start = 1;
  let mac = opts.mac;
  let payloadMac: string | undefined;
  if (info & 0x02) {
    // Legacy "MAC included" bit: 6 bytes, little-endian.
    payloadMac = macDisplay(sd.subarray(1, 7));
    mac = payloadMac;
    start = 7;
  }
  const base = { protocol: 'bthome' as const, vendor: 'BTHome', model: 'BTHome v2', encrypted, mac: payloadMac };
  let payload = sd.subarray(start);
  let counter: number | undefined;
  if (encrypted) {
    if (sd.length < start + 8) return null;
    counter = u32le(sd, sd.length - 8);
    if (!opts.key || !mac) return { ...base, values: {}, counter, needsKey: true };
    const nonce = concat(macBytes(mac), new Uint8Array([0xd2, 0xfc, info]), sd.subarray(sd.length - 8, sd.length - 4));
    const plain = ccmDecrypt(opts.key, nonce, sd.subarray(start, sd.length - 8), sd.subarray(sd.length - 4));
    if (!plain) return { ...base, values: {}, counter, needsKey: true };
    payload = plain;
  }
  const r = parseBthomeObjects(payload);
  return { ...base, values: r.values, ...(r.channels ? { channels: r.channels } : {}), counter: counter ?? r.packetId };
}

/** BTHome v1 (legacy UUIDs 0x181C plain, 0x181E encrypted). */
export function decodeBthomeV1(sd: Uint8Array, encrypted: boolean, opts: DecodeOptions = {}): DecodedAdvert | null {
  const base = { protocol: 'bthome' as const, vendor: 'BTHome', model: 'BTHome v1', encrypted };
  let p = sd;
  let counter: number | undefined;
  if (encrypted) {
    if (sd.length < 9) return null;
    counter = u32le(sd, sd.length - 8);
    if (!opts.key || !opts.mac) return { ...base, values: {}, counter, needsKey: true };
    const nonce = concat(macBytes(opts.mac), new Uint8Array([0x1e, 0x18]), sd.subarray(sd.length - 8, sd.length - 4));
    const plain = ccmDecrypt(opts.key, nonce, sd.subarray(0, sd.length - 8), sd.subarray(sd.length - 4), new Uint8Array([0x11]));
    if (!plain) return { ...base, values: {}, counter, needsKey: true };
    p = plain;
  }
  const c = new Collector();
  let i = 0;
  while (i < p.length) {
    const ctrl = p[i]!, len = ctrl & 0x1f, fmt = ctrl >> 5;
    if (len < 1 || i + 1 + len > p.length) break;
    const id = p[i + 1]!;
    const vlen = len - 1;
    const def = BTHOME[id];
    if (def && (fmt === 0 || fmt === 1) && vlen >= 1 && vlen <= 4) {
      const raw = readInt(p, i + 2, vlen, fmt === 1);
      if (def[1] === 'packetId') counter ??= raw;
      else if (def[1]) c.add(def[1], round(raw * def[2], 6));
    }
    i += 1 + len;
  }
  return { ...base, ...c.result(), counter };
}

// ---------------- Govee ----------------

const INTELLI_ROCKS = [0x49, 0x4e, 0x54, 0x45, 0x4c, 0x4c, 0x49, 0x5f, 0x52, 0x4f, 0x43, 0x4b, 0x53];
function hasSeq(b: Uint8Array, seq: number[]): boolean {
  outer: for (let i = 0; i + seq.length <= b.length; i++) {
    for (let k = 0; k < seq.length; k++) if (b[i + k] !== seq[k]) continue outer;
    return true;
  }
  return false;
}

/** Govee's packed 3-byte big-endian temperature+humidity, truncated to 0.1 (as the Govee app shows). */
function goveePacked(b: Uint8Array, i: number): { temperature: number; humidity: number } | null {
  let n = (b[i]! << 16) | (b[i + 1]! << 8) | b[i + 2]!;
  const neg = n & 0x800000;
  n &= 0x7fffff;
  const t = (Math.trunc(n / 1000) / 10) * (neg ? -1 : 1);
  const h = (n % 1000) / 10;
  return t < -40 || t > 100 ? null : { temperature: t, humidity: h };
}

export function decodeGovee(company: number, md: Uint8Array, name: string): DecodedAdvert | null {
  let d = md;
  if (d.length > 25 && hasSeq(d, INTELLI_ROCKS)) d = d.subarray(0, d.length - 25); // merged iBeacon
  const n = name.toUpperCase();
  const base = { protocol: 'govee' as const, vendor: 'Govee', encrypted: false };
  const packed = (model: string, at: number, battAt: number): DecodedAdvert => {
    const batt = d[battAt]!;
    const th = batt & 0x80 ? null : goveePacked(d, at);
    return { ...base, model, values: { ...(th ?? {}), battery: batt & 0x7f }, ...(th ? {} : { error: 'Sensor reported an error value' }) };
  };
  const int16 = (model: string, at: number, battAt: number): DecodedAdvert => ({
    ...base, model, values: { temperature: s16le(d, at) / 100, humidity: u16le(d, at + 2) / 100, battery: d[battAt]! },
  });
  if (company === 0xec88) {
    if (d.length === 6) return packed(/H5072/.test(n) ? 'H5072' : /H5129/.test(n) ? 'H5129' : 'H5075', 1, 4);
    if (d.length === 7) return int16('H5074', 1, 5);
    if (d.length === 9) return int16(/H5052/.test(n) ? 'H5052' : /H5071/.test(n) ? 'H5071' : 'H5051', 1, 5);
    return null;
  }
  if (company === 0x8801 && d.length === 9) return int16('H5179', 4, 8);
  if (company !== 0x0001) return null;
  // 0x0001 is Nokia's id that Govee reuses, so the name has to confirm it.
  if (/5140/.test(n) && d.length === 8) {
    const th = goveePacked(d, 2);
    return { ...base, model: 'H5140', values: { ...(th ?? {}), ...(d[7] ? {} : { co2: u16be(d, 5) }) } };
  }
  if (/5112/.test(n) && d.length === 8) {
    const probe = d[7] === 0x82 ? '2' : '1';
    const r = packed('H5112', 2, 5);
    if (probe === '2') return { ...r, values: { battery: r.values.battery }, channels: { '2': { temperature: r.values.temperature } } };
    return r;
  }
  if (/[HB]5178/.test(n) && d.length === 9) {
    const r = packed('H5178', 3, 6);
    return d[2] === 1 ? { ...r, values: { battery: r.values.battery }, channels: { remote: { temperature: r.values.temperature, humidity: r.values.humidity } } } : r;
  }
  const m = /(H5100|H5101|H5102|H5103|H5104|H5105|H5108|H5110|H5174|H5177|GV5179)/.exec(n);
  if (m && (d.length === 6 || d.length === 8)) return packed(m[1]!.replace('GV', 'H'), 2, 5);
  // H5108 also advertises as "GV5108xxxx" and shorter names; govee-ble accepts any 8-byte 0x0001 frame. Require a Govee-style name.
  if (d.length === 8 && /^G/.test(n)) return packed('H5108', 2, 5);
  return null;
}

// ---------------- SwitchBot ----------------

const SWITCHBOT_MODELS: Record<string, string> = { t: 'Meter', i: 'Meter Plus', w: 'Indoor/Outdoor Meter', '4': 'Meter Pro', '5': 'Meter Pro CO2', v: 'Hub 2' };
const HUB2_LUX = [0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 105, 205, 317, 416, 510, 610, 707, 801, 897, 1023, 1091];

function switchbotTH(b: Uint8Array, i: number): { temperature: number; humidity: number } | null {
  const b3 = b[i]!, b4 = b[i + 1]!, b5 = b[i + 2]!;
  if (b3 === 0 && b4 === 0 && b5 === 0) return null;
  const t = ((b4 & 0x80 ? 1 : -1) * ((b4 & 0x7f) * 10 + (b3 & 0x0f))) / 10;
  return { temperature: t, humidity: b5 & 0x7f };
}

export function decodeSwitchbot(sd: Uint8Array | undefined, md: Uint8Array | undefined, opts: DecodeOptions = {}): DecodedAdvert | null {
  let key = sd?.length ? String.fromCharCode(sd[0]! & 0x7f).toLowerCase() : undefined;
  if (key === '\u0014') key = '4';
  if (key === '\u0015') key = '5';
  const model = key ? SWITCHBOT_MODELS[key] : opts.modelHint;
  if (!model || (key && !SWITCHBOT_MODELS[key])) return null; // a SwitchBot, but not a meter
  const base = { protocol: 'switchbot' as const, vendor: 'SwitchBot', model, encrypted: !!(sd && sd[0]! & 0x80) };
  if (base.encrypted) return { ...base, values: {}, needsKey: true };
  const values: MetricValues = {};
  if (sd && sd.length >= 3) values.battery = sd[2]! & 0x7f;
  let th: ReturnType<typeof switchbotTH> = null;
  const isHub = model === 'Hub 2';
  if (md && md.length >= (isHub ? 16 : 11)) th = switchbotTH(md, isHub ? 13 : 8);
  else if (sd && sd.length >= 6 && !isHub) th = switchbotTH(sd, 3);
  if (th) Object.assign(values, th);
  if (isHub && md && md.length >= 13) values.illuminance = HUB2_LUX[md[12]! & 0x1f] ?? undefined;
  if (model === 'Meter Pro CO2' && md && md.length >= 15) {
    const co2 = u16be(md, 13);
    if (co2 <= 9999) values.co2 = co2;
  }
  const mac = md && md.length >= 6 ? [...md.subarray(0, 6)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':') : undefined;
  if (values.illuminance === undefined) delete values.illuminance;
  // All-zero temperature and humidity means the meter has no reading yet.
  return th || values.co2 !== undefined ? { ...base, values, mac } : null;
}

// ---------------- Xiaomi MiBeacon (0xFE95) ----------------

const XIAOMI_PID: Record<number, string> = {
  0x01aa: 'LYWSDCGQ', 0x055b: 'LYWSD03MMC', 0x0387: 'MHO-C401', 0x0347: 'CGG1', 0x0b48: 'CGG1', 0x066f: 'CGDK2', 0x0098: 'HHCCJCY01 (Flower Care)',
  0x015d: 'HHCCPOT002 (Flower Pot)', 0x03bc: 'GCLS002 (Grow Care Garden)', 0x045b: 'LYWSD02', 0x16e4: 'LYWSD02MMC', 0x2542: 'LYWSD02MMC',
  0x2832: 'MJWSD05MMC', 0x4c47: 'MJWSD05MMC', 0x55b5: 'MJWSD06MMC', 0x5bea: 'MJWSD06MMC', 0x4f59: 'CGDK3',
};
/** Plant sensors (soil moisture, conductivity, light). */
export const XIAOMI_PLANT_PIDS = new Set([0x0098, 0x015d, 0x03bc]);

function parseMiObjects(p: Uint8Array): MetricValues {
  const v: MetricValues = {};
  let i = 0;
  while (i + 3 <= p.length) {
    const type = u16le(p, i), len = p[i + 2]!, at = i + 3;
    if (at + len > p.length) break;
    switch (type) {
      case 0x1004: if (len === 2) v.temperature = s16le(p, at) / 10; break;
      case 0x1006: if (len === 2) v.humidity = u16le(p, at) / 10; break;
      case 0x1007: if (len === 3) v.illuminance = u24le(p, at); break;
      case 0x1008: if (len === 1) v.soilMoisture = p[at]!; break;
      case 0x1009: if (len === 2) v.conductivity = u16le(p, at); break;
      case 0x100a: if (len === 1) v.battery = p[at]!; break;
      case 0x100d: if (len === 4) (v.temperature = s16le(p, at) / 10), (v.humidity = u16le(p, at + 2) / 10); break;
      case 0x4801: case 0x4c01: if (len === 4) v.temperature = round(f32le(p, at), 2); break;
      case 0x4802: case 0x4c02: if (len === 1) v.humidity = p[at]!; break;
      case 0x4803: case 0x4c03: if (len === 1) v.battery = p[at]!; break;
      case 0x4808: case 0x4c08: if (len === 4) v.humidity = round(f32le(p, at), 1); break;
      default: break;
    }
    i = at + len;
  }
  return v;
}

export function decodeMiBeacon(sd: Uint8Array, opts: DecodeOptions = {}): DecodedAdvert | null {
  if (sd.length < 5) return null;
  const fc = u16le(sd, 0), version = fc >> 12, pid = u16le(sd, 2), frame = sd[4]!;
  if (version < 2 || fc & 0x80) return null; // too old, or mesh
  const model = XIAOMI_PID[pid] ?? `Xiaomi 0x${pid.toString(16).padStart(4, '0')}`;
  const encrypted = !!(fc & 0x08);
  let i = 5;
  let mac: string | undefined;
  if (fc & 0x10) {
    if (sd.length < 11) return null;
    mac = macDisplay(sd.subarray(5, 11));
    i = 11;
  }
  if (fc & 0x20) {
    const cap = sd[i++]!;
    if (cap & 0x20) i++;
  }
  const base = { protocol: 'xiaomi' as const, vendor: 'Xiaomi', model, encrypted, mac, counter: frame };
  if (!(fc & 0x40)) return { ...base, values: {} };
  let payload = sd.subarray(i);
  const useMac = mac ?? opts.mac;
  if (encrypted) {
    if (!opts.key || !useMac) return { ...base, values: {}, needsKey: true };
    if (version >= 4) {
      if (sd.length < i + 7) return null;
      const ext = sd.subarray(sd.length - 7, sd.length - 4);
      const nonce = concat(macBytesOnAir(useMac), sd.subarray(2, 5), ext);
      const plain = ccmDecrypt(opts.key, nonce, sd.subarray(i, sd.length - 7), sd.subarray(sd.length - 4), new Uint8Array([0x11]));
      if (!plain) return { ...base, values: {}, needsKey: true };
      payload = plain;
      base.counter = (u24le(ext, 0) * 256 + frame) >>> 0;
    } else {
      // v2/v3 legacy: 12-byte key expanded, no authentication; sanity-check the objects instead.
      if (opts.key.length !== 12) return { ...base, values: {}, needsKey: true };
      const k = concat(opts.key.subarray(0, 6), new Uint8Array([0x8d, 0x3d, 0x3c, 0x97]), opts.key.subarray(6));
      const nonce = concat(sd.subarray(0, 5), sd.subarray(sd.length - 4, sd.length - 1), macBytesOnAir(useMac).subarray(0, 5));
      payload = ccmCtrOnly(k, nonce, sd.subarray(i, sd.length - 4));
    }
  }
  return { ...base, values: parseMiObjects(payload) };
}

// ---------------- ATC1441 / pvvx custom firmware (0x181A) ----------------

export function decodeAtc(sd: Uint8Array, opts: DecodeOptions = {}): DecodedAdvert | null {
  const base = { protocol: 'atc' as const, vendor: 'Xiaomi (custom firmware)', model: 'LYWSD03MMC (ATC/pvvx)' };
  if (sd.length === 13) {
    return {
      ...base, encrypted: false, mac: [...sd.subarray(0, 6)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':'), counter: sd[12],
      values: { temperature: s16be(sd, 6) / 10, humidity: sd[8]!, battery: sd[9]!, voltage: u16be(sd, 10) / 1000 },
    };
  }
  if (sd.length === 15) {
    return {
      ...base, encrypted: false, mac: macDisplay(sd.subarray(0, 6)), counter: sd[13],
      values: { temperature: s16le(sd, 6) / 100, humidity: u16le(sd, 8) / 100, voltage: u16le(sd, 10) / 1000, battery: sd[12]! },
    };
  }
  if (sd.length === 8 || sd.length === 11) {
    const counter = sd[0]!;
    if (!opts.key || !opts.mac) return { ...base, encrypted: true, values: {}, counter, needsKey: true };
    // The nonce includes the raw AD header (length, type 0x16, UUID), rebuilt from the service data.
    const nonce = concat(macBytesOnAir(opts.mac), new Uint8Array([sd.length + 3, 0x16, 0x1a, 0x18, counter]));
    const plain = ccmDecrypt(opts.key, nonce, sd.subarray(1, sd.length - 4), sd.subarray(sd.length - 4), new Uint8Array([0x11]));
    if (!plain) return { ...base, encrypted: true, values: {}, counter, needsKey: true };
    const values: MetricValues = plain.length === 3
      ? { temperature: plain[0]! / 2 - 40, humidity: plain[1]! / 2, battery: plain[2]! & 0x7f }
      : { temperature: s16le(plain, 0) / 100, humidity: u16le(plain, 2) / 100, battery: plain[4]! };
    return { ...base, encrypted: true, values, counter };
  }
  return null;
}

// ---------------- Qingping (0xFDCD) ----------------

const QINGPING_TYPES: Record<number, string> = {
  0x01: 'CGG1', 0x07: 'CGG1', 0x16: 'CGG1', 0x4f: 'CGG3', 0x09: 'CGP1W', 0x0c: 'CGD1', 0x0e: 'CGDN1', 0x24: 'CGDN1', 0x0f: 'CGM1', 0x12: 'CGPR1',
  0x15: 'CGF1W', 0x18: 'CGP23W', 0x26: 'CGP23W', 0x1e: 'CGC1', 0x33: 'CGP22C', 0x5d: 'CGP22C', 0x04: 'CGH1',
};

export function decodeQingping(sd: Uint8Array): DecodedAdvert | null {
  if (sd.length < 8) return null;
  const event = !!(sd[0]! & 0x40);
  const model = QINGPING_TYPES[sd[1]!] ?? `Qingping 0x${sd[1]!.toString(16)}`;
  const v: MetricValues = {};
  let i = 8;
  while (i + 2 <= sd.length) {
    const id = sd[i]!, len = sd[i + 1]!, at = i + 2;
    if (at + len > sd.length) break;
    if (id === 0x01 && len === 4) (v.temperature = s16le(sd, at) / 10), (v.humidity = u16le(sd, at + 2) / 10);
    else if (id === 0x02 && len === 1) v.battery = sd[at]!;
    else if (id === 0x07 && len === 2) v.pressure = u16le(sd, at) / 10;
    else if (id === 0x08 && len === 4 && !event) v.illuminance = u24le(sd, at + 1);
    else if (id === 0x09 && len === 4) v.illuminance = u32le(sd, at);
    else if (id === 0x12 && len === 4) v.pm25 = u16le(sd, at);
    else if (id === 0x13 && len === 2) v.co2 = u16le(sd, at);
    i = at + len;
  }
  return { protocol: 'qingping', vendor: 'Qingping', model, encrypted: false, mac: macDisplay(sd.subarray(2, 8)), values: v };
}

// ---------------- Inkbird ----------------

export function decodeInkbird(raw: Uint8Array, name: string): DecodedAdvert | null {
  const n = name.toLowerCase();
  const base = { protocol: 'inkbird' as const, vendor: 'Inkbird', encrypted: false };
  if ((n === 'sps' || n === 'tps') && raw.length === 9) {
    // No real company id: the first two bytes are the temperature.
    const hRaw = u16le(raw, 2), batt = raw[7]!;
    const hasHum = !(n === 'tps' && (hRaw === 0 || hRaw === 0xffff));
    if (batt > 100 || (hasHum && hRaw > 10000)) return null;
    return { ...base, model: n === 'sps' ? 'IBS-TH' : 'IBS-TH2/P01B', values: { temperature: s16le(raw, 0) / 100, ...(hasHum ? { humidity: hRaw / 100 } : {}), battery: batt } };
  }
  if (/^(ith-1[13]-b|ith-21-b|ibs-p02b)/.test(n) && raw.length === 18 && u16le(raw, 0) === 0x2449) {
    const h = u16le(raw, 8);
    return { ...base, model: name.toUpperCase(), values: { temperature: s16le(raw, 6) / 10, ...(h ? { humidity: h / 10 } : {}), battery: raw[10]! } };
  }
  return null;
}

// ---------------- RuuviTag (data format 5) ----------------

export function decodeRuuvi(md: Uint8Array): DecodedAdvert | null {
  if (md.length < 24 || md[0] !== 0x05) return null;
  const v: MetricValues = {};
  const t = s16be(md, 1), h = u16be(md, 3), p = u16be(md, 5), pw = u16be(md, 13);
  if (t !== -0x8000) v.temperature = round(t * 0.005, 3);
  if (h !== 0xffff) v.humidity = round(h * 0.0025, 4);
  if (p !== 0xffff) v.pressure = round((p + 50000) / 100, 2);
  if (pw >> 5 !== 2047) v.voltage = ((pw >> 5) + 1600) / 1000;
  const seq = u16be(md, 16);
  const macB = md.subarray(18, 24);
  const mac = macB.every((x) => x === 0xff) ? undefined : [...macB].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  return { protocol: 'ruuvi', vendor: 'Ruuvi', model: 'RuuviTag', encrypted: false, values: v, mac, ...(seq !== 0xffff ? { counter: seq } : {}) };
}

// ---------------- Dispatcher ----------------

/** Decode any supported advertisement, or null if it isn't a sensor we know. */
export function decodeAdvertisement(adv: Advertisement, opts: DecodeOptions = {}): DecodedAdvert | null {
  const name = adv.name ?? '';
  let sd: Uint8Array | undefined;
  if ((sd = service(adv, 'fcd2'))) return decodeBthomeV2(sd, opts);
  if ((sd = service(adv, '181c'))) return decodeBthomeV1(sd, false, opts);
  if ((sd = service(adv, '181e'))) return decodeBthomeV1(sd, true, opts);
  if ((sd = service(adv, 'fe95'))) return decodeMiBeacon(sd, opts);
  if ((sd = service(adv, '181a'))) return decodeAtc(sd, opts);
  if ((sd = service(adv, 'fdcd'))) return decodeQingping(sd);
  const md = adv.manufacturerData ?? undefined;
  const company = md && md.length >= 2 ? u16le(md, 0) : -1;
  const sb = service(adv, 'fd3d') ?? service(adv, '0d00');
  if (sb || company === 0x0969) return decodeSwitchbot(sb, company === 0x0969 ? md!.subarray(2) : undefined, opts);
  if (!md || md.length < 2) return null;
  if (company === 0x0499) return decodeRuuvi(md.subarray(2));
  if (/^(sps|tps|ith-|ibs-p02b)/i.test(name)) return decodeInkbird(md, name);
  if (company === 0xec88 || company === 0x8801 || company === 0x0001) return decodeGovee(company, md.subarray(2), name);
  return null;
}

/** Stable identity for a decoded device: the MAC when the payload carries one, else the platform id. */
export function deviceKey(adv: Advertisement, d: DecodedAdvert): string {
  return `${d.protocol}:${(d.mac ?? adv.id).toUpperCase()}`;
}
