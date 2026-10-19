/**
 * Animal records storage (livestock phase 5): individuals and pets, production logs, breeding and
 * health records. One shape for all four tables (a few indexed columns plus JSON `data`), synced to
 * the user's own cloud like plantings and herds.
 */
import type { AnimalLog, AnimalRecord, BreedingRecord, HealthRecord } from '@plotwright/core';
import { getDb } from './database';
import { clock, newId } from '../services/identity';

export type RecordCollection = 'animals' | 'animalLogs' | 'breedingRecords' | 'healthRecords';

interface TableDef<T> {
  table: string;
  /** Indexed columns written from the record (besides id, data, created_at, updated_hlc, deleted). */
  cols: (r: T) => Record<string, string | null>;
}

const DEFS: { animals: TableDef<AnimalRecord>; animalLogs: TableDef<AnimalLog>; breedingRecords: TableDef<BreedingRecord>; healthRecords: TableDef<HealthRecord> } = {
  animals: { table: 'animals', cols: (r) => ({ parcel_id: r.parcelId ?? null, herd_id: r.herdId ?? null, species_id: r.speciesId, status: r.status }) },
  animalLogs: { table: 'animal_logs', cols: (r) => ({ parcel_id: r.parcelId ?? null, animal_id: r.animalId ?? null, herd_id: r.herdId ?? null, date: r.date, kind: r.kind }) },
  breedingRecords: { table: 'breeding_records', cols: (r) => ({ parcel_id: r.parcelId ?? null, animal_id: r.damId ?? null, herd_id: r.herdId ?? null, date: r.bredOn }) },
  healthRecords: { table: 'health_records', cols: (r) => ({ parcel_id: r.parcelId ?? null, animal_id: r.animalId ?? null, herd_id: r.herdId ?? null, date: r.date }) },
};

export const RECORD_TABLES: Record<RecordCollection, string> = {
  animals: 'animals', animalLogs: 'animal_logs', breedingRecords: 'breeding_records', healthRecords: 'health_records',
};

type RecordOf<C extends RecordCollection> = C extends 'animals' ? AnimalRecord : C extends 'animalLogs' ? AnimalLog : C extends 'breedingRecords' ? BreedingRecord : HealthRecord;

/** Write one record (insert or update) and queue it for sync. */
export async function saveRecord<C extends RecordCollection>(c: C, r: Omit<RecordOf<C>, 'id'> & { id?: string }): Promise<RecordOf<C>> {
  const db = await getDb();
  const rec = { ...r, id: r.id ?? newId() } as RecordOf<C>;
  const def = DEFS[c] as unknown as TableDef<RecordOf<C>>;
  const cols = def.cols(rec);
  const names = Object.keys(cols);
  const createdAt = (rec as { createdAt?: string }).createdAt ?? new Date().toISOString();
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO ${def.table} (id, ${names.join(', ')}, data, created_at, updated_hlc, deleted) VALUES (?, ${names.map(() => '?').join(', ')}, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET ${names.map((n) => `${n} = excluded.${n}`).join(', ')}, data = excluded.data, updated_hlc = excluded.updated_hlc, deleted = 0`,
    rec.id, ...names.map((n) => cols[n]!), JSON.stringify(rec), createdAt, hlc,
  );
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', c, rec.id, hlc);
  return rec;
}

export async function deleteRecord(c: RecordCollection, id: string): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync(`UPDATE ${RECORD_TABLES[c]} SET deleted = 1, updated_hlc = ? WHERE id = ?`, hlc, id);
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', c, id, hlc);
}

async function query<C extends RecordCollection>(c: C, where: string, ...args: Array<string | null>): Promise<Array<RecordOf<C>>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ data: string }>(`SELECT data FROM ${RECORD_TABLES[c]} WHERE deleted = 0${where ? ` AND ${where}` : ''} ORDER BY created_at`, ...args);
  return rows.flatMap((r) => { try { return [JSON.parse(r.data) as RecordOf<C>]; } catch { return []; } });
}

/** Every animal and pet on this device (all properties). */
export const listAnimals = () => query('animals', '');
export const getAnimal = async (id: string) => (await query('animals', 'id = ?', id))[0];
export const animalsInHerd = (herdId: string) => query('animals', 'herd_id = ?', herdId);

/** Records for one animal or one herd (the group's own records, not its members'). */
export function recordsFor<C extends Exclude<RecordCollection, 'animals'>>(c: C, owner: { animalId?: string; herdId?: string }): Promise<Array<RecordOf<C>>> {
  return owner.animalId ? query(c, 'animal_id = ?', owner.animalId) : query(c, 'herd_id = ? AND animal_id IS NULL', owner.herdId ?? '');
}
export const allRecords = <C extends Exclude<RecordCollection, 'animals'>>(c: C) => query(c, '');

/** Remove an animal and every record about it (so nothing about it keeps raising reminders). */
export async function deleteAnimalAndRecords(id: string): Promise<void> {
  for (const c of ['animalLogs', 'breedingRecords', 'healthRecords'] as const) for (const r of await recordsFor(c, { animalId: id })) await deleteRecord(c, r.id);
  await deleteRecord('animals', id);
}

/** Tombstone a deleted property's livestock records (pets have no property and stay). */
export async function deleteRecordsForParcel(parcelId: string): Promise<void> {
  for (const c of ['animals', 'animalLogs', 'breedingRecords', 'healthRecords'] as const) for (const r of await query(c, 'parcel_id = ?', parcelId)) await deleteRecord(c, r.id);
}

/** Sync: one record as stored (for upload). */
export async function recordRow(c: RecordCollection, id: string): Promise<{ hlc: string; deleted: boolean; data: Record<string, unknown> } | undefined> {
  const db = await getDb();
  const r = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${RECORD_TABLES[c]} WHERE id = ?`, id);
  return r ? { hlc: String(r.updated_hlc), deleted: r.deleted === 1, data: r } : undefined;
}

/** Indexed columns per table, in order; the NOT NULL ones fall back to ''. */
const COLS: Record<RecordCollection, string[]> = {
  animals: ['parcel_id', 'herd_id', 'species_id', 'status'],
  animalLogs: ['parcel_id', 'animal_id', 'herd_id', 'date', 'kind'],
  breedingRecords: ['parcel_id', 'animal_id', 'herd_id', 'date'],
  healthRecords: ['parcel_id', 'animal_id', 'herd_id', 'date'],
};
const NOT_NULL = new Set(['species_id', 'status', 'date', 'kind']);

/** Sync: apply a record from another device (the whole row, as uploaded). */
export async function applyRecordRow(c: RecordCollection, id: string, hlc: string, deleted: boolean, d: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  const names = COLS[c];
  const val = (n: string) => (d[n] === undefined || d[n] === null ? (NOT_NULL.has(n) ? '' : null) : String(d[n]));
  await db.runAsync(
    `INSERT INTO ${RECORD_TABLES[c]} (id, ${names.join(', ')}, data, created_at, updated_hlc, deleted) VALUES (?, ${names.map(() => '?').join(', ')}, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ${names.map((n) => `${n} = excluded.${n}`).join(', ')}, data = excluded.data, updated_hlc = excluded.updated_hlc, deleted = excluded.deleted`,
    id, ...names.map(val), String(d.data ?? '{}'), String(d.created_at ?? new Date().toISOString()), hlc, deleted ? 1 : 0,
  );
}
