import type { PlantSpec } from '@plotwright/core';
import { getDb } from './database';
import { clock } from '../services/identity';
import type { ArtSpec } from '../components/plantArtMap';

/** A plant the user added to their library, with the icon they picked for it. */
export interface CustomPlant {
  spec: PlantSpec;
  art: ArtSpec;
  createdAt: string;
}

interface Row { id: string; spec: string; art: string; created_at: string }

function fromRow(r: Row): CustomPlant | undefined {
  try {
    const spec = JSON.parse(r.spec) as PlantSpec;
    const art = JSON.parse(r.art) as ArtSpec;
    // The id column is authoritative, so a spec can't claim a bundled plant's id.
    return spec && art?.shape ? { spec: { ...spec, id: r.id }, art, createdAt: r.created_at } : undefined;
  } catch {
    return undefined;
  }
}

export async function listCustomPlants(): Promise<CustomPlant[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT id, spec, art, created_at FROM custom_plants WHERE deleted = 0 ORDER BY created_at');
  return rows.flatMap((r) => fromRow(r) ?? []);
}

export async function saveCustomPlant(p: { spec: PlantSpec; art: ArtSpec; createdAt?: string }): Promise<CustomPlant> {
  const db = await getDb();
  const rec: CustomPlant = { spec: p.spec, art: p.art, createdAt: p.createdAt ?? new Date().toISOString() };
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO custom_plants (id, spec, art, created_at, updated_hlc, deleted) VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET spec = excluded.spec, art = excluded.art, updated_hlc = excluded.updated_hlc, deleted = 0`,
    rec.spec.id, JSON.stringify(rec.spec), JSON.stringify(rec.art), rec.createdAt, hlc,
  );
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'customPlants', rec.spec.id, hlc);
  return rec;
}

export async function deleteCustomPlant(id: string): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync('UPDATE custom_plants SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, id);
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'customPlants', id, hlc);
}

/** How many plantings (not deleted) use this plant, so deleting it can warn first. */
export async function plantingsUsing(plantId: string): Promise<number> {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM plantings WHERE plant_id = ? AND deleted = 0', plantId))?.n ?? 0;
}
