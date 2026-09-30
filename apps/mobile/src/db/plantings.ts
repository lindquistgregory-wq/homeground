import { getDb } from './database';
import { clock, newId } from '../services/identity';

export type PlantingStatus = 'planned' | 'planted' | 'harvested' | 'removed';

export interface Planting {
  id: string;
  parcelId: string;
  designId: string;
  bedObjectId: string;
  plantId: string;
  variety?: string;
  year: number;
  share: number;
  status: PlantingStatus;
  plantedOn?: string;
  notes?: string;
  createdAt: string;
}

interface Row {
  id: string; parcel_id: string; design_id: string; bed_object_id: string; plant_id: string; variety: string | null;
  year: number; share: number; status: PlantingStatus; planted_on: string | null; notes: string | null; created_at: string;
}

const fromRow = (r: Row): Planting => ({
  id: r.id, parcelId: r.parcel_id, designId: r.design_id, bedObjectId: r.bed_object_id, plantId: r.plant_id, variety: r.variety ?? undefined,
  year: r.year, share: r.share, status: r.status, plantedOn: r.planted_on ?? undefined, notes: r.notes ?? undefined, createdAt: r.created_at,
});

export async function plantingsForParcel(parcelId: string): Promise<Planting[]> {
  const db = await getDb();
  return (await db.getAllAsync<Row>('SELECT * FROM plantings WHERE parcel_id = ? AND deleted = 0 ORDER BY year DESC, created_at', parcelId)).map(fromRow);
}

export async function plantingsForBed(designId: string, bedObjectId: string): Promise<Planting[]> {
  const db = await getDb();
  return (await db.getAllAsync<Row>('SELECT * FROM plantings WHERE design_id = ? AND bed_object_id = ? AND deleted = 0 ORDER BY year DESC, created_at', designId, bedObjectId)).map(fromRow);
}

export async function savePlanting(p: Omit<Planting, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<Planting> {
  const db = await getDb();
  const rec: Planting = { ...p, id: p.id ?? newId(), createdAt: p.createdAt ?? new Date().toISOString() };
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO plantings (id, parcel_id, design_id, bed_object_id, plant_id, variety, year, share, status, planted_on, notes, created_at, updated_hlc, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET plant_id = excluded.plant_id, variety = excluded.variety, year = excluded.year, share = excluded.share,
       status = excluded.status, planted_on = excluded.planted_on, notes = excluded.notes, updated_hlc = excluded.updated_hlc, deleted = 0`,
    rec.id, rec.parcelId, rec.designId, rec.bedObjectId, rec.plantId, rec.variety ?? null, rec.year, rec.share, rec.status,
    rec.plantedOn ?? null, rec.notes ?? null, rec.createdAt, hlc,
  );
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'plantings', rec.id, hlc);
  return rec;
}

export async function deletePlanting(id: string): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync('UPDATE plantings SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, id);
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'plantings', id, hlc);
}

/** Tombstone the plantings of a bed that was deleted from the design. */
export async function deletePlantingsForBed(designId: string, bedObjectId: string): Promise<number> {
  const rows = await plantingsForBed(designId, bedObjectId);
  for (const r of rows) await deletePlanting(r.id);
  return rows.length;
}

/** Tombstone every planting of a deleted parcel so other devices drop them too. */
export async function deletePlantingsForParcel(parcelId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM plantings WHERE parcel_id = ? AND deleted = 0', parcelId);
  for (const r of rows) await deletePlanting(r.id);
}
