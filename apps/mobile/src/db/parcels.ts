import { areaM2, type Areal } from '@homeground/core';
import type { ParcelEndpoint } from '@homeground/data';
import type { SiteProfile } from '@homeground/providers';
import { getDb } from './database';
import { clock, newId } from '../services/identity';

export type BoundarySource = 'county' | 'drawn' | 'walked' | 'imported';

export interface BoundaryMeta {
  endpointId?: string;
  parcelId?: string;
  publishedAcres?: number;
  attribution?: string;
  license?: string;
  displayOnly?: boolean;
  retrievedAt?: string;
  fileName?: string;
  medianGpsAccuracyM?: number;
}

export interface ParcelRecord {
  id: string;
  name: string;
  geometry: Areal;
  boundarySource: BoundarySource;
  boundaryMeta: BoundaryMeta;
  countyFips?: string;
  zip?: string;
  areaM2: number;
  createdAt: string;
}

interface Row {
  id: string;
  name: string;
  geometry: string;
  boundary_source: BoundarySource;
  boundary_meta: string | null;
  county_fips: string | null;
  zip: string | null;
  area_m2: number;
  created_at: string;
}

const fromRow = (r: Row): ParcelRecord => ({
  id: r.id,
  name: r.name,
  geometry: JSON.parse(r.geometry) as Areal,
  boundarySource: r.boundary_source,
  boundaryMeta: r.boundary_meta ? (JSON.parse(r.boundary_meta) as BoundaryMeta) : {},
  countyFips: r.county_fips ?? undefined,
  zip: r.zip ?? undefined,
  areaM2: r.area_m2,
  createdAt: r.created_at,
});

async function markPending(collection: string, id: string) {
  const db = await getDb();
  await db.runAsync('INSERT OR IGNORE INTO sync_pending (collection, id) VALUES (?, ?)', collection, id);
}

export async function listParcels(): Promise<ParcelRecord[]> {
  const db = await getDb();
  return (await db.getAllAsync<Row>('SELECT * FROM parcels WHERE deleted = 0 ORDER BY created_at')).map(fromRow);
}

export async function getParcel(id: string): Promise<ParcelRecord | undefined> {
  const db = await getDb();
  const r = await db.getFirstAsync<Row>('SELECT * FROM parcels WHERE id = ? AND deleted = 0', id);
  return r ? fromRow(r) : undefined;
}

export async function saveParcel(input: Omit<ParcelRecord, 'id' | 'createdAt' | 'areaM2'> & { id?: string }): Promise<ParcelRecord> {
  const db = await getDb();
  const rec: ParcelRecord = {
    ...input,
    id: input.id ?? newId(),
    areaM2: areaM2(input.geometry),
    createdAt: new Date().toISOString(),
  };
  await db.runAsync(
    `INSERT INTO parcels (id, name, geometry, boundary_source, boundary_meta, county_fips, zip, area_m2, created_at, updated_hlc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, geometry = excluded.geometry, boundary_source = excluded.boundary_source,
       boundary_meta = excluded.boundary_meta, county_fips = excluded.county_fips, zip = excluded.zip,
       area_m2 = excluded.area_m2, updated_hlc = excluded.updated_hlc, deleted = 0`,
    rec.id, rec.name, JSON.stringify(rec.geometry), rec.boundarySource, JSON.stringify(rec.boundaryMeta),
    rec.countyFips ?? null, rec.zip ?? null, rec.areaM2, rec.createdAt, clock().tick(),
  );
  await markPending('parcels', rec.id);
  return rec;
}

export async function deleteParcel(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE parcels SET deleted = 1, updated_hlc = ? WHERE id = ?', clock().tick(), id);
  await db.runAsync('DELETE FROM site_profiles WHERE parcel_id = ?', id);
  await markPending('parcels', id);
}

export async function getSiteProfile(parcelId: string): Promise<SiteProfile | undefined> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ profile: string }>('SELECT profile FROM site_profiles WHERE parcel_id = ?', parcelId);
  return r ? (JSON.parse(r.profile) as SiteProfile) : undefined;
}

export async function saveSiteProfile(parcelId: string, p: SiteProfile): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO site_profiles (parcel_id, profile, computed_at, updated_hlc) VALUES (?, ?, ?, ?)
     ON CONFLICT(parcel_id) DO UPDATE SET profile = excluded.profile, computed_at = excluded.computed_at, updated_hlc = excluded.updated_hlc`,
    parcelId, JSON.stringify(p), p.computedAt, clock().tick(),
  );
  await markPending('siteProfiles', parcelId);
}

export async function listUserEndpoints(): Promise<ParcelEndpoint[]> {
  const db = await getDb();
  return (await db.getAllAsync<{ endpoint: string }>('SELECT endpoint FROM user_parcel_endpoints')).map((r) => JSON.parse(r.endpoint));
}

export async function saveUserEndpoint(e: ParcelEndpoint): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO user_parcel_endpoints (id, endpoint) VALUES (?, ?)', e.id, JSON.stringify({ ...e, origin: 'user' }));
}
