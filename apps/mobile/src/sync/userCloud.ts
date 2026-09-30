/**
 * Wires @plotwright/core's sync engine to SQLite (LocalStore) and the native user-cloud module
 * (CloudTransport). Nothing here talks to a developer server.
 */
import { syncOnce, type ChangeBatch, type CloudTransport, type LocalStore, type SyncCollection, type SyncRecord } from '@plotwright/core';
import { UserSync } from '@plotwright/user-sync';
import { getDb, kvGet, kvSet } from '../db/database';
import { clock, getDeviceId, newId } from '../services/identity';

const transport: CloudTransport = {
  async isAvailable() {
    return !!UserSync && (await UserSync.isAvailable());
  },
  async upload(batch: ChangeBatch) {
    await UserSync!.upload(batch.batchId, JSON.stringify(batch));
  },
  async listSince(cursor) {
    const r = await UserSync!.listSince(cursor);
    const batches = r.batches.flatMap((s) => {
      try {
        return [JSON.parse(s) as ChangeBatch];
      } catch {
        return [];
      }
    });
    return { batches, cursor: r.cursor };
  },
};

const store: LocalStore = {
  async get(collection: SyncCollection, id: string): Promise<SyncRecord | undefined> {
    const db = await getDb();
    if (collection === 'parcels') {
      const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM parcels WHERE id = ?', id);
      if (!r) return undefined;
      return { collection, id, hlc: String(r.updated_hlc), deleted: r.deleted === 1, data: r };
    }
    if (collection === 'sensors') {
      const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM sensors WHERE id = ?', id);
      if (!r) return undefined;
      // Last-seen bookkeeping is per device; it doesn't travel.
      const { last_seen: _ls, last_counter: _lc, ...data } = r;
      return { collection, id, hlc: String(r.updated_hlc), deleted: r.deleted === 1, data };
    }
    if (collection === 'sensorReadings') {
      const [sensorId, date, deviceId] = id.split('|');
      const r = await db.getFirstAsync<{ doy: number; metrics: string; updated_hlc: string }>(
        'SELECT doy, metrics, updated_hlc FROM sensor_days WHERE sensor_id = ? AND date = ? AND device_id = ?', sensorId ?? '', date ?? '', deviceId ?? '');
      return r ? { collection, id, hlc: r.updated_hlc, deleted: false, data: { sensor_id: sensorId, date, device_id: deviceId, doy: r.doy, metrics: r.metrics } } : undefined;
    }
    if (collection === 'plannerGoals') {
      const r = await db.getFirstAsync<{ goals: string; updated_hlc: string; deleted: number }>('SELECT goals, updated_hlc, deleted FROM planner_goals WHERE parcel_id = ?', id);
      return r ? { collection, id, hlc: r.updated_hlc, deleted: r.deleted === 1, data: { goals: r.goals } } : undefined;
    }
    if (collection === 'tasks') {
      const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', id);
      return r ? { collection, id, hlc: String(r.updated_hlc), deleted: r.deleted === 1, data: r } : undefined;
    }
    if (collection === 'plantings') {
      const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM plantings WHERE id = ?', id);
      return r ? { collection, id, hlc: String(r.updated_hlc), deleted: r.deleted === 1, data: r } : undefined;
    }
    if (collection === 'designs') {
      const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', id);
      return r ? { collection, id, hlc: String(r.updated_hlc), deleted: r.deleted === 1, data: r } : undefined;
    }
    if (collection === 'siteProfiles') {
      const r = await db.getFirstAsync<{ profile: string; updated_hlc: string }>('SELECT profile, updated_hlc FROM site_profiles WHERE parcel_id = ?', id);
      return r ? { collection, id, hlc: r.updated_hlc, deleted: false, data: JSON.parse(r.profile) } : undefined;
    }
    return undefined;
  },

  async applyRemote(rec: SyncRecord): Promise<void> {
    const db = await getDb();
    if (rec.collection === 'parcels') {
      const d = (rec.data ?? {}) as Record<string, unknown>;
      if (rec.deleted) {
        // Persist the tombstone even if this device never saw the parcel, so an older "create"
        // arriving later can't bring it back. Its profile goes with it.
        await db.runAsync(
          `INSERT INTO parcels (id, name, geometry, boundary_source, area_m2, created_at, updated_hlc, deleted)
           VALUES (?, '', 'null', 'drawn', 0, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET deleted = 1, updated_hlc = excluded.updated_hlc`,
          rec.id, new Date().toISOString(), rec.hlc,
        );
        await db.runAsync('DELETE FROM site_profiles WHERE parcel_id = ?', rec.id);
        return;
      }
      await db.runAsync(
        `INSERT INTO parcels (id, name, geometry, boundary_source, boundary_meta, county_fips, zip, area_m2, created_at, updated_hlc, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, geometry = excluded.geometry, boundary_source = excluded.boundary_source,
           boundary_meta = excluded.boundary_meta, county_fips = excluded.county_fips, zip = excluded.zip, area_m2 = excluded.area_m2,
           updated_hlc = excluded.updated_hlc, deleted = 0`,
        rec.id, String(d.name), String(d.geometry), String(d.boundary_source), (d.boundary_meta as string | null) ?? null,
        (d.county_fips as string | null) ?? null, (d.zip as string | null) ?? null, Number(d.area_m2), String(d.created_at), rec.hlc,
      );
    } else if (rec.collection === 'sensors') {
      const d = (rec.data ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
      const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
      await db.runAsync(
        `INSERT INTO sensors (id, parcel_id, kind, protocol, vendor, model, name, device_key, channel, parent_id, lon, lat, height_m, exposure, bed_object_id,
           thresholds, mac, model_hint, created_at, updated_hlc, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, vendor = excluded.vendor, model = excluded.model, lon = excluded.lon, lat = excluded.lat,
           height_m = excluded.height_m, exposure = excluded.exposure, bed_object_id = excluded.bed_object_id, thresholds = excluded.thresholds,
           mac = excluded.mac, model_hint = excluded.model_hint, updated_hlc = excluded.updated_hlc, deleted = excluded.deleted`,
        rec.id, String(d.parcel_id ?? ''), String(d.kind ?? 'ble'), String(d.protocol ?? ''), str(d.vendor), str(d.model), String(d.name ?? 'Sensor'),
        str(d.device_key), str(d.channel), str(d.parent_id), num(d.lon), num(d.lat), num(d.height_m), String(d.exposure ?? 'open-air'), str(d.bed_object_id),
        str(d.thresholds), str(d.mac), str(d.model_hint), String(d.created_at ?? new Date().toISOString()), rec.hlc, rec.deleted ? 1 : 0,
      );
      if (rec.deleted) {
        await db.runAsync('DELETE FROM readings WHERE sensor_id = ?', rec.id);
        await db.runAsync('DELETE FROM sensor_days WHERE sensor_id = ?', rec.id);
      }
    } else if (rec.collection === 'sensorReadings' && rec.data) {
      const d = rec.data as { sensor_id: string; date: string; device_id?: string; doy: number; metrics: string };
      const parent = await db.getFirstAsync<{ deleted: number }>('SELECT deleted FROM sensors WHERE id = ?', d.sensor_id);
      if (parent?.deleted === 1) return;
      // Each phone's part of the day is its own record, so applying another phone's never replaces ours.
      await db.runAsync(
        `INSERT INTO sensor_days (sensor_id, date, device_id, doy, metrics, updated_hlc) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(sensor_id, date, device_id) DO UPDATE SET doy = excluded.doy, metrics = excluded.metrics, updated_hlc = excluded.updated_hlc`,
        d.sensor_id, d.date, d.device_id ?? rec.id.split('|')[2] ?? 'unknown', Number(d.doy), String(d.metrics), rec.hlc,
      );
    } else if (rec.collection === 'plannerGoals') {
      const d = (rec.data ?? {}) as { goals?: string };
      await db.runAsync(
        `INSERT INTO planner_goals (parcel_id, goals, updated_hlc, deleted) VALUES (?, ?, ?, ?)
         ON CONFLICT(parcel_id) DO UPDATE SET goals = excluded.goals, updated_hlc = excluded.updated_hlc, deleted = excluded.deleted`,
        rec.id, String(d.goals ?? '{}'), rec.hlc, rec.deleted ? 1 : 0,
      );
    } else if (rec.collection === 'tasks') {
      const d = (rec.data ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
      await db.runAsync(
        `INSERT INTO tasks (id, parcel_id, title, due, category, notes, done, created_at, updated_hlc, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, due = excluded.due, category = excluded.category, notes = excluded.notes, done = excluded.done, updated_hlc = excluded.updated_hlc, deleted = excluded.deleted`,
        rec.id, String(d.parcel_id ?? ''), String(d.title ?? ''), str(d.due), String(d.category ?? 'admin'), str(d.notes), Number(d.done ?? 0) ? 1 : 0,
        String(d.created_at ?? new Date().toISOString()), rec.hlc, rec.deleted ? 1 : 0,
      );
    } else if (rec.collection === 'plantings') {
      const d = (rec.data ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
      await db.runAsync(
        `INSERT INTO plantings (id, parcel_id, design_id, bed_object_id, plant_id, variety, year, share, status, planted_on, notes, created_at, updated_hlc, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET plant_id = excluded.plant_id, variety = excluded.variety, year = excluded.year, share = excluded.share,
           status = excluded.status, planted_on = excluded.planted_on, notes = excluded.notes, updated_hlc = excluded.updated_hlc, deleted = excluded.deleted`,
        rec.id, String(d.parcel_id ?? ''), String(d.design_id ?? ''), String(d.bed_object_id ?? ''), String(d.plant_id ?? ''), str(d.variety),
        Number(d.year ?? new Date().getFullYear()), Number(d.share ?? 1), String(d.status ?? 'planned'), str(d.planted_on), str(d.notes),
        String(d.created_at ?? new Date().toISOString()), rec.hlc, rec.deleted ? 1 : 0,
      );
    } else if (rec.collection === 'designs') {
      const d = (rec.data ?? {}) as Record<string, unknown>;
      await db.runAsync(
        `INSERT INTO designs (id, parcel_id, name, objects, created_at, updated_at, updated_hlc, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, objects = excluded.objects, updated_at = excluded.updated_at,
           updated_hlc = excluded.updated_hlc, deleted = excluded.deleted`,
        rec.id, String(d.parcel_id ?? ''), String(d.name ?? ''), String(d.objects ?? '[]'), String(d.created_at ?? new Date().toISOString()),
        String(d.updated_at ?? new Date().toISOString()), rec.hlc, rec.deleted ? 1 : 0,
      );
    } else if (rec.collection === 'siteProfiles' && rec.data) {
      const parent = await db.getFirstAsync<{ deleted: number }>('SELECT deleted FROM parcels WHERE id = ?', rec.id);
      if (parent?.deleted === 1) return; // profile of a deleted parcel
      const p = rec.data as { computedAt: string };
      await db.runAsync(
        `INSERT INTO site_profiles (parcel_id, profile, computed_at, updated_hlc) VALUES (?, ?, ?, ?)
         ON CONFLICT(parcel_id) DO UPDATE SET profile = excluded.profile, computed_at = excluded.computed_at, updated_hlc = excluded.updated_hlc`,
        rec.id, JSON.stringify(rec.data), p.computedAt, rec.hlc,
      );
    }
  },

  async pendingChanges(): Promise<SyncRecord[]> {
    const db = await getDb();
    const keys = await db.getAllAsync<{ collection: SyncCollection; id: string }>('SELECT collection, id FROM sync_pending');
    const out: SyncRecord[] = [];
    for (const k of keys) {
      const r = await store.get(k.collection, k.id);
      if (r) out.push(r);
    }
    return out;
  },

  async markUploaded(records: SyncRecord[]): Promise<void> {
    const db = await getDb();
    // Only clear markers whose stamp is unchanged: an edit made during the upload stays pending.
    for (const r of records) await db.runAsync('DELETE FROM sync_pending WHERE collection = ? AND id = ? AND hlc = ?', r.collection, r.id, r.hlc);
  },

  getCursor: async () => (await kvGet('sync.cursor')) || null,
  setCursor: async (c) => kvSet('sync.cursor', c ?? ''),
};

export async function syncNow() {
  // A "Delete all my data" that couldn't reach the cloud must finish before we pull anything back.
  if ((await kvGet('sync.pendingCloudWipe')) === '1') {
    if (!(await transport.isAvailable())) return { unavailable: true as const };
    await UserSync!.deleteAll();
    await kvSet('sync.pendingCloudWipe', '0');
    await kvSet('sync.cursor', '');
  }
  return syncOnce(getDeviceId(), clock(), store, transport, newId);
}

/** Wipe the user's cloud copy. If that fails (offline), remember to retry before the next sync. */
export async function wipeCloudData(): Promise<'done' | 'deferred' | 'none'> {
  if (!UserSync) return 'none';
  try {
    if (!(await UserSync.isAvailable())) throw new Error('cloud unavailable');
    await UserSync.deleteAll();
    return 'done';
  } catch {
    await kvSet('sync.pendingCloudWipe', '1');
    return 'deferred';
  }
}

export async function cloudSyncAvailable(): Promise<boolean> {
  try {
    return await transport.isAvailable();
  } catch {
    return false;
  }
}
