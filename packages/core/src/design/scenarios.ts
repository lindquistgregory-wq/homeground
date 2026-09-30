/**
 * Multi-season scenarios (§10, Pro): alternative layouts of the same parcel tagged with a season and
 * year ("Summer 2027 with the high tunnel", "Winter layout"), compared against the main plan.
 * A scenario is stored as its own design, so it syncs like any design; the main plan is untouched.
 */
import { project, type LocalFrame } from '../geo/measure';
import type { DesignObject } from './design';
import { footprintAreaM2 } from './design';
import { objectType, type ObjectCategory } from './library';

export type ScenarioSeason = 'spring' | 'summer' | 'fall' | 'winter' | 'year-round';
export const SCENARIO_SEASONS: ScenarioSeason[] = ['spring', 'summer', 'fall', 'winter', 'year-round'];

export interface ScenarioMeta {
  season: ScenarioSeason;
  year?: number;
  /** Design this scenario was copied from. */
  basedOn?: string;
}

const SEASON_LABEL: Record<ScenarioSeason, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter', 'year-round': 'Year-round' };

export function scenarioLabel(m: ScenarioMeta): string {
  return m.year ? `${SEASON_LABEL[m.season]} ${m.year}` : SEASON_LABEL[m.season];
}

export function parseScenarioMeta(raw: unknown): ScenarioMeta | undefined {
  if (!raw) return undefined;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return undefined; }
  }
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (!SCENARIO_SEASONS.includes(o.season as ScenarioSeason)) return undefined;
  const year = typeof o.year === 'number' && Number.isInteger(o.year) && o.year > 1900 && o.year < 2200 ? o.year : undefined;
  return { season: o.season as ScenarioSeason, year, basedOn: typeof o.basedOn === 'string' ? o.basedOn : undefined };
}

/**
 * The sun period that matches a season, for the design screen's sun-hours layer. Keys match the design
 * screen's period ids.
 */
export function sunPeriodForSeason(s: ScenarioSeason): 'growing' | 'summer' | 'winter' | 'equinox' {
  return s === 'summer' ? 'summer' : s === 'winter' ? 'winter' : s === 'spring' || s === 'fall' ? 'equinox' : 'growing';
}

/** Copy objects for a new scenario with fresh ids (so the two plans never share an object id). */
export function copyObjects(objects: DesignObject[], newId: () => string): DesignObject[] {
  return objects.filter((o) => !o.existing).map((o) => ({ ...o, id: newId() })).concat(objects.filter((o) => o.existing));
}

export interface ScenarioDiff {
  /** Objects in B with no counterpart in A (by kind and position). */
  added: DesignObject[];
  removed: DesignObject[];
  moved: Array<{ from: DesignObject; to: DesignObject; distanceM: number }>;
  /** Planned area by category, m² (existing features excluded). */
  areaByCategory: Array<{ category: ObjectCategory; a: number; b: number }>;
}

const MATCH_M = 25;

/**
 * Compare two layouts. Objects are matched by kind and nearest position (ids differ between copies);
 * a match within 0.5 m is "unchanged", within 25 m is "moved", otherwise it's added/removed.
 */
export function compareScenarios(a: DesignObject[], b: DesignObject[], frame: LocalFrame): ScenarioDiff {
  const planned = (xs: DesignObject[]) => xs.filter((o) => !o.existing);
  const A = planned(a);
  const B = planned(b);
  const pos = (o: DesignObject) => project(frame, o.center);
  const used = new Set<number>();
  const moved: ScenarioDiff['moved'] = [];
  const removed: DesignObject[] = [];
  for (const oa of A) {
    const pa = pos(oa);
    let best = -1;
    let bestD = Infinity;
    B.forEach((ob, i) => {
      if (used.has(i) || ob.kind !== oa.kind) return;
      const pb = pos(ob);
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0 || bestD > MATCH_M) { removed.push(oa); continue; }
    used.add(best);
    if (bestD > 0.5) moved.push({ from: oa, to: B[best]!, distanceM: Math.round(bestD * 10) / 10 });
  }
  const added = B.filter((_, i) => !used.has(i));
  const cats = new Map<ObjectCategory, { a: number; b: number }>();
  const addArea = (o: DesignObject, k: 'a' | 'b') => {
    const cat = objectType(o.kind)?.category;
    if (!cat) return;
    const e = cats.get(cat) ?? { a: 0, b: 0 };
    e[k] += footprintAreaM2(o, frame);
    cats.set(cat, e);
  };
  A.forEach((o) => addArea(o, 'a'));
  B.forEach((o) => addArea(o, 'b'));
  const areaByCategory = [...cats.entries()].map(([category, v]) => ({ category, a: Math.round(v.a), b: Math.round(v.b) }));
  return { added, removed, moved, areaByCategory };
}
