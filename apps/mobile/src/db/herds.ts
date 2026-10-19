/**
 * Herds: a group of one species living in a housing object on the design (prompt §5), like plantings
 * for beds, or placed on the map without one (free-roaming: objectId '' and a location).
 */
import { getDb } from './database';
import { clock, newId } from '../services/identity';

export type HerdStatus = 'planned' | 'active' | 'retired' | 'sold' | 'processed';

export interface Herd {
  id: string;
  parcelId: string;
  designId: string;
  /** The housing object, or '' for animals placed on the map without one. */
  objectId: string;
  /** Where a free-roaming herd was placed on the map. */
  location?: { lon: number; lat: number };
  speciesId: string;
  breed?: string;
  purpose?: string;
  count: number;
  status: HerdStatus;
  arrivedOn?: string;
  bredOn?: string;
  notes?: string;
  createdAt: string;
}

interface Row {
  id: string; parcel_id: string; design_id: string; object_id: string; species_id: string; breed: string | null; purpose: string | null;
  count: number; status: HerdStatus; arrived_on: string | null; bred_on: string | null; notes: string | null; created_at: string;
  lon: number | null; lat: number | null;
}

const fromRow = (r: Row): Herd => ({
  id: r.id, parcelId: r.parcel_id, designId: r.design_id, objectId: r.object_id, speciesId: r.species_id, breed: r.breed ?? undefined,
  purpose: r.purpose ?? undefined, count: r.count, status: r.status, arrivedOn: r.arrived_on ?? undefined, bredOn: r.bred_on ?? undefined,
  notes: r.notes ?? undefined, createdAt: r.created_at, location: r.lon !== null && r.lat !== null ? { lon: r.lon, lat: r.lat } : undefined,
});

export async function herdsForParcel(parcelId: string): Promise<Herd[]> {
  const db = await getDb();
  return (await db.getAllAsync<Row>('SELECT * FROM herds WHERE parcel_id = ? AND deleted = 0 ORDER BY created_at', parcelId)).map(fromRow);
}

export async function herdsForObject(designId: string, objectId: string): Promise<Herd[]> {
  const db = await getDb();
  return (await db.getAllAsync<Row>('SELECT * FROM herds WHERE design_id = ? AND object_id = ? AND deleted = 0 ORDER BY created_at', designId, objectId)).map(fromRow);
}

export async function saveHerd(h: Omit<Herd, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<Herd> {
  const db = await getDb();
  const rec: Herd = { ...h, id: h.id ?? newId(), createdAt: h.createdAt ?? new Date().toISOString() };
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO herds (id, parcel_id, design_id, object_id, species_id, breed, purpose, count, status, arrived_on, bred_on, notes, created_at, updated_hlc, deleted, lon, lat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET species_id = excluded.species_id, breed = excluded.breed, purpose = excluded.purpose, count = excluded.count,
       status = excluded.status, arrived_on = excluded.arrived_on, bred_on = excluded.bred_on, notes = excluded.notes, updated_hlc = excluded.updated_hlc, deleted = 0,
       lon = excluded.lon, lat = excluded.lat`,
    rec.id, rec.parcelId, rec.designId, rec.objectId, rec.speciesId, rec.breed ?? null, rec.purpose ?? null, rec.count, rec.status,
    rec.arrivedOn ?? null, rec.bredOn ?? null, rec.notes ?? null, rec.createdAt, hlc, rec.location?.lon ?? null, rec.location?.lat ?? null,
  );
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'herds', rec.id, hlc);
  return rec;
}

export async function deleteHerd(id: string): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync('UPDATE herds SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, id);
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'herds', id, hlc);
}

/** Tombstone the herds of a housing object that was deleted from the design. */
export async function deleteHerdsForObject(designId: string, objectId: string): Promise<number> {
  const rows = await herdsForObject(designId, objectId);
  for (const r of rows) await deleteHerd(r.id);
  return rows.length;
}

/** Tombstone every herd of a deleted parcel so other devices drop them too. */
export async function deleteHerdsForParcel(parcelId: string): Promise<void> {
  for (const r of await herdsForParcel(parcelId)) await deleteHerd(r.id);
}
