/**
 * Weather-station accounts and local stations (§8.2–8.3): refresh current readings, backfill history,
 * and map each station channel (outdoor, soil probe 1, leaf sensor 2…) to its own sensor row so it can
 * be pinned where it actually sits on the parcel.
 */
import { toReadings, type Exposure, type Layer, type Reading } from '@plotwright/core';
import {
  ambientDevices, ambientHistory, ecowittHistory, ecowittLocal, ecowittRealtime, parseTempestUdp, weatherLinkCurrent, weatherLinkHistoric, weatherLinkLive,
  type StationChannel, type StationObservation,
} from '@plotwright/providers';
import { findSensor, insertReadings, lastReadingTime, listSensors, saveSensor, touchSensor, type SensorRecord } from '../db/sensors';
import { http } from './http';
import { getSecret } from './secrets';

export type StationProtocol = 'ecowitt' | 'ambient' | 'weatherlink' | 'ecowitt-local' | 'wll-local' | 'tempest-udp';

export const STATION_LABEL: Record<StationProtocol, string> = {
  ecowitt: 'Ecowitt (cloud)', ambient: 'Ambient Weather', weatherlink: 'Davis WeatherLink', 'ecowitt-local': 'Ecowitt gateway (Wi-Fi)',
  'wll-local': 'WeatherLink Live (Wi-Fi)', 'tempest-udp': 'Tempest hub (Wi-Fi)',
};

/** What a channel most likely measures, as the default exposure (the user can change it). */
function defaultExposure(ch: StationChannel): Exposure {
  if (ch.channel.startsWith('soil')) return 'soil';
  return 'open-air';
}

/** Readings for each channel of an observation, creating channel sensors the first time they appear. */
async function channelReadings(station: SensorRecord, obs: StationObservation): Promise<Reading[]> {
  const out: Reading[] = [];
  for (const ch of obs.channels) {
    let s = await findSensor(station.protocol, station.deviceKey!, ch.channel);
    if (!s) {
      s = await saveSensor({
        parcelId: station.parcelId, kind: station.kind, protocol: station.protocol, vendor: station.vendor, model: station.model,
        name: ch.channel === 'outdoor' ? station.name : `${station.name}: ${ch.label}`, deviceKey: station.deviceKey, channel: ch.channel,
        parentId: station.id, exposure: defaultExposure(ch), location: station.location, heightM: ch.channel === 'outdoor' ? station.heightM : undefined,
      });
    }
    out.push(...toReadings(s.id, obs.t, ch.values));
  }
  return out;
}

export async function ingestObservations(station: SensorRecord, obs: StationObservation[], offsetMin: number): Promise<number> {
  const all: Reading[] = [];
  for (const o of obs) all.push(...(await channelReadings(station, o)));
  const n = await insertReadings(all, offsetMin);
  if (obs.length) await touchSensor(station.id, Math.max(...obs.map((o) => o.t)));
  return n;
}

/** Current readings from a station (cloud or local HTTP). */
export async function refreshStation(station: SensorRecord, offsetMin: number): Promise<Layer<StationObservation> | null> {
  const sec = await getSecret(station.id);
  let layer: Layer<StationObservation> | null = null;
  switch (station.protocol as StationProtocol) {
    case 'ecowitt':
      if (!sec?.applicationKey || !sec.apiKey) return null;
      layer = await ecowittRealtime(http, { applicationKey: sec.applicationKey, apiKey: sec.apiKey, mac: station.deviceKey! });
      break;
    case 'ambient': {
      if (!sec?.applicationKey || !sec.apiKey) return null;
      const devs = await ambientDevices(http, { applicationKey: sec.applicationKey, apiKey: sec.apiKey });
      if (devs.status !== 'ok') return devs;
      const d = devs.value.find((x) => x.id.toUpperCase() === station.deviceKey!.toUpperCase());
      layer = d?.last ? { ...devs, value: d.last } : null;
      break;
    }
    case 'weatherlink':
      if (!sec?.apiKey || !sec.apiSecret) return null;
      layer = await weatherLinkCurrent(http, { apiKey: sec.apiKey, apiSecret: sec.apiSecret, stationId: station.deviceKey! });
      break;
    case 'ecowitt-local':
      layer = await ecowittLocal(http, station.deviceKey!);
      break;
    case 'wll-local':
      layer = await weatherLinkLive(http, station.deviceKey!);
      break;
    default:
      return null;
  }
  if (layer?.status === 'ok') await ingestObservations(station, [layer.value], offsetMin);
  return layer;
}

export interface BackfillProgress {
  done: number;
  total: number;
  readings: number;
  note?: string;
}

const DAY = 86_400_000;

/**
 * Pull the history the service still holds, from the newest we already have (or `maxDays` back).
 * Ecowitt: 5-minute data for the last week, then 30-minute (kept ~1 year). Ambient: pages of 288
 * records going back (kept 1 year). WeatherLink: 24-hour windows, only on a WeatherLink Pro plan.
 */
export async function backfillStation(station: SensorRecord, offsetMin: number, onProgress: (p: BackfillProgress) => void, maxDays = 365): Promise<BackfillProgress> {
  const sec = await getSecret(station.id);
  const now = Date.now();
  const children = (await listSensors(station.parcelId)).filter((s) => s.parentId === station.id);
  const newest = Math.max(0, ...(await Promise.all(children.map((c) => lastReadingTime(c.id)))).map((t) => t ?? 0));
  const from = Math.max(now - maxDays * DAY, newest ? newest - DAY : 0);
  const p: BackfillProgress = { done: 0, total: 0, readings: 0 };
  try {
    if (station.protocol === 'ecowitt' && sec?.applicationKey && sec.apiKey) {
      const keys = { applicationKey: sec.applicationKey, apiKey: sec.apiKey, mac: station.deviceKey! };
      // Newest first: one-day windows of 5-minute data for the last week, then week-long windows of 30-minute data.
      const windows: Array<[number, number, '5min' | '30min']> = [];
      for (let end = now; end > from;) {
        const recent = now - end < 7 * DAY;
        const start = Math.max(from, end - (recent ? DAY : 7 * DAY));
        windows.push([start, end, recent ? '5min' : '30min']);
        end = start;
      }
      p.total = windows.length;
      for (const [s, e, cycle] of windows) {
        p.readings += await ingestObservations(station, await ecowittHistory(http, keys, s, e, offsetMin, cycle), offsetMin);
        p.done++;
        onProgress({ ...p });
      }
    } else if (station.protocol === 'ambient' && sec?.applicationKey && sec.apiKey) {
      const keys = { applicationKey: sec.applicationKey, apiKey: sec.apiKey };
      let end = now;
      p.total = Math.ceil((now - from) / DAY); // approximate: 1 page ≈ 1 day of 5-minute data
      for (let page = 0; page < 200 && end > from; page++) {
        const obs = await ambientHistory(http, keys, station.deviceKey!, end);
        if (!obs.length) break;
        p.readings += await ingestObservations(station, obs.filter((o) => o.t >= from), offsetMin);
        end = obs[0]!.t - 1;
        p.done = Math.min(p.total, Math.ceil((now - end) / DAY));
        onProgress({ ...p });
      }
    } else if (station.protocol === 'weatherlink' && sec?.apiKey && sec.apiSecret) {
      const keys = { apiKey: sec.apiKey, apiSecret: sec.apiSecret, stationId: station.deviceKey! };
      const days = Math.min(Math.ceil((now - from) / DAY), 30);
      p.total = days;
      for (let i = 0; i < days; i++) {
        const e = now - i * DAY;
        try {
          p.readings += await ingestObservations(station, await weatherLinkHistoric(http, keys, e - DAY, e), offsetMin);
        } catch (err) {
          p.note = /40[13]/.test(String((err as Error).message)) ? 'History needs a WeatherLink Pro plan on this station; new readings will build up from now.' : (err as Error).message;
          break;
        }
        p.done++;
        onProgress({ ...p });
      }
    } else {
      p.note = 'This connection has no history to download; readings build up from now.';
    }
  } catch (e) {
    p.note = `Stopped early: ${(e as Error).message}`;
  }
  onProgress({ ...p });
  return p;
}

/** Refresh every station on the device (foreground open and the background task). */
export async function refreshAllStations(offsetMin: number, includeLocal: boolean): Promise<void> {
  for (const s of await listSensors()) {
    if (s.parentId || (s.kind !== 'cloud' && s.kind !== 'local') || s.protocol === 'tempest-udp') continue;
    if (s.kind === 'local' && !includeLocal) continue;
    try {
      await refreshStation(s, offsetMin);
    } catch {
      // One unreachable station shouldn't stop the others.
    }
  }
}

// ---------------- Tempest UDP (local) ----------------

type UdpSocket = { bind(port: number, cb?: () => void): void; on(ev: 'message', cb: (msg: Uint8Array | string) => void): void; on(ev: 'error', cb: (e: unknown) => void): void; close(): void };

/**
 * Open a UDP listener on the Tempest broadcast port (react-native-udp). On iOS, receiving broadcasts
 * needs Apple's (free) multicast networking entitlement; without it nothing arrives.
 */
async function openTempestSocket(onMessage: (r: NonNullable<ReturnType<typeof parseTempestUdp>>) => void): Promise<() => void> {
  const dgram = (await import('react-native-udp')).default as { createSocket(o: { type: 'udp4'; reusePort?: boolean }): UdpSocket };
  const sock = dgram.createSocket({ type: 'udp4', reusePort: true });
  sock.on('message', (msg) => {
    const r = parseTempestUdp(typeof msg === 'string' ? msg : String.fromCharCode(...msg));
    if (r) onMessage(r);
  });
  sock.on('error', () => undefined);
  sock.bind(50222);
  return () => sock.close();
}

/** Listen for the first Tempest (or Air/Sky) device broadcasting on this Wi-Fi. Returns its serial number, or null. */
export async function discoverTempest(timeoutMs = 70_000): Promise<string | null> {
  return new Promise((resolve) => {
    let stop: (() => void) | undefined;
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    openTempestSocket((r) => { if (/^(ST|AR|SK)-/.test(r.serial)) finish(r.serial); })
      .then((s) => { stop = s; if (done) s(); })
      .catch(() => finish(null));
  });
}

/** Store a Tempest station's broadcasts while the app is open (full observations once a minute). */
export async function listenTempest(station: SensorRecord, offsetMin: number, onObs: (o: StationObservation) => void): Promise<() => void> {
  let last = 0;
  return openTempestSocket((r) => {
    if (station.deviceKey && r.serial !== station.deviceKey) return;
    onObs(r.obs);
    // rapid_wind packets every 3 s carry only wind; store the full observations.
    const v = r.obs.channels[0]?.values ?? {};
    const full = v.temperature !== undefined || v.illuminance !== undefined;
    if (full && r.obs.t - last >= 60_000) {
      last = r.obs.t;
      void ingestObservations(station, [r.obs], offsetMin);
    }
  });
}
