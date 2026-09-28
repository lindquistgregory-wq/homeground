/**
 * On-device SQLite (§0 rule 3, local-first). Holds the user's parcels, cached Site Profiles, the HTTP
 * response cache (so profiles work offline), user-added parcel endpoints, and the sync bookkeeping.
 * Schema changes are append-only numbered migrations.
 */
import * as SQLite from 'expo-sqlite';
import type { CacheEntry, KeyValueCache } from '@homeground/providers';

const MIGRATIONS: string[] = [
  // 1 — Phase 1 foundation
  `
  CREATE TABLE IF NOT EXISTS parcels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    geometry TEXT NOT NULL,            -- GeoJSON Polygon/MultiPolygon, EPSG:4326
    boundary_source TEXT NOT NULL,     -- 'county' | 'drawn' | 'walked' | 'imported'
    boundary_meta TEXT,                -- JSON: endpoint id, attribution, license, displayOnly, retrievedAt, file name…
    county_fips TEXT,
    zip TEXT,
    area_m2 REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_hlc TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS site_profiles (
    parcel_id TEXT PRIMARY KEY REFERENCES parcels(id),
    profile TEXT NOT NULL,             -- JSON SiteProfile
    computed_at TEXT NOT NULL,
    updated_hlc TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS http_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    stored_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_parcel_endpoints (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL             -- JSON ParcelEndpoint (origin 'user'); never leaves this device
  );
  CREATE TABLE IF NOT EXISTS sync_pending (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('homeground.db');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const current = row?.user_version ?? 0;
    for (let v = current; v < MIGRATIONS.length; v++) {
      await db.withTransactionAsync(async () => {
        await db.execAsync(MIGRATIONS[v]!);
        await db.execAsync(`PRAGMA user_version = ${v + 1}`);
      });
    }
    return db;
  })();
  return dbPromise;
}

export async function kvGet(key: string): Promise<string | undefined> {
  const db = await getDb();
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key))?.value;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

/** SQLite-backed HTTP cache so every Site Profile layer survives restarts and works offline. */
export class SqliteHttpCache implements KeyValueCache {
  async get(key: string): Promise<CacheEntry | undefined> {
    const db = await getDb();
    const r = await db.getFirstAsync<{ value: string; stored_at: number; expires_at: number }>(
      'SELECT value, stored_at, expires_at FROM http_cache WHERE key = ?',
      key,
    );
    return r ? { value: r.value, storedAt: r.stored_at, expiresAt: r.expires_at } : undefined;
  }
  async set(key: string, e: CacheEntry): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO http_cache (key, value, stored_at, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, stored_at = excluded.stored_at, expires_at = excluded.expires_at`,
      key, e.value, e.storedAt, e.expiresAt,
    );
  }
}

/** §11 privacy: the user can wipe everything the app stores on this device. */
export async function deleteAllLocalData(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    'DELETE FROM site_profiles; DELETE FROM parcels; DELETE FROM http_cache; DELETE FROM user_parcel_endpoints; DELETE FROM sync_pending; DELETE FROM kv;',
  );
}
