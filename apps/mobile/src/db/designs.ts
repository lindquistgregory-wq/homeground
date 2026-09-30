import { copyObjects, parseScenarioMeta, scenarioLabel, type Design, type DesignObject, type DesignVersion, type ScenarioMeta } from '@plotwright/core';
import { getDb } from './database';
import { clock, newId } from '../services/identity';

interface Row {
  id: string;
  parcel_id: string;
  name: string;
  objects: string;
  created_at: string;
  updated_at: string;
  scenario?: string | null;
}

const fromRow = (r: Row): Design => ({
  id: r.id, parcelId: r.parcel_id, name: r.name, objects: JSON.parse(r.objects) as DesignObject[], createdAt: r.created_at, updatedAt: r.updated_at,
  scenario: parseScenarioMeta(r.scenario),
});

/** The main plan's id is the same on every device, so the first sync merges instead of duplicating. */
export const mainDesignId = (parcelId: string) => `design-${parcelId}`;

/** Tombstone every design of a deleted parcel so other devices drop them too. */
export async function deleteDesignsForParcel(parcelId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM designs WHERE parcel_id = ? AND deleted = 0', parcelId);
  for (const r of rows) {
    const hlc = clock().tick();
    await db.runAsync('UPDATE designs SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, r.id);
    await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'designs', r.id, hlc);
  }
  await db.runAsync('DELETE FROM design_versions WHERE design_id IN (SELECT id FROM designs WHERE parcel_id = ?)', parcelId);
}

/** Main plans only (scenarios are listed with listScenarios). */
export async function designsForParcel(parcelId: string): Promise<Design[]> {
  const db = await getDb();
  return (await db.getAllAsync<Row>('SELECT * FROM designs WHERE parcel_id = ? AND deleted = 0 AND scenario IS NULL ORDER BY created_at', parcelId)).map(fromRow);
}

export async function listScenarios(parcelId: string): Promise<Design[]> {
  const db = await getDb();
  return (await db.getAllAsync<Row>('SELECT * FROM designs WHERE parcel_id = ? AND deleted = 0 AND scenario IS NOT NULL ORDER BY created_at', parcelId)).map(fromRow);
}

/** A season/year alternative copied from `from` (new object ids, so the two never collide). */
export async function createScenario(from: Design, meta: ScenarioMeta): Promise<Design> {
  const now = new Date().toISOString();
  const d: Design = {
    id: `scenario-${newId()}`, parcelId: from.parcelId, name: scenarioLabel(meta), objects: copyObjects(from.objects, newId),
    createdAt: now, updatedAt: now, scenario: { ...meta, basedOn: from.id },
  };
  await saveDesign(d);
  return d;
}

export async function deleteScenario(d: Design): Promise<void> {
  if (!d.scenario) throw new Error('Only scenarios can be deleted here.');
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync('UPDATE designs SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, d.id);
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'designs', d.id, hlc);
  await db.runAsync('DELETE FROM design_versions WHERE design_id = ?', d.id);
}

export async function getDesign(id: string): Promise<Design | undefined> {
  const db = await getDb();
  const r = await db.getFirstAsync<Row>('SELECT * FROM designs WHERE id = ? AND deleted = 0', id);
  return r ? fromRow(r) : undefined;
}

export async function getOrCreateDesign(parcelId: string): Promise<Design> {
  const existing = (await getDesign(mainDesignId(parcelId))) ?? (await designsForParcel(parcelId))[0];
  if (existing && !existing.scenario) return existing;
  const now = new Date().toISOString();
  // Same id on every device so the first sync merges into one plan instead of creating two.
  const d: Design = { id: mainDesignId(parcelId), parcelId, name: 'Main plan', objects: [], createdAt: now, updatedAt: now };
  await saveDesign(d);
  return d;
}

export async function saveDesign(d: Design): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO designs (id, parcel_id, name, objects, created_at, updated_at, updated_hlc, scenario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, objects = excluded.objects, updated_at = excluded.updated_at,
       updated_hlc = excluded.updated_hlc, deleted = 0, scenario = excluded.scenario`,
    d.id, d.parcelId, d.name, JSON.stringify(d.objects), d.createdAt, now, hlc, d.scenario ? JSON.stringify(d.scenario) : null,
  );
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'designs', d.id, hlc);
}

export async function saveVersion(d: Design, label: string): Promise<DesignVersion> {
  const db = await getDb();
  const v: DesignVersion = { id: newId(), designId: d.id, label, createdAt: new Date().toISOString(), objects: d.objects };
  await db.runAsync('INSERT INTO design_versions (id, design_id, label, created_at, objects) VALUES (?, ?, ?, ?, ?)', v.id, v.designId, v.label, v.createdAt, JSON.stringify(v.objects));
  return v;
}

export async function listVersions(designId: string): Promise<DesignVersion[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; design_id: string; label: string; created_at: string; objects: string }>(
    'SELECT * FROM design_versions WHERE design_id = ? ORDER BY created_at DESC', designId,
  );
  return rows.map((r) => ({ id: r.id, designId: r.design_id, label: r.label, createdAt: r.created_at, objects: JSON.parse(r.objects) }));
}

export async function recordSunCheck(c: { parcelId: string; lat: number; lon: number; observedSun: boolean; modeledSun: boolean | null }): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO sun_checks (id, parcel_id, lat, lon, at, observed_sun, modeled_sun) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(), c.parcelId, c.lat, c.lon, new Date().toISOString(), c.observedSun ? 1 : 0, c.modeledSun === null ? null : c.modeledSun ? 1 : 0,
  );
}

export async function sunCheckAgreement(parcelId: string): Promise<{ total: number; agree: number }> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ total: number; agree: number }>(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN observed_sun = modeled_sun THEN 1 ELSE 0 END) AS agree FROM sun_checks WHERE parcel_id = ? AND modeled_sun IS NOT NULL',
    parcelId,
  );
  return { total: r?.total ?? 0, agree: r?.agree ?? 0 };
}
