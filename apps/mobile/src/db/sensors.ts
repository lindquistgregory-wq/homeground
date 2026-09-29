/**
 * Sensor storage (§8 normalization): sensor definitions sync; raw readings stay on the device; daily
 * summaries (min/max/mean per metric, in the parcel's local time) sync so every device has the history
 * the calendar, GDD and water balance need without shipping every 5-minute reading to iCloud.
 */
import {
  dailyAggregates, hoursCovered, localDate, mergeDayMetrics, type DayAggregate, type Exposure, type Metric, type Offset, type Reading, type SensorKind, type Thresholds,
} from '@plotwright/core';
import { getDb } from './database';
import { clock, getDeviceId, newId } from '../services/identity';

export interface SensorRecord {
  id: string;
  parcelId: string;
  kind: SensorKind;
  protocol: string;
  vendor?: string;
  model?: string;
  name: string;
  deviceKey?: string;
  channel?: string;
  parentId?: string;
  location?: { lon: number; lat: number };
  heightM?: number;
  exposure: Exposure;
  bedObjectId?: string;
  thresholds?: Thresholds;
  mac?: string;
  modelHint?: string;
  lastSeen?: number;
  lastCounter?: number;
  createdAt: string;
}

interface Row {
  id: string; parcel_id: string; kind: SensorKind; protocol: string; vendor: string | null; model: string | null; name: string; device_key: string | null;
  channel: string | null; parent_id: string | null; lon: number | null; lat: number | null; height_m: number | null; exposure: Exposure;
  bed_object_id: string | null; thresholds: string | null; mac: string | null; model_hint: string | null; last_seen: number | null;
  last_counter: number | null; created_at: string;
}

const u = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
const fromRow = (r: Row): SensorRecord => ({
  id: r.id, parcelId: r.parcel_id, kind: r.kind, protocol: r.protocol, vendor: u(r.vendor), model: u(r.model), name: r.name, deviceKey: u(r.device_key),
  channel: u(r.channel), parentId: u(r.parent_id), location: r.lon !== null && r.lat !== null ? { lon: r.lon, lat: r.lat } : undefined, heightM: u(r.height_m),
  exposure: r.exposure, bedObjectId: u(r.bed_object_id), thresholds: r.thresholds ? (JSON.parse(r.thresholds) as Thresholds) : undefined, mac: u(r.mac),
  modelHint: u(r.model_hint), lastSeen: u(r.last_seen), lastCounter: u(r.last_counter), createdAt: r.created_at,
});

async function markPending(collection: 'sensors' | 'sensorReadings', id: string, hlc: string) {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', collection, id, hlc);
}

export async function listSensors(parcelId?: string): Promise<SensorRecord[]> {
  const db = await getDb();
  const rows = parcelId
    ? await db.getAllAsync<Row>('SELECT * FROM sensors WHERE parcel_id = ? AND deleted = 0 ORDER BY created_at', parcelId)
    : await db.getAllAsync<Row>('SELECT * FROM sensors WHERE deleted = 0 ORDER BY created_at');
  return rows.map(fromRow);
}

export async function getSensor(id: string): Promise<SensorRecord | undefined> {
  const db = await getDb();
  const r = await db.getFirstAsync<Row>('SELECT * FROM sensors WHERE id = ? AND deleted = 0', id);
  return r ? fromRow(r) : undefined;
}

export async function findSensor(protocol: string, deviceKey: string, channel?: string): Promise<SensorRecord | undefined> {
  const db = await getDb();
  const r = channel === undefined
    ? await db.getFirstAsync<Row>('SELECT * FROM sensors WHERE protocol = ? AND device_key = ? AND channel IS NULL AND deleted = 0', protocol, deviceKey)
    : await db.getFirstAsync<Row>('SELECT * FROM sensors WHERE protocol = ? AND device_key = ? AND channel = ? AND deleted = 0', protocol, deviceKey, channel);
  return r ? fromRow(r) : undefined;
}

export async function saveSensor(s: Omit<SensorRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<SensorRecord> {
  const db = await getDb();
  const rec: SensorRecord = { ...s, id: s.id ?? newId(), createdAt: s.createdAt ?? new Date().toISOString() };
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO sensors (id, parcel_id, kind, protocol, vendor, model, name, device_key, channel, parent_id, lon, lat, height_m, exposure, bed_object_id,
       thresholds, mac, model_hint, last_seen, last_counter, created_at, updated_hlc, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, vendor = excluded.vendor, model = excluded.model, lon = excluded.lon, lat = excluded.lat,
       height_m = excluded.height_m, exposure = excluded.exposure, bed_object_id = excluded.bed_object_id, thresholds = excluded.thresholds,
       mac = excluded.mac, model_hint = excluded.model_hint, updated_hlc = excluded.updated_hlc, deleted = 0`,
    rec.id, rec.parcelId, rec.kind, rec.protocol, rec.vendor ?? null, rec.model ?? null, rec.name, rec.deviceKey ?? null, rec.channel ?? null,
    rec.parentId ?? null, rec.location?.lon ?? null, rec.location?.lat ?? null, rec.heightM ?? null, rec.exposure, rec.bedObjectId ?? null,
    rec.thresholds ? JSON.stringify(rec.thresholds) : null, rec.mac ?? null, rec.modelHint ?? null, rec.lastSeen ?? null, rec.lastCounter ?? null,
    rec.createdAt, hlc,
  );
  await markPending('sensors', rec.id, hlc);
  return rec;
}

/** Last-seen time and counter are device-local bookkeeping: updated without a sync stamp. */
export async function touchSensor(id: string, lastSeen: number, lastCounter?: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE sensors SET last_seen = MAX(COALESCE(last_seen, 0), ?), last_counter = COALESCE(?, last_counter) WHERE id = ?', lastSeen, lastCounter ?? null, id);
}

/** Tombstone a sensor (and a station's channels); its raw readings are removed from this device. */
export async function deleteSensor(id: string): Promise<string[]> {
  const db = await getDb();
  const ids = [id, ...(await db.getAllAsync<{ id: string }>('SELECT id FROM sensors WHERE parent_id = ? AND deleted = 0', id)).map((r) => r.id)];
  for (const sid of ids) {
    const hlc = clock().tick();
    await db.runAsync('UPDATE sensors SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, sid);
    await markPending('sensors', sid, hlc);
    await db.runAsync('DELETE FROM readings WHERE sensor_id = ?', sid);
    await db.runAsync('DELETE FROM sensor_days WHERE sensor_id = ?', sid);
    // Its unsent day summaries have nothing left to send; the sensor tombstone stops other phones applying old ones.
    await db.runAsync("DELETE FROM sync_pending WHERE collection = 'sensorReadings' AND id LIKE ?", `${sid}|%`);
    await db.runAsync('DELETE FROM ble_aliases WHERE sensor_id = ?', sid);
  }
  return ids;
}

// ---------------- This phone's Bluetooth ids ----------------

/** Map this phone's Bluetooth id for a device to a sensor (local only). */
export async function setBleAlias(platformKey: string, sensorId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO ble_aliases (platform_key, sensor_id) VALUES (?, ?)', platformKey, sensorId);
}

export async function bleAliases(): Promise<Map<string, string>> {
  const db = await getDb();
  return new Map((await db.getAllAsync<{ platform_key: string; sensor_id: string }>('SELECT platform_key, sensor_id FROM ble_aliases')).map((r) => [r.platform_key, r.sensor_id]));
}

export async function deleteSensorsForParcel(parcelId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const s of await listSensors(parcelId)) if (!s.parentId) ids.push(...(await deleteSensor(s.id)));
  return ids;
}

// ---------------- Readings ----------------

/**
 * Store readings (duplicates by sensor/metric/time are ignored) and refresh this phone's daily
 * summaries for the days they touch. `offset` gives local days (daylight-saving aware).
 */
export async function insertReadings(readings: Reading[], offset: Offset): Promise<number> {
  if (!readings.length) return 0;
  const db = await getDb();
  let n = 0;
  // Multi-row inserts (150 rows × 5 params stays under SQLite's 999-parameter limit).
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < readings.length; i += 150) {
      const chunk = readings.slice(i, i + 150);
      const params: Array<string | number> = [];
      for (const r of chunk) params.push(r.sensorId, r.metric, r.t, r.value, r.quality);
      const res = (await db.runAsync(`INSERT OR IGNORE INTO readings (sensor_id, metric, t, value, quality) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')}`, ...params)) as { changes?: number };
      n += res?.changes ?? chunk.length;
    }
  });
  // Recompute each touched local day from that day's readings only (bounded memory on big backfills).
  const touched = new Map<string, { sensorId: string; date: string }>();
  const lastSeen = new Map<string, number>();
  for (const r of readings) {
    const { date } = localDate(r.t, offset);
    touched.set(`${r.sensorId}|${date}`, { sensorId: r.sensorId, date });
    lastSeen.set(r.sensorId, Math.max(lastSeen.get(r.sensorId) ?? 0, r.t));
  }
  for (const { sensorId, date } of touched.values()) {
    // Local midnight is within ±14 h of UTC midnight: fetch a wide window and keep that date's readings.
    const utc0 = Date.parse(`${date}T00:00:00Z`);
    const day = dailyAggregates(await readingsBetween(sensorId, utc0 - 15 * 3_600_000, utc0 + 39 * 3_600_000), offset).find((d) => d.date === date);
    if (day) await saveDay(sensorId, day);
  }
  for (const [sensorId, t] of lastSeen) await touchSensor(sensorId, t);
  return n;
}

/** Save this phone's part of a day. Sync id: sensor|date|device. */
async function saveDay(sensorId: string, d: DayAggregate) {
  const db = await getDb();
  const hlc = clock().tick();
  const device = getDeviceId();
  await db.runAsync(
    `INSERT INTO sensor_days (sensor_id, date, device_id, doy, metrics, updated_hlc) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sensor_id, date, device_id) DO UPDATE SET doy = excluded.doy, metrics = excluded.metrics, updated_hlc = excluded.updated_hlc`,
    sensorId, d.date, device, d.doy, JSON.stringify(d.metrics), hlc,
  );
  await markPending('sensorReadings', `${sensorId}|${d.date}|${device}`, hlc);
}

export async function readingsBetween(sensorId: string, fromT: number, toT: number, metric?: Metric): Promise<Reading[]> {
  const db = await getDb();
  const rows = metric
    ? await db.getAllAsync<{ sensor_id: string; metric: Metric; t: number; value: number; quality: Reading['quality'] }>(
      'SELECT * FROM readings WHERE sensor_id = ? AND metric = ? AND t BETWEEN ? AND ? ORDER BY t', sensorId, metric, fromT, toT)
    : await db.getAllAsync<{ sensor_id: string; metric: Metric; t: number; value: number; quality: Reading['quality'] }>(
      'SELECT * FROM readings WHERE sensor_id = ? AND t BETWEEN ? AND ? ORDER BY t', sensorId, fromT, toT);
  return rows.map((r) => ({ sensorId: r.sensor_id, metric: r.metric, t: r.t, value: r.value, quality: r.quality }));
}

/** Latest value per metric (quality ok) for a sensor. */
export async function latestValues(sensorId: string): Promise<Partial<Record<Metric, { value: number; t: number }>>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ metric: Metric; value: number; t: number }>(
    `SELECT r.metric, r.value, r.t FROM readings r
     JOIN (SELECT metric, MAX(t) AS t FROM readings WHERE sensor_id = ? AND quality != 'suspect' GROUP BY metric) m ON m.metric = r.metric AND m.t = r.t
     WHERE r.sensor_id = ?`, sensorId, sensorId);
  const out: Partial<Record<Metric, { value: number; t: number }>> = {};
  for (const r of rows) out[r.metric] = { value: r.value, t: r.t };
  return out;
}

/**
 * Daily summaries for a sensor, combining the parts collected by each phone. Bluetooth parts are
 * different readings (each phone heard the sensor at different times), so they're merged. Station and
 * import parts are the same readings downloaded twice, so the most complete part wins; merging them
 * would count per-interval rain twice.
 */
export async function sensorDays(sensorId: string, fromDate?: string): Promise<DayAggregate[]> {
  const db = await getDb();
  const kind = (await db.getFirstAsync<{ kind: SensorKind }>('SELECT kind FROM sensors WHERE id = ?', sensorId))?.kind;
  const combine = (parts: Array<DayAggregate['metrics']>): DayAggregate['metrics'] => {
    if (parts.length === 1) return parts[0]!;
    if (kind === 'ble') return mergeDayMetrics(parts);
    const coverage = (p: DayAggregate['metrics']) => Math.max(0, ...Object.values(p).map((m) => hoursCovered(m) * 10_000 + (m?.n ?? 0)));
    return parts.reduce((best, p) => (coverage(p) > coverage(best) ? p : best));
  };
  const rows = await db.getAllAsync<{ date: string; doy: number; metrics: string }>(
    'SELECT date, doy, metrics FROM sensor_days WHERE sensor_id = ? AND date >= ? ORDER BY date', sensorId, fromDate ?? '0000');
  const byDate = new Map<string, { doy: number; parts: Array<DayAggregate['metrics']> }>();
  for (const r of rows) {
    const e = byDate.get(r.date) ?? { doy: r.doy, parts: [] };
    e.parts.push(JSON.parse(r.metrics) as DayAggregate['metrics']);
    byDate.set(r.date, e);
  }
  return [...byDate.entries()].map(([date, e]) => ({ date, doy: e.doy, metrics: combine(e.parts) }));
}

/** Most recent reading time for a sensor, for backfill (null = none yet). */
export async function lastReadingTime(sensorId: string): Promise<number | null> {
  const db = await getDb();
  return (await db.getFirstAsync<{ t: number | null }>('SELECT MAX(t) AS t FROM readings WHERE sensor_id = ?', sensorId))?.t ?? null;
}
