import type { AnimalSpec } from '@plotwright/core';
import { getDb } from './database';
import { clock } from '../services/identity';
import type { AnimalArtSpec } from '../components/animalArtMap';

/** An animal the user added to their library, with the drawing they picked for it. */
export interface CustomAnimal {
  spec: AnimalSpec;
  art: AnimalArtSpec;
  createdAt: string;
}

interface Row { id: string; spec: string; art: string; created_at: string }

function fromRow(r: Row): CustomAnimal | undefined {
  try {
    const spec = JSON.parse(r.spec) as AnimalSpec;
    const art = JSON.parse(r.art) as AnimalArtSpec;
    // The id column is authoritative, so a spec can't claim a bundled species' id.
    return spec && art?.shape ? { spec: { ...spec, id: r.id }, art, createdAt: r.created_at } : undefined;
  } catch {
    return undefined;
  }
}

export async function listCustomAnimals(): Promise<CustomAnimal[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT id, spec, art, created_at FROM custom_animals WHERE deleted = 0 ORDER BY created_at');
  return rows.flatMap((r) => fromRow(r) ?? []);
}

export async function saveCustomAnimal(p: { spec: AnimalSpec; art: AnimalArtSpec; createdAt?: string }): Promise<CustomAnimal> {
  const db = await getDb();
  const rec: CustomAnimal = { spec: p.spec, art: p.art, createdAt: p.createdAt ?? new Date().toISOString() };
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO custom_animals (id, spec, art, created_at, updated_hlc, deleted) VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET spec = excluded.spec, art = excluded.art, updated_hlc = excluded.updated_hlc, deleted = 0`,
    rec.spec.id, JSON.stringify(rec.spec), JSON.stringify(rec.art), rec.createdAt, hlc,
  );
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'customAnimals', rec.spec.id, hlc);
  return rec;
}

export async function deleteCustomAnimal(id: string): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync('UPDATE custom_animals SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, id);
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'customAnimals', id, hlc);
}

/** How many herds and animal records use this species, so deleting it can warn first. */
export async function recordsUsingSpecies(id: string): Promise<number> {
  const db = await getDb();
  const h = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM herds WHERE species_id = ? AND deleted = 0', id))?.n ?? 0;
  const a = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM animals WHERE species_id = ? AND deleted = 0', id))?.n ?? 0;
  return h + a;
}
