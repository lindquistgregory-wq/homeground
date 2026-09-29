/**
 * On-device SQLite (§0 rule 3, local-first). Holds the user's parcels, cached Site Profiles, the HTTP
 * response cache (so profiles work offline), user-added parcel endpoints, and the sync bookkeeping.
 * Schema changes are append-only numbered migrations.
 */
import * as SQLite from 'expo-sqlite';
import type { CacheEntry, KeyValueCache } from '@plotwright/providers';

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
    parcel_id TEXT PRIMARY KEY,        -- no FK: sync may deliver a profile before its parcel
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
    hlc TEXT NOT NULL,                 -- stamp of the local write; cleared only if unchanged at upload
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2 — Phase 2 design mode
  `
  CREATE TABLE IF NOT EXISTS designs (
    id TEXT PRIMARY KEY,
    parcel_id TEXT NOT NULL,
    name TEXT NOT NULL,
    objects TEXT NOT NULL,             -- JSON DesignObject[]
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_hlc TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS designs_parcel ON designs(parcel_id);
  CREATE TABLE IF NOT EXISTS design_versions (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    objects TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sun_checks (
    id TEXT PRIMARY KEY,
    parcel_id TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    at TEXT NOT NULL,
    observed_sun INTEGER NOT NULL,     -- user says the spot is in direct sun right now
    modeled_sun INTEGER                -- what the shade model predicted for that moment
  );
  `,
  // 3 — Phase 3 planting guide
  `
  CREATE TABLE IF NOT EXISTS plantings (
    id TEXT PRIMARY KEY,
    parcel_id TEXT NOT NULL,
    design_id TEXT NOT NULL,
    bed_object_id TEXT NOT NULL,       -- DesignObject id of the bed / row / tree spot
    plant_id TEXT NOT NULL,
    variety TEXT,
    year INTEGER NOT NULL,
    share REAL NOT NULL DEFAULT 1,     -- fraction of the bed's length used
    status TEXT NOT NULL,              -- 'planned' | 'planted' | 'harvested' | 'removed'
    planted_on TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_hlc TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS plantings_bed ON plantings(design_id, bed_object_id);
  CREATE INDEX IF NOT EXISTS plantings_parcel ON plantings(parcel_id);
  `,
  // 4 — Phase 4 sensors. Raw readings stay on this device; daily summaries sync.
  `
  CREATE TABLE IF NOT EXISTS sensors (
    id TEXT PRIMARY KEY,
    parcel_id TEXT NOT NULL,
    kind TEXT NOT NULL,                 -- 'ble' | 'cloud' | 'local' | 'csv'
    protocol TEXT NOT NULL,             -- 'bthome' | 'govee' | … | 'ecowitt' | 'ambient' | 'weatherlink' | 'ecowitt-local' | 'wll-local' | 'tempest-udp' | 'csv'
    vendor TEXT, model TEXT, name TEXT NOT NULL,
    device_key TEXT,                    -- BLE device key, station MAC/id, or LAN address
    channel TEXT,                       -- station channel ('outdoor', 'soil1'…); NULL for the station itself
    parent_id TEXT,                     -- the station a channel belongs to
    lon REAL, lat REAL, height_m REAL,
    exposure TEXT NOT NULL DEFAULT 'open-air',
    bed_object_id TEXT,
    thresholds TEXT,                    -- JSON
    mac TEXT,                           -- display-order MAC when known (needed to decrypt on iOS)
    model_hint TEXT,
    last_seen INTEGER, last_counter INTEGER,
    created_at TEXT NOT NULL,
    updated_hlc TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS sensors_parcel ON sensors(parcel_id);
  CREATE INDEX IF NOT EXISTS sensors_device ON sensors(protocol, device_key);
  CREATE TABLE IF NOT EXISTS readings (
    sensor_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    t INTEGER NOT NULL,
    value REAL NOT NULL,
    quality TEXT NOT NULL,
    PRIMARY KEY (sensor_id, metric, t)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS readings_time ON readings(sensor_id, t);
  -- One partial summary per sensor, day and phone (each phone hears Bluetooth sensors separately);
  -- they sync individually and are merged when read, so two phones never overwrite each other's day.
  CREATE TABLE IF NOT EXISTS sensor_days (
    sensor_id TEXT NOT NULL,
    date TEXT NOT NULL,                 -- local date YYYY-MM-DD
    device_id TEXT NOT NULL,            -- phone that collected these readings
    doy INTEGER NOT NULL,
    metrics TEXT NOT NULL,              -- JSON { metric: {min,max,mean,n,last,hm} }
    updated_hlc TEXT NOT NULL,
    PRIMARY KEY (sensor_id, date, device_id)
  ) WITHOUT ROWID;
  -- This phone's Bluetooth id for a sensor (iOS gives each phone its own ids); never synced.
  CREATE TABLE IF NOT EXISTS ble_aliases (
    platform_key TEXT PRIMARY KEY,
    sensor_id TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('plotwright.db');
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

/** Highest sync stamp stored locally, used to seed the clock after a restart. */
export async function maxStoredHlc(): Promise<string | undefined> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ m: string | null }>(
    'SELECT MAX(m) AS m FROM (SELECT MAX(updated_hlc) AS m FROM parcels UNION ALL SELECT MAX(updated_hlc) FROM site_profiles UNION ALL SELECT MAX(updated_hlc) FROM designs UNION ALL SELECT MAX(updated_hlc) FROM plantings UNION ALL SELECT MAX(updated_hlc) FROM sensors UNION ALL SELECT MAX(updated_hlc) FROM sensor_days)',
  );
  return r?.m ?? undefined;
}

/** §11 privacy: the user can wipe everything the app stores on this device. */
export async function deleteAllLocalData(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    'DELETE FROM site_profiles; DELETE FROM parcels; DELETE FROM http_cache; DELETE FROM user_parcel_endpoints; DELETE FROM sync_pending; DELETE FROM kv; DELETE FROM designs; DELETE FROM design_versions; DELETE FROM sun_checks; DELETE FROM plantings; DELETE FROM sensors; DELETE FROM readings; DELETE FROM sensor_days; DELETE FROM ble_aliases;',
  );
}
