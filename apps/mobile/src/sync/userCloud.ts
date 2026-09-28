/**
 * Wires @homeground/core's sync engine to SQLite (LocalStore) and the native user-cloud module
 * (CloudTransport). Nothing here talks to a developer server.
 */
import { syncOnce, type ChangeBatch, type CloudTransport, type LocalStore, type SyncCollection, type SyncRecord } from '@homeground/core';
import { UserSync } from '@homeground/user-sync';
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
