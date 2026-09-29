/**
 * Home weather stations (§8.2, §8.3), using the owner's own free keys, called from the phone, never
 * cached (keys are in the URLs), and normalized to the app's canonical units:
 *  - Ecowitt Cloud API v3 (application key + API key + MAC; current and history backfill)
 *  - Ambient Weather Network REST (application key + API key, both created by the user)
 *  - Davis WeatherLink v2 (API key + secret header; history needs the user's WeatherLink Pro plan)
 *  - Local network: Ecowitt gateway HTTP, WeatherLink Live HTTP, Tempest UDP broadcast (parser here;
 *    the socket lives in the app). Only private/LAN addresses are accepted for local mode.
 * Tempest's cloud API is not used: WeatherFlow's terms require a commercial agreement for commercial
 * apps (see DATA_SOURCES.md). The local broadcast is exempt.
 */
import { dewPointC, sourced, unavailable, type Layer, type Metric, type MetricValues } from '@plotwright/core';
import type { HttpClient } from './http';
import { qs } from './qs';

export interface StationChannel {
  /** 'outdoor', 'soil1', 'temp1', 'th1', 'leaf1'… Indoor readings are left out. */
  channel: string;
  label: string;
  values: MetricValues;
}

export interface StationObservation {
  /** UTC ms. */
  t: number;
  channels: StationChannel[];
}

export interface StationDevice {
  id: string;
  name: string;
  /** IANA time zone if the service reports it. */
  timeZone?: string;
  last?: StationObservation;
}

// ---------------- units ----------------

/** Split "3.2 m/s" / "65%" / "29.40 inHg" into number and unit. */
export function valUnit(s: unknown, unitField?: string): [number, string] | null {
  if (typeof s === 'number') return Number.isFinite(s) ? [s, unitField ?? ''] : null;
  if (typeof s !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(s);
  if (!m) return null;
  return [Number(m[1]), (m[2] || unitField || '').trim()];
}

/** Convert a value in a vendor unit to the canonical unit for `metric`. Solar in lux becomes illuminance. */
export function toCanonical(metric: Metric, v: number, unit: string): [Metric, number] {
  const u = unit.toLowerCase().replace(/\s+/g, '');
  switch (metric) {
    case 'temperature': case 'dewPoint': case 'soilTemperature':
      return [metric, /f|℉/.test(u) ? ((v - 32) * 5) / 9 : v];
    case 'pressure':
      return [metric, /inhg/.test(u) ? v * 33.8639 : /mmhg/.test(u) ? v * 1.33322 : /kpa/.test(u) ? v * 10 : v];
    case 'windSpeed': case 'windGust':
      return [metric, /mph/.test(u) ? v * 0.44704 : /km\/?h|kph/.test(u) ? v / 3.6 : /kn/.test(u) ? v * 0.514444 : /fpm/.test(u) ? v * 0.00508 : v];
    case 'rainRate': case 'rainDaily': case 'rainTotal': case 'rain':
      return [metric, /^in/.test(u) ? v * 25.4 : v];
    case 'solarRadiation':
      if (/klux/.test(u)) return ['illuminance', v * 1000];
      if (/lux|lx/.test(u)) return ['illuminance', v];
      if (/fc/.test(u)) return ['illuminance', v * 10.764];
      return [metric, v];
    default:
      return [metric, v];
  }
}

const F = (f: number) => ((f - 32) * 5) / 9;
const MPH = 0.44704;
const IN = 25.4;
const INHG = 33.8639;

function put(ch: Map<string, StationChannel>, channel: string, label: string, metric: Metric, v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return;
  const c = ch.get(channel) ?? { channel, label, values: {} };
  c.values[metric] = v;
  ch.set(channel, c);
}

function withDewPoint(ch: StationChannel): StationChannel {
  const v = ch.values;
  if (v.dewPoint === undefined && v.temperature !== undefined && v.humidity !== undefined) v.dewPoint = dewPointC(v.temperature, v.humidity);
  return ch;
}

const channelLabel = (kind: string, n: string) =>
  ({ soil: `Soil sensor ${n}`, temp: `Temperature probe ${n}`, th: `Temp/humidity sensor ${n}`, leaf: `Leaf wetness ${n}` } as Record<string, string>)[kind] ?? `${kind} ${n}`;

// ---------------- Ecowitt Cloud API v3 ----------------

export interface EcowittKeys { applicationKey: string; apiKey: string; mac: string }
export const ECOWITT_SOURCE = 'Ecowitt Cloud API (your account)';
const ECOWITT = 'https://api.ecowitt.net/api/v3';
/** Request metric units explicitly (°C, hPa, m/s, mm, W/m²); every value's unit string is still checked. */
const ECOWITT_UNITS = { temp_unitid: 1, pressure_unitid: 3, wind_speed_unitid: 6, rainfall_unitid: 12, solar_irradiance_unitid: 16 };

interface EcowittEnvelope<T> { code: number; msg?: string; data?: T }
type EcowittLeaf = { time?: string; unit?: string; value?: string };
type EcowittHist = { unit?: string; list?: Record<string, string> };

/** Map an Ecowitt group/field to a channel and metric. */
function ecowittTarget(group: string, field: string): [string, string, Metric] | null {
  const g = /^(soil|temp_and_humidity|temp|leaf)_ch(\d+)$/.exec(group);
  if (g) {
    const kind = g[1] === 'temp_and_humidity' ? 'th' : g[1]!;
    const metric: Metric | undefined = field === 'soilmoisture' ? 'soilMoisture' : field === 'temperature' ? 'temperature' : field === 'humidity' ? 'humidity' : field === 'leaf_wetness' ? 'leafWetness' : undefined;
    return metric ? [`${kind}${g[2]}`, channelLabel(kind, g[2]!), metric] : null;
  }
  const map: Record<string, Metric> = {
    'outdoor.temperature': 'temperature', 'outdoor.humidity': 'humidity', 'outdoor.dew_point': 'dewPoint', 'pressure.relative': 'pressure',
    'wind.wind_speed': 'windSpeed', 'wind.wind_gust': 'windGust', 'wind.wind_direction': 'windDirection', 'rainfall.rain_rate': 'rainRate',
    'rainfall.daily': 'rainDaily', 'rainfall_piezo.rain_rate': 'rainRate', 'rainfall_piezo.daily': 'rainDaily', 'solar_and_uvi.solar': 'solarRadiation',
    'solar_and_uvi.uvi': 'uvIndex',
  };
  const m = map[`${group}.${field}`];
  return m ? ['outdoor', 'Outdoor', m] : null;
}

function ecowittCheck<T>(env: EcowittEnvelope<T>): T {
  if (env.code !== 0) throw new Error(env.code === 40010 || env.code === 40011 || env.code === 40012 ? 'Ecowitt rejected the keys or MAC' : `Ecowitt error ${env.code}${env.msg ? `: ${env.msg}` : ''}`);
  return env.data as T;
}

export function parseEcowittRealtime(data: Record<string, Record<string, EcowittLeaf>>): StationObservation {
  const ch = new Map<string, StationChannel>();
  let t = 0;
  const hasTipping = !!data.rainfall;
  for (const [group, fields] of Object.entries(data ?? {})) {
    if (group === 'rainfall_piezo' && hasTipping) continue;
    for (const [field, leaf] of Object.entries(fields ?? {})) {
      const target = ecowittTarget(group, field);
      const vu = valUnit(leaf?.value, leaf?.unit);
      if (!target || !vu) continue;
      const [metric, value] = toCanonical(target[2], vu[0], vu[1]);
      put(ch, target[0], target[1], metric, value);
      t = Math.max(t, Number(leaf.time ?? 0) * 1000);
    }
  }
  return { t: t || Date.now(), channels: [...ch.values()].map(withDewPoint) };
}

export function parseEcowittHistory(data: Record<string, Record<string, EcowittHist>>): StationObservation[] {
  const byT = new Map<number, Map<string, StationChannel>>();
  const hasTipping = !!data.rainfall;
  for (const [group, fields] of Object.entries(data ?? {})) {
    if (group === 'rainfall_piezo' && hasTipping) continue;
    for (const [field, h] of Object.entries(fields ?? {})) {
      const target = ecowittTarget(group, field);
      if (!target || !h?.list) continue;
      for (const [ts, raw] of Object.entries(h.list)) {
        const vu = valUnit(raw, h.unit);
        if (!vu) continue;
        const t = Number(ts) * 1000;
        const ch = byT.get(t) ?? new Map<string, StationChannel>();
        byT.set(t, ch);
        const [metric, value] = toCanonical(target[2], vu[0], vu[1]);
        put(ch, target[0], target[1], metric, value);
      }
    }
  }
  return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, ch]) => ({ t, channels: [...ch.values()].map(withDewPoint) }));
}

const ecowittAttribution = (storedAt: number) => ({
  source: ECOWITT_SOURCE, license: 'Your own station data', confidence: 'high' as const, basis: 'measured' as const,
  retrievedAt: new Date(storedAt).toISOString(), url: 'https://www.ecowitt.net/',
});

export async function ecowittRealtime(http: HttpClient, k: EcowittKeys): Promise<Layer<StationObservation>> {
  try {
    const url = `${ECOWITT}/device/real_time?${qs({ application_key: k.applicationKey, api_key: k.apiKey, mac: k.mac, call_back: 'all', ...ECOWITT_UNITS })}`;
    const r = await http.json<EcowittEnvelope<Record<string, Record<string, EcowittLeaf>>>>(url, { ttlMs: 0 });
    return sourced(parseEcowittRealtime(ecowittCheck(r.data)), ecowittAttribution(r.storedAt));
  } catch (e) {
    return unavailable(ECOWITT_SOURCE, `Couldn't read your Ecowitt station (${(e as Error).message}).`, true);
  }
}

export const ECOWITT_HISTORY_GROUPS = 'outdoor,wind,pressure,rainfall,rainfall_piezo,solar_and_uvi,soil_ch1,soil_ch2,soil_ch3,soil_ch4,soil_ch5,soil_ch6,soil_ch7,soil_ch8,temp_ch1,temp_ch2,temp_ch3,temp_ch4,temp_and_humidity_ch1,temp_and_humidity_ch2,temp_and_humidity_ch3,temp_and_humidity_ch4,leaf_ch1,leaf_ch2';

/** "YYYY-MM-DD HH:mm:ss" in the station's local time, which is how Ecowitt reads start/end dates. */
export function ecowittDate(utcMs: number, offsetMin: number): string {
  const d = new Date(utcMs + offsetMin * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * History for one window (keep it to ≤ 1 day for 5-minute data). Ecowitt keeps 5-minute data for
 * ~3 months, 30-minute for ~1 year, 4-hour for ~2 years, so the app keeps its own copy.
 */
export async function ecowittHistory(http: HttpClient, k: EcowittKeys, startUtc: number, endUtc: number, offsetMin: number, cycle: '5min' | '30min' | '4hour' | '1day' = '5min'): Promise<StationObservation[]> {
  const url = `${ECOWITT}/device/history?${qs({
    application_key: k.applicationKey, api_key: k.apiKey, mac: k.mac, start_date: ecowittDate(startUtc, offsetMin), end_date: ecowittDate(endUtc, offsetMin),
    cycle_type: cycle, call_back: ECOWITT_HISTORY_GROUPS, ...ECOWITT_UNITS,
  })}`;
  const r = await http.json<EcowittEnvelope<Record<string, Record<string, EcowittHist>> | []>>(url, { ttlMs: 0 });
  const data = ecowittCheck(r.data);
  return Array.isArray(data) ? [] : parseEcowittHistory(data);
}

// ---------------- Ambient Weather ----------------

export interface AmbientKeys { applicationKey: string; apiKey: string }
export const AMBIENT_SOURCE = 'Ambient Weather Network (your account)';
const AMBIENT = 'https://rt.ambientweather.net/v1';

type AmbientRecord = Record<string, number | string | undefined> & { dateutc?: number; tz?: string };

/** Ambient returns imperial units only. */
export function parseAmbientRecord(r: AmbientRecord): StationObservation {
  const ch = new Map<string, StationChannel>();
  const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : undefined);
  const o = (m: Metric, v: number | undefined) => put(ch, 'outdoor', 'Outdoor', m, v);
  const f = n('tempf'); o('temperature', f === undefined ? undefined : F(f));
  o('humidity', n('humidity'));
  const dp = n('dewPoint'); o('dewPoint', dp === undefined ? undefined : F(dp));
  const bar = n('baromrelin'); o('pressure', bar === undefined ? undefined : bar * INHG);
  const ws = n('windspeedmph'); o('windSpeed', ws === undefined ? undefined : ws * MPH);
  const wg = n('windgustmph'); o('windGust', wg === undefined ? undefined : wg * MPH);
  o('windDirection', n('winddir'));
  const rr = n('hourlyrainin'); o('rainRate', rr === undefined ? undefined : rr * IN); // Ambient's "hourly rain" is the rate, in/hr
  const dr = n('dailyrainin'); o('rainDaily', dr === undefined ? undefined : dr * IN);
  o('solarRadiation', n('solarradiation'));
  o('uvIndex', n('uv'));
  for (let i = 1; i <= 10; i++) {
    const sm = n(`soilhum${i}`), st = n(`soiltemp${i}f`), tf = n(`temp${i}f`), h = n(`humidity${i}`), lw = n(`leafwetness${i}`);
    if (sm !== undefined) put(ch, `soil${i}`, channelLabel('soil', String(i)), 'soilMoisture', sm);
    if (st !== undefined) put(ch, `soil${i}`, channelLabel('soil', String(i)), 'soilTemperature', F(st));
    if (tf !== undefined) put(ch, `th${i}`, channelLabel('th', String(i)), 'temperature', F(tf));
    if (h !== undefined) put(ch, `th${i}`, channelLabel('th', String(i)), 'humidity', h);
    if (lw !== undefined) put(ch, `leaf${i}`, channelLabel('leaf', String(i)), 'leafWetness', lw);
  }
  return { t: typeof r.dateutc === 'number' ? r.dateutc : Date.now(), channels: [...ch.values()].map(withDewPoint) };
}

export async function ambientDevices(http: HttpClient, k: AmbientKeys): Promise<Layer<StationDevice[]>> {
  try {
    const r = await http.json<Array<{ macAddress: string; info?: { name?: string }; lastData?: AmbientRecord }>>(`${AMBIENT}/devices?${qs({ applicationKey: k.applicationKey, apiKey: k.apiKey })}`, { ttlMs: 0 });
    const devices = r.data.map((d) => ({
      id: d.macAddress, name: d.info?.name ?? d.macAddress, timeZone: typeof d.lastData?.tz === 'string' ? d.lastData.tz : undefined,
      last: d.lastData ? parseAmbientRecord(d.lastData) : undefined,
    }));
    return sourced(devices, { source: AMBIENT_SOURCE, license: 'Your own station data', confidence: 'high', basis: 'measured', retrievedAt: new Date(r.storedAt).toISOString(), url: 'https://ambientweather.net/' });
  } catch (e) {
    return unavailable(AMBIENT_SOURCE, `Couldn't read your Ambient Weather account (${(e as Error).message}).`, true);
  }
}

/** Up to 288 records ending at `endMs`, newest first from Ambient; returned oldest first. Ambient keeps one year. */
export async function ambientHistory(http: HttpClient, k: AmbientKeys, mac: string, endMs: number, limit = 288): Promise<StationObservation[]> {
  const r = await http.json<AmbientRecord[]>(`${AMBIENT}/devices/${encodeURIComponent(mac)}?${qs({ applicationKey: k.applicationKey, apiKey: k.apiKey, endDate: endMs, limit })}`, { ttlMs: 0 });
  return r.data.map(parseAmbientRecord).sort((a, b) => a.t - b.t);
}

// ---------------- Davis WeatherLink v2 ----------------

export interface WeatherLinkKeys { apiKey: string; apiSecret: string; stationId: string }
export const WEATHERLINK_SOURCE = 'Davis WeatherLink (your account)';
const WEATHERLINK = 'https://api.weatherlink.com/v2';

type WlRecord = Record<string, number | null | undefined>;

/**
 * Davis records share field names across the WeatherLink Live, console and cloud APIs (°F, mph, inHg,
 * soil moisture in centibars). Rain comes as bucket "clicks" locally (× rain_size) and also as _in/_mm
 * in the cloud API. Archive records use _avg/_last/_hi variants.
 */
export function parseDavisRecord(r: WlRecord, ch: Map<string, StationChannel>): void {
  const g = (...keys: string[]) => { for (const k of keys) { const v = r[k]; if (typeof v === 'number') return v; } return undefined; };
  const o = (m: Metric, v: number | undefined) => put(ch, 'outdoor', 'Outdoor', m, v);
  const tf = g('temp', 'temp_out', 'temp_avg', 'temp_last'); o('temperature', tf === undefined ? undefined : F(tf));
  o('humidity', g('hum', 'hum_out', 'hum_last'));
  const dp = g('dew_point', 'dew_point_last'); o('dewPoint', dp === undefined ? undefined : F(dp));
  const ws = g('wind_speed_avg_last_1_min', 'wind_speed_avg_last_2_min', 'wind_speed_avg', 'wind_speed_last', 'wind_speed'); o('windSpeed', ws === undefined ? undefined : ws * MPH);
  const wg = g('wind_speed_hi_last_2_min', 'wind_speed_hi_last_10_min', 'wind_speed_hi', 'wind_gust_10_min'); o('windGust', wg === undefined ? undefined : wg * MPH);
  o('windDirection', g('wind_dir_scalar_avg_last_1_min', 'wind_dir_scalar_avg_last_2_min', 'wind_dir_of_prevail', 'wind_dir_last', 'wind_dir'));
  o('solarRadiation', g('solar_rad', 'solar_rad_avg'));
  o('uvIndex', g('uv_index', 'uv_index_avg', 'uv'));
  const bar = g('bar_sea_level', 'bar', 'bar_absolute'); if (bar !== undefined) o('pressure', bar * INHG);
  // Rain: prefer explicit mm/in fields, else clicks × bucket size.
  const size = r.rain_size;
  const clickMm = size === 1 ? 0.254 : size === 2 ? 0.2 : size === 3 ? 0.1 : size === 4 ? 0.0254 : undefined;
  const mm = (base: string) => {
    const vmm = g(`${base}_mm`); if (vmm !== undefined) return vmm;
    const vin = g(`${base}_in`); if (vin !== undefined) return vin * IN;
    const c = g(base, `${base}_clicks`); return c !== undefined && clickMm !== undefined ? c * clickMm : undefined;
  };
  o('rainRate', mm('rain_rate_last'));
  o('rainDaily', mm('rainfall_daily'));
  const interval = mm('rainfall'); if (interval !== undefined) o('rain', interval);
  for (let i = 1; i <= 4; i++) {
    const st = g(`temp_${i}`, `temp_last_${i}`), sm = g(`moist_soil_${i}`, `moist_soil_last_${i}`), lw = g(`wet_leaf_${i}`, `wet_leaf_last_${i}`);
    if (st !== undefined) put(ch, `soil${i}`, channelLabel('soil', String(i)), 'soilTemperature', F(st));
    if (sm !== undefined) put(ch, `soil${i}`, channelLabel('soil', String(i)), 'soilTension', sm); // centibars = kPa
    if (lw !== undefined && i <= 2) put(ch, `leaf${i}`, channelLabel('leaf', String(i)), 'leafWetness', lw);
  }
}

interface WlCurrent { station_id?: number; sensors?: Array<{ lsid: number; sensor_type: number; data_structure_type: number; data: Array<WlRecord & { ts?: number }> }>; generated_at?: number }

/** Health and indoor structure types carry nothing for the garden. */
const WL_SKIP_TYPES = new Set([15, 21, 22]);

export function parseWeatherLinkCurrent(body: WlCurrent): StationObservation {
  const ch = new Map<string, StationChannel>();
  let t = 0;
  for (const s of body.sensors ?? []) {
    if (WL_SKIP_TYPES.has(s.data_structure_type)) continue;
    for (const rec of s.data ?? []) {
      parseDavisRecord(rec, ch);
      t = Math.max(t, (rec.ts ?? 0) * 1000);
    }
  }
  return { t: t || (body.generated_at ?? 0) * 1000 || Date.now(), channels: [...ch.values()].map(withDewPoint) };
}

export function parseWeatherLinkHistoric(body: WlCurrent): StationObservation[] {
  const byT = new Map<number, Map<string, StationChannel>>();
  for (const s of body.sensors ?? []) {
    if (WL_SKIP_TYPES.has(s.data_structure_type)) continue;
    for (const rec of s.data ?? []) {
      if (!rec.ts) continue;
      const m = byT.get(rec.ts * 1000) ?? new Map<string, StationChannel>();
      byT.set(rec.ts * 1000, m);
      parseDavisRecord(rec, m);
    }
  }
  return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, m]) => ({ t, channels: [...m.values()].map(withDewPoint) }));
}

const wlHeaders = (k: WeatherLinkKeys) => ({ 'X-Api-Secret': k.apiSecret });

export async function weatherLinkStations(http: HttpClient, k: Omit<WeatherLinkKeys, 'stationId'>): Promise<StationDevice[]> {
  const r = await http.json<{ stations?: Array<{ station_id: number; station_name?: string; time_zone?: string }> }>(`${WEATHERLINK}/stations?${qs({ 'api-key': k.apiKey })}`, { ttlMs: 0, headers: { 'X-Api-Secret': k.apiSecret } });
  return (r.data.stations ?? []).map((s) => ({ id: String(s.station_id), name: s.station_name ?? String(s.station_id), timeZone: s.time_zone }));
}

export async function weatherLinkCurrent(http: HttpClient, k: WeatherLinkKeys): Promise<Layer<StationObservation>> {
  try {
    const r = await http.json<WlCurrent>(`${WEATHERLINK}/current/${encodeURIComponent(k.stationId)}?${qs({ 'api-key': k.apiKey })}`, { ttlMs: 0, headers: wlHeaders(k) });
    return sourced(parseWeatherLinkCurrent(r.data), {
      source: WEATHERLINK_SOURCE, license: 'Your own station data', confidence: 'high', basis: 'measured', retrievedAt: new Date(r.storedAt).toISOString(),
      notes: ['On the free WeatherLink plan the latest reading can be up to 15 minutes old.'], url: 'https://www.weatherlink.com/',
    });
  } catch (e) {
    return unavailable(WEATHERLINK_SOURCE, `Couldn't read your WeatherLink station (${(e as Error).message}).`, true);
  }
}

/** Archive records for ≤ 24 h. Needs a WeatherLink Pro or Pro+ plan on the station (the user's, not ours). */
export async function weatherLinkHistoric(http: HttpClient, k: WeatherLinkKeys, startUtc: number, endUtc: number): Promise<StationObservation[]> {
  const s = Math.floor(startUtc / 1000), e = Math.min(Math.floor(endUtc / 1000), s + 86_400);
  const r = await http.json<WlCurrent>(`${WEATHERLINK}/historic/${encodeURIComponent(k.stationId)}?${qs({ 'api-key': k.apiKey, 'start-timestamp': s, 'end-timestamp': e })}`, { ttlMs: 0, headers: wlHeaders(k) });
  return parseWeatherLinkHistoric(r.data);
}

// ---------------- Local network ----------------

/** Only addresses on the home network are allowed for local mode (RFC 1918, link-local, .local names). */
export function isLocalAddress(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [+m[1]!, +m[2]!];
  if ([+m[1]!, +m[2]!, +m[3]!, +m[4]!].some((x) => x > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

const localUrl = (host: string, path: string) => {
  if (!isLocalAddress(host)) throw new Error('Local mode only connects to addresses on your home network (e.g. 192.168.1.20).');
  return `http://${host.trim()}${path}`;
};

export const LOCAL_SOURCE = 'Your station on the local network';

type EcoLocal = {
  common_list?: Array<{ id: string; val: string; unit?: string }>;
  rain?: Array<{ id: string; val: string }>;
  piezoRain?: Array<{ id: string; val: string }>;
  wh25?: Array<{ rel?: string; abs?: string }>;
  ch_soil?: Array<{ channel: string; humidity?: string }>;
  ch_temp?: Array<{ channel: string; temp?: string; unit?: string }>;
  ch_aisle?: Array<{ channel: string; temp?: string; unit?: string; humidity?: string }>;
  ch_leaf?: Array<{ channel: string; humidity?: string }>;
};

/** Ecowitt gateway `get_livedata_info` (GW1100/GW2000/GW3000 and consoles). No timestamp: `now` is used. */
export function parseEcowittLocal(d: EcoLocal, now: number): StationObservation {
  const ch = new Map<string, StationChannel>();
  const o = (metric: Metric, raw: string | undefined, unit?: string) => {
    const vu = valUnit(raw, unit);
    if (!vu) return;
    const [m, v] = toCanonical(metric, vu[0], vu[1]);
    put(ch, 'outdoor', 'Outdoor', m, v);
  };
  const ids: Record<string, Metric> = { '0x02': 'temperature', '0x07': 'humidity', '0x03': 'dewPoint', '0x0A': 'windDirection', '0x0B': 'windSpeed', '0x0C': 'windGust', '0x15': 'solarRadiation', '0x17': 'uvIndex' };
  for (const c of d.common_list ?? []) {
    const m = ids[c.id.length === 4 ? `0x${c.id.slice(2).toUpperCase()}` : c.id];
    if (m) o(m, c.val, c.unit);
  }
  for (const r of d.rain?.length ? d.rain : d.piezoRain ?? []) {
    const id = `0x${r.id.slice(2).toUpperCase()}`;
    if (id === '0x0E') o('rainRate', r.val.replace(/\/hr?$/i, ''));
    if (id === '0x10') o('rainDaily', r.val);
  }
  const rel = d.wh25?.[0]?.rel;
  if (rel) o('pressure', rel);
  const channel = (kind: string, n: string, metric: Metric, raw: string | undefined, unit?: string) => {
    const vu = valUnit(raw, unit);
    if (!vu) return;
    const [m, v] = toCanonical(metric, vu[0], vu[1]);
    put(ch, `${kind}${n}`, channelLabel(kind, n), m, v);
  };
  for (const s of d.ch_soil ?? []) channel('soil', s.channel, 'soilMoisture', s.humidity);
  for (const s of d.ch_temp ?? []) channel('temp', s.channel, 'temperature', s.temp, s.unit);
  for (const s of d.ch_aisle ?? []) (channel('th', s.channel, 'temperature', s.temp, s.unit), channel('th', s.channel, 'humidity', s.humidity));
  for (const s of d.ch_leaf ?? []) channel('leaf', s.channel, 'leafWetness', s.humidity);
  return { t: now, channels: [...ch.values()].map(withDewPoint) };
}

export async function ecowittLocal(http: HttpClient, host: string, now = Date.now()): Promise<Layer<StationObservation>> {
  try {
    const r = await http.json<EcoLocal>(localUrl(host, '/get_livedata_info'), { ttlMs: 0 });
    return sourced(parseEcowittLocal(r.data, now), { source: LOCAL_SOURCE, license: 'Your own station data', confidence: 'high', basis: 'measured', retrievedAt: new Date(now).toISOString() });
  } catch (e) {
    return unavailable(LOCAL_SOURCE, `Couldn't reach the gateway at ${host} (${(e as Error).message}). Is the phone on the same Wi-Fi?`, true);
  }
}

type WllLocal = { data?: { did?: string; ts?: number; conditions?: Array<WlRecord & { data_structure_type: number }> }; error?: unknown };

/** WeatherLink Live `/v1/current_conditions`. Local structure types: 1 ISS, 2 leaf/soil, 3 barometer, 4 indoor. */
export function parseWeatherLinkLive(body: WllLocal): StationObservation {
  const ch = new Map<string, StationChannel>();
  for (const c of body.data?.conditions ?? []) if (c.data_structure_type !== 4) parseDavisRecord(c, ch);
  return { t: (body.data?.ts ?? 0) * 1000 || Date.now(), channels: [...ch.values()].map(withDewPoint) };
}

export async function weatherLinkLive(http: HttpClient, host: string): Promise<Layer<StationObservation>> {
  try {
    const r = await http.json<WllLocal>(localUrl(host, '/v1/current_conditions'), { ttlMs: 0 });
    return sourced(parseWeatherLinkLive(r.data), { source: LOCAL_SOURCE, license: 'Your own station data', confidence: 'high', basis: 'measured', retrievedAt: new Date(r.storedAt).toISOString() });
  } catch (e) {
    return unavailable(LOCAL_SOURCE, `Couldn't reach the WeatherLink Live at ${host} (${(e as Error).message}). Is the phone on the same Wi-Fi?`, true);
  }
}

/**
 * Tempest / WeatherFlow hub UDP broadcast (port 50222), one JSON message per packet. Returns the
 * device serial and an observation, or null for message types without weather data.
 */
export function parseTempestUdp(message: string): { serial: string; obs: StationObservation } | null {
  let m: { serial_number?: string; type?: string; obs?: number[][]; ob?: number[] };
  try {
    m = JSON.parse(message);
  } catch {
    return null;
  }
  const serial = m.serial_number;
  if (!serial) return null;
  const ch = new Map<string, StationChannel>();
  const o = (metric: Metric, v: number | null | undefined) => put(ch, 'outdoor', 'Outdoor', metric, v ?? undefined);
  let t: number | undefined;
  if (m.type === 'obs_st' && m.obs?.[0]) {
    const a = m.obs[0];
    t = a[0]! * 1000;
    o('windSpeed', a[2]); o('windGust', a[3]); o('windDirection', a[4]); o('pressure', a[6]); o('temperature', a[7]); o('humidity', a[8]);
    o('illuminance', a[9]); o('uvIndex', a[10]); o('solarRadiation', a[11]); o('rain', a[12]); o('voltage', a[16]);
  } else if (m.type === 'obs_air' && m.obs?.[0]) {
    const a = m.obs[0];
    t = a[0]! * 1000;
    o('pressure', a[1]); o('temperature', a[2]); o('humidity', a[3]); o('voltage', a[6]);
  } else if (m.type === 'obs_sky' && m.obs?.[0]) {
    const a = m.obs[0];
    t = a[0]! * 1000;
    o('illuminance', a[1]); o('uvIndex', a[2]); o('rain', a[3]); o('windSpeed', a[5]); o('windGust', a[6]); o('windDirection', a[7]); o('solarRadiation', a[10]);
  } else if (m.type === 'rapid_wind' && m.ob) {
    t = m.ob[0]! * 1000;
    o('windSpeed', m.ob[1]); o('windDirection', m.ob[2]);
  } else return null;
  // Tempest pressure is station pressure (not sea-level); it's reported as-is and labelled in the app.
  return { serial, obs: { t: t!, channels: [...ch.values()].map(withDewPoint) } };
}
