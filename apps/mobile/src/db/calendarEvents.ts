/** The user's own calendar events, synced to their own cloud like tasks and plantings. */
import type { CustomEvent } from '@plotwright/core';
import { getDb } from './database';
import { clock, newId } from '../services/identity';

export async function eventsForParcel(parcelId: string): Promise<CustomEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM calendar_events WHERE parcel_id = ? AND deleted = 0 ORDER BY date', parcelId);
  return rows.flatMap((r) => { try { return [JSON.parse(r.data) as CustomEvent]; } catch { return []; } });
}

export async function allEvents(): Promise<CustomEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM calendar_events WHERE deleted = 0');
  return rows.flatMap((r) => { try { return [JSON.parse(r.data) as CustomEvent]; } catch { return []; } });
}

export async function saveEvent(e: Omit<CustomEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<CustomEvent> {
  const db = await getDb();
  const rec: CustomEvent = { ...e, id: e.id ?? newId(), createdAt: e.createdAt ?? new Date().toISOString() };
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO calendar_events (id, parcel_id, date, data, created_at, updated_hlc, deleted) VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET parcel_id = excluded.parcel_id, date = excluded.date, data = excluded.data, updated_hlc = excluded.updated_hlc, deleted = 0`,
    rec.id, rec.parcelId, rec.date, JSON.stringify(rec), rec.createdAt, hlc,
  );
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'calendarEvents', rec.id, hlc);
  return rec;
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync('UPDATE calendar_events SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, id);
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', 'calendarEvents', id, hlc);
}

/** Tombstone a deleted property's events. */
export async function deleteEventsForParcel(parcelId: string): Promise<void> {
  for (const e of await eventsForParcel(parcelId)) await deleteEvent(e.id);
}
