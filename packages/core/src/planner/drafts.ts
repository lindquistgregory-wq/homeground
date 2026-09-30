/**
 * Drafts (§9.1 "never let the model write directly to the design — it proposes drafts"). The planner and
 * any on-device model can only produce these; the app shows them and applies one only when the user
 * approves it. Validation rejects unknown object kinds, silly sizes and unknown plants.
 */
import { objectType } from '../design/library';
import type { DesignObject } from '../design/design';
import { plantById } from '../plants/index';

export interface DraftObject {
  op: 'add';
  kind: string;
  label?: string;
  /** Metres; defaults to the library size. */
  width?: number;
  length?: number;
  count?: number;
  /** Where it should go, in words the placement step understands. */
  near?: 'garden' | 'house' | 'sunny' | 'edge' | 'anywhere';
  /** Crops intended for a bed (plant ids). */
  plants?: string[];
  /** Square feet the plan gives each crop, so beds can be shared in the right proportions. */
  plantAreas?: Record<string, number>;
}

export interface DraftRemoval {
  op: 'remove';
  objectId: string;
  reason?: string;
}

export interface DesignDraft {
  id: string;
  summary: string;
  changes: Array<DraftObject | DraftRemoval>;
  why: string[];
  createdBy: 'rules' | 'model';
}

export interface TaskDraft {
  title: string;
  /** ISO date (YYYY-MM-DD) or a month name for rough timing. */
  due?: string;
  category: 'build' | 'plant' | 'animals' | 'buy' | 'learn' | 'admin';
  notes?: string;
}

export interface DraftCheck {
  ok: boolean;
  problems: string[];
  cleaned: DesignDraft;
}

const MAX_COUNT = 50;

export function validateDesignDraft(d: DesignDraft, existing: Array<Pick<DesignObject, 'id'>>): DraftCheck {
  const problems: string[] = [];
  const ids = new Set(existing.map((o) => o.id));
  const changes: DesignDraft['changes'] = [];
  for (const c of d.changes ?? []) {
    if (c.op === 'remove') {
      if (!ids.has(c.objectId)) problems.push(`No object ${c.objectId} to remove.`);
      else changes.push(c);
      continue;
    }
    const t = objectType(c.kind);
    if (!t) { problems.push(`Unknown object type “${c.kind}”.`); continue; }
    // Large counts are split into several changes of at most MAX_COUNT (a big garden is still one draft).
    const total = Math.max(1, Math.min(MAX_COUNT * 10, Math.round(Number.isFinite(c.count) ? c.count! : 1)));
    if ((c.count ?? 1) > MAX_COUNT * 10) problems.push(`At most ${MAX_COUNT * 10} ${t.name.toLowerCase()} in one draft.`);
    const size = (v: number | undefined, def: number) => (v === undefined || !Number.isFinite(v) || v <= 0 || v > 200 ? def : v);
    const plants = (c.plants ?? []).filter((p) => {
      const ok = !!plantById(p);
      if (!ok) problems.push(`Unknown plant “${p}”.`);
      return ok;
    });
    const plantAreas = c.plantAreas ? Object.fromEntries(Object.entries(c.plantAreas).filter(([k, v]) => plants.includes(k) && Number.isFinite(v) && v > 0)) : undefined;
    for (let left = total; left > 0; left -= MAX_COUNT) {
      changes.push({ ...c, count: Math.min(MAX_COUNT, left), width: size(c.width, t.width), length: size(c.length, t.length), plants: plants.length ? plants : undefined, plantAreas });
    }
  }
  if (!changes.length) problems.push('The draft has no valid changes.');
  return { ok: problems.length === 0 && changes.length > 0, problems, cleaned: { ...d, changes } };
}

export function validateTasks(tasks: TaskDraft[]): { tasks: TaskDraft[]; problems: string[] } {
  const problems: string[] = [];
  const out: TaskDraft[] = [];
  for (const t of tasks ?? []) {
    const title = String(t.title ?? '').trim().slice(0, 120);
    if (!title) { problems.push('A task has no title.'); continue; }
    const cat = ['build', 'plant', 'animals', 'buy', 'learn', 'admin'].includes(t.category) ? t.category : 'admin';
    const due = t.due && (/^\d{4}-\d{2}-\d{2}$/.test(t.due) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t.due)) ? t.due : undefined;
    out.push({ title, category: cat, due, notes: t.notes ? String(t.notes).slice(0, 300) : undefined });
  }
  return { tasks: out.slice(0, 30), problems };
}
