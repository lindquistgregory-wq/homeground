/**
 * Planner storage. The goals profile and approved tasks sync through the user's own cloud; the chat,
 * cached plans and pending drafts stay on this device (the conversation is never uploaded anywhere).
 */
import type { DesignDraft, HomesteadGoals, TaskDraft } from '@plotwright/core';
import { getDb } from './database';
import { clock, newId } from '../services/identity';

async function markPending(collection: 'plannerGoals' | 'tasks', id: string, hlc: string) {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO sync_pending (collection, id, hlc) VALUES (?, ?, ?)', collection, id, hlc);
}

// ---------------- Goals ----------------

export async function getGoals(parcelId: string): Promise<HomesteadGoals> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ goals: string }>('SELECT goals FROM planner_goals WHERE parcel_id = ? AND deleted = 0', parcelId);
  if (!r) return {};
  try {
    return JSON.parse(r.goals) as HomesteadGoals;
  } catch {
    return {};
  }
}

export async function saveGoals(parcelId: string, goals: HomesteadGoals): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO planner_goals (parcel_id, goals, updated_hlc, deleted) VALUES (?, ?, ?, 0)
     ON CONFLICT(parcel_id) DO UPDATE SET goals = excluded.goals, updated_hlc = excluded.updated_hlc, deleted = 0`,
    parcelId, JSON.stringify(goals), hlc,
  );
  await markPending('plannerGoals', parcelId, hlc);
}

// ---------------- Conversation (local only) ----------------

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  meta?: { model?: string; tools?: string[]; safety?: string; unverified?: string[] };
  createdAt: string;
}

export async function listMessages(parcelId: string, limit = 60): Promise<StoredMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; role: 'user' | 'assistant'; text: string; meta: string | null; created_at: string }>(
    'SELECT * FROM (SELECT * FROM planner_messages WHERE parcel_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at', parcelId, limit);
  return rows.map((r) => ({ id: r.id, role: r.role, text: r.text, meta: r.meta ? JSON.parse(r.meta) : undefined, createdAt: r.created_at }));
}

export async function addMessage(parcelId: string, role: 'user' | 'assistant', text: string, meta?: StoredMessage['meta']): Promise<StoredMessage> {
  const db = await getDb();
  const m: StoredMessage = { id: newId(), role, text, meta, createdAt: new Date().toISOString() };
  await db.runAsync('INSERT INTO planner_messages (id, parcel_id, role, text, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)', m.id, parcelId, role, text, meta ? JSON.stringify(meta) : null, m.createdAt);
  return m;
}

export async function clearMessages(parcelId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM planner_messages WHERE parcel_id = ?', parcelId);
}

// ---------------- Drafts (local only, until approved) ----------------

export type DraftRow =
  | { id: string; kind: 'design'; payload: DesignDraft; status: 'pending' | 'approved' | 'rejected'; createdAt: string }
  | { id: string; kind: 'tasks'; payload: TaskDraft[]; status: 'pending' | 'approved' | 'rejected'; createdAt: string };

export async function saveDraft(parcelId: string, kind: 'design', payload: DesignDraft): Promise<string>;
export async function saveDraft(parcelId: string, kind: 'tasks', payload: TaskDraft[]): Promise<string>;
export async function saveDraft(parcelId: string, kind: 'design' | 'tasks', payload: DesignDraft | TaskDraft[]): Promise<string> {
  const db = await getDb();
  const id = kind === 'design' ? (payload as DesignDraft).id : newId();
  await db.runAsync('INSERT OR REPLACE INTO planner_drafts (id, parcel_id, kind, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, parcelId, kind, JSON.stringify(payload), 'pending', new Date().toISOString());
  return id;
}

export async function listDrafts(parcelId: string, status: 'pending' | 'all' = 'pending'): Promise<DraftRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; kind: 'design' | 'tasks'; payload: string; status: DraftRow['status']; created_at: string }>(
    status === 'pending' ? "SELECT * FROM planner_drafts WHERE parcel_id = ? AND status = 'pending' ORDER BY created_at" : 'SELECT * FROM planner_drafts WHERE parcel_id = ? ORDER BY created_at', parcelId);
  return rows.map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload), status: r.status, createdAt: r.created_at }) as DraftRow);
}

export async function setDraftStatus(id: string, status: 'approved' | 'rejected'): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE planner_drafts SET status = ? WHERE id = ?', status, id);
}

// ---------------- Tasks (synced) ----------------

export interface TaskRecord extends TaskDraft {
  id: string;
  parcelId: string;
  done: boolean;
  createdAt: string;
}

export async function listTasks(parcelId: string): Promise<TaskRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; parcel_id: string; title: string; due: string | null; category: TaskDraft['category']; notes: string | null; done: number; created_at: string }>(
    'SELECT * FROM tasks WHERE parcel_id = ? AND deleted = 0 ORDER BY done, COALESCE(due, created_at)', parcelId);
  return rows.map((r) => ({ id: r.id, parcelId: r.parcel_id, title: r.title, due: r.due ?? undefined, category: r.category, notes: r.notes ?? undefined, done: r.done === 1, createdAt: r.created_at }));
}

export async function saveTask(t: Omit<TaskRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<TaskRecord> {
  const db = await getDb();
  const rec: TaskRecord = { ...t, id: t.id ?? newId(), createdAt: t.createdAt ?? new Date().toISOString() };
  const hlc = clock().tick();
  await db.runAsync(
    `INSERT INTO tasks (id, parcel_id, title, due, category, notes, done, created_at, updated_hlc, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, due = excluded.due, category = excluded.category, notes = excluded.notes, done = excluded.done, updated_hlc = excluded.updated_hlc, deleted = 0`,
    rec.id, rec.parcelId, rec.title, rec.due ?? null, rec.category, rec.notes ?? null, rec.done ? 1 : 0, rec.createdAt, hlc,
  );
  await markPending('tasks', rec.id, hlc);
  return rec;
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync('UPDATE tasks SET deleted = 1, updated_hlc = ? WHERE id = ?', hlc, id);
  await markPending('tasks', id, hlc);
}

/** Remove planner data for a deleted parcel (goals and tasks tombstoned for other devices). */
export async function deletePlannerForParcel(parcelId: string): Promise<void> {
  const db = await getDb();
  const hlc = clock().tick();
  await db.runAsync('UPDATE planner_goals SET deleted = 1, updated_hlc = ? WHERE parcel_id = ?', hlc, parcelId);
  await markPending('plannerGoals', parcelId, hlc);
  for (const t of await listTasks(parcelId)) await deleteTask(t.id);
  await db.runAsync('DELETE FROM planner_messages WHERE parcel_id = ?', parcelId);
  await db.runAsync('DELETE FROM planner_drafts WHERE parcel_id = ?', parcelId);
}
