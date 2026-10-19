/**
 * Herd Book (prompt §7; paid, `livestock.herdBook`): pedigree, inbreeding, merit and breeding
 * suggestions, all deterministic and on the phone. The on-device model only explains these results.
 *
 * Inbreeding uses the tabular (kinship) method: the coefficient of inbreeding (COI) of an animal is
 * the kinship of its parents, and kinship counts each common ancestor's own inbreeding. Unknown
 * parents contribute nothing to the sum, so a shallow pedigree reads LOW; `pedigreeDepth` says how
 * much is known so the app can warn. Never for household pets.
 */
import type { AnimalLog, AnimalRecord } from './records';
import type { AnimalSpec } from './types';

/** Default: suggestions only below 5% (owner decision; the most conservative widely cited level). */
export const COI_DEFAULT_LIMIT = 0.05;
/** The looser livestock rule of thumb (offspring of first cousins). No setting goes above it. */
export const COI_MAX_LIMIT = 0.0625;

/** Clamp a user's limit: lowering is free; raising past 5% needs `acknowledged`; never above 6.25%. */
export function coiLimit(requested: number | undefined, acknowledged = false): number {
  if (requested === undefined || !Number.isFinite(requested)) return COI_DEFAULT_LIMIT;
  const r = Math.max(0, requested);
  if (r <= COI_DEFAULT_LIMIT) return r;
  return acknowledged ? Math.min(r, COI_MAX_LIMIT) : COI_DEFAULT_LIMIT;
}

export type PedigreeAnimal = Pick<AnimalRecord, 'id' | 'name' | 'sex' | 'speciesId' | 'sireId' | 'damId' | 'outsideSire' | 'outsideDam' | 'birthDate' | 'status' | 'herdId' | 'traits'>;

export class Pedigree {
  private readonly byId: Map<string, PedigreeAnimal>;
  private readonly kin = new Map<string, number>();
  private readonly gen = new Map<string, number>();

  constructor(animals: PedigreeAnimal[]) {
    this.byId = new Map(animals.map((a) => [a.id, a]));
  }

  get(id: string | undefined): PedigreeAnimal | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  private parents(id: string): [string | undefined, string | undefined] {
    const a = this.byId.get(id);
    // A parent id that isn't in the records (or a loop back to itself) counts as unknown.
    const ok = (p?: string) => (p && p !== id && this.byId.has(p) ? p : undefined);
    return [ok(a?.sireId), ok(a?.damId)];
  }

  /** Generations back to the furthest known ancestor (founders are 0); guards against loops. */
  generation(id: string, seen = new Set<string>()): number {
    const g = this.gen.get(id);
    if (g !== undefined) return g;
    if (seen.has(id)) return 0;
    seen.add(id);
    const [s, d] = this.parents(id);
    const v = Math.max(s ? this.generation(s, seen) + 1 : 0, d ? this.generation(d, seen) + 1 : 0);
    seen.delete(id);
    this.gen.set(id, v);
    return v;
  }

  /** Kinship coefficient f(a, b): the chance that alleles drawn from a and b are identical by descent. */
  kinship(a: string | undefined, b: string | undefined, depth = 0): number {
    if (!a || !b || depth > 60) return 0;
    if (a === b) return 0.5 * (1 + this.coi(a, depth + 1));
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const hit = this.kin.get(key);
    if (hit !== undefined) return hit;
    // Expand the younger animal (more generations behind it), so an ancestor is never expanded past its descendant.
    const [young, old] = this.generation(a) >= this.generation(b) ? [a, b] : [b, a];
    const [s, d] = this.parents(young);
    const v = s === undefined && d === undefined ? 0 : 0.5 * (this.kinship(s, old, depth + 1) + this.kinship(d, old, depth + 1));
    this.kin.set(key, v);
    return v;
  }

  /** COI of a recorded animal: the kinship of its parents. */
  coi(id: string, depth = 0): number {
    const [s, d] = this.parents(id);
    return this.kinship(s, d, depth);
  }

  /** COI of offspring from a proposed pairing. */
  pairingCoi(sireId: string, damId: string): number {
    return this.kinship(sireId, damId);
  }

  /** Relatedness of two animals (Wright's additive relationship, 2 × kinship, for non-inbred animals). */
  relatedness(a: string, b: string): number {
    return 2 * this.kinship(a, b);
  }

  /**
   * How complete the pedigree is behind an animal: the share of ancestors known in each of the
   * first `generations` generations (1 = both parents known), averaged (MacCluer-style).
   */
  pedigreeDepth(id: string, generations = 4): { completeness: number; knownGenerations: number } {
    let frontier: Array<string | undefined> = [id];
    let sum = 0, known = 0;
    for (let g = 1; g <= generations; g++) {
      const next: Array<string | undefined> = [];
      for (const x of frontier) { const [s, d] = x ? this.parents(x) : [undefined, undefined]; next.push(s, d); }
      const share = next.filter(Boolean).length / next.length;
      sum += share;
      if (share > 0) known = g;
      frontier = next;
    }
    return { completeness: sum / generations, knownGenerations: known };
  }

  /** Ancestors to `generations` back, as a tree (outside parents by name; unknown ones marked). */
  tree(id: string, generations = 4): PedigreeNode {
    const build = (x: string | undefined, outside: string | undefined, g: number): PedigreeNode => {
      const a = this.get(x);
      if (!a) return { name: outside ?? 'Unknown', unknown: !outside, outside: !!outside };
      if (g >= generations) return { id: a.id, name: a.name, coi: this.coi(a.id) };
      const [s, d] = this.parents(a.id);
      return { id: a.id, name: a.name, coi: this.coi(a.id), sire: build(s, s ? undefined : a.outsideSire?.name, g + 1), dam: build(d, d ? undefined : a.outsideDam?.name, g + 1) };
    };
    return build(id, undefined, 0);
  }

  offspring(id: string): PedigreeAnimal[] {
    return [...this.byId.values()].filter((a) => a.sireId === id || a.damId === id);
  }
}

export interface PedigreeNode { id?: string; name: string; coi?: number; unknown?: boolean; outside?: boolean; sire?: PedigreeNode; dam?: PedigreeNode }

/** A shallow pedigree makes COI read low; say so when fewer than 3 generations are mostly known. */
export function shallowPedigreeWarning(depth: { completeness: number; knownGenerations: number }): string | null {
  if (depth.knownGenerations >= 3 && depth.completeness >= 0.6) return null;
  return depth.knownGenerations === 0
    ? 'No parents are recorded, so inbreeding can’t be estimated: missing ancestors are unknown, not unrelated.'
    : `Only ${depth.knownGenerations} generation${depth.knownGenerations === 1 ? ' is' : 's are'} recorded (${Math.round(depth.completeness * 100)}% of 4 generations), so the true inbreeding may be higher than shown.`;
}

/**
 * Herd-level trend (FAO: an effective population of 50 or more keeps the rise under 1% per
 * generation). Mean COI by generation; the rise ΔF = (F_t − F_{t−1}) / (1 − F_{t−1}) between the
 * two latest generations with at least 2 animals each. Warns at about 1% or more.
 */
export function herdInbreedingTrend(p: Pedigree, animals: PedigreeAnimal[]): { byGeneration: Array<{ generation: number; animals: number; meanCoi: number }>; deltaF: number | null; warning: string | null } {
  const groups = new Map<number, number[]>();
  for (const a of animals) { const g = p.generation(a.id); groups.set(g, [...(groups.get(g) ?? []), p.coi(a.id)]); }
  const byGeneration = [...groups].map(([generation, fs]) => ({ generation, animals: fs.length, meanCoi: fs.reduce((x, y) => x + y, 0) / fs.length })).sort((a, b) => a.generation - b.generation);
  const usable = byGeneration.filter((g) => g.animals >= 2 && g.generation > 0);
  if (usable.length < 2) return { byGeneration, deltaF: null, warning: null };
  const [prev, last] = usable.slice(-2) as [typeof usable[number], typeof usable[number]];
  const deltaF = (last.meanCoi - prev.meanCoi) / (1 - prev.meanCoi);
  const warning = deltaF >= 0.0095
    ? `Average inbreeding rose about ${(deltaF * 100).toFixed(1)}% in the latest generation. FAO guidance keeps the rise under 1% per generation; bringing in unrelated breeding stock helps.`
    : null;
  return { byGeneration, deltaF, warning };
}

// ---------- Merit ----------

/** Which log kind measures each sourced heritability trait. */
export const TRAIT_LOG: Record<string, { kind: AnimalLog['kind']; per: 'year' | 'record'; label: string }> = {
  'milk yield': { kind: 'milk', per: 'year', label: 'milk' },
  'litter size at birth': { kind: 'litter-born', per: 'record', label: 'litter size' },
};

export interface Merit {
  animalId: string;
  trait: string;
  /** Estimated breeding merit as % over (+) or under (−) the herd average, with a range. */
  pct: number;
  low: number;
  high: number;
  records: number;
  confidence: 'very rough' | 'rough' | 'fair';
  /** "rough estimate: 8 records". */
  label: string;
}

/** The trait to rank on for a species: the first one with a sourced heritability and a log kind. */
export function meritTrait(a: AnimalSpec | undefined): { trait: string; h2: number } | null {
  const h = a?.reproduction.heritability;
  if (!h) return null;
  for (const [trait, v] of Object.entries(h)) if (TRAIT_LOG[trait]) return { trait, h2: v.value[0] }; // the lower (protective) end: never overclaims
  return null;
}

/**
 * Breeding merit per animal for a trait. Each record (a year's total, or one litter) is compared
 * with contemporaries (same species, sex, year and group) as a % deviation from their average.
 * Own merit = b × mean deviation, with b = n h² / (1 + (n − 1) h²) (repeatability taken as h²,
 * which keeps b conservative); parents' merit fills in the rest: merit = b·own + (1 − b)·parent avg.
 */
export function estimateMerit(p: Pedigree, animals: PedigreeAnimal[], logs: AnimalLog[], trait: string, h2: number): Map<string, Merit> {
  const tl = TRAIT_LOG[trait];
  const out = new Map<string, Merit>();
  if (!tl) return out;
  const recs: Array<{ id: string; value: number; group: string }> = [];
  for (const a of animals) {
    const mine = logs.filter((l) => l.animalId === a.id && l.kind === tl.kind);
    if (tl.per === 'year') {
      const byYear = new Map<string, number>();
      for (const l of mine) byYear.set(l.date.slice(0, 4), (byYear.get(l.date.slice(0, 4)) ?? 0) + l.value);
      for (const [y, v] of byYear) recs.push({ id: a.id, value: v, group: `${a.speciesId}|${a.sex}|${y}|${a.herdId ?? ''}` });
    } else for (const l of mine) recs.push({ id: a.id, value: l.value, group: `${a.speciesId}|${a.sex}|${l.date.slice(0, 4)}|${a.herdId ?? ''}` });
  }
  const groupMean = new Map<string, number>();
  for (const g of new Set(recs.map((r) => r.group))) { const vs = recs.filter((r) => r.group === g).map((r) => r.value); groupMean.set(g, vs.reduce((x, y) => x + y, 0) / vs.length); }
  const devs = new Map<string, number[]>();
  for (const r of recs) {
    const m = groupMean.get(r.group)!;
    if (m > 0) devs.set(r.id, [...(devs.get(r.id) ?? []), ((r.value - m) / m) * 100]);
  }
  // Oldest first, so parents' merit exists before their offspring's.
  const ordered = [...animals].sort((a, b) => p.generation(a.id) - p.generation(b.id));
  for (const a of ordered) {
    const d = devs.get(a.id) ?? [];
    const n = d.length;
    const b = n ? (n * h2) / (1 + (n - 1) * h2) : 0;
    const own = n ? d.reduce((x, y) => x + y, 0) / n : 0;
    const sire = a.sireId ? out.get(a.sireId) : undefined, dam = a.damId ? out.get(a.damId) : undefined;
    const pa = ((sire?.pct ?? 0) + (dam?.pct ?? 0)) / 2;
    const parentRecords = (sire?.records ?? 0) + (dam?.records ?? 0);
    if (!n && !parentRecords) continue;
    const pct = b * own + (1 - b) * pa;
    // Wider when little is known: accuracy ≈ √b for own records, less for parents only.
    const acc = Math.sqrt(Math.max(b, parentRecords ? 0.25 * h2 : 0));
    const spread = Math.max(2, (1 - acc) * 20);
    const records = n + parentRecords;
    const confidence = records >= 8 ? 'fair' : records >= 3 ? 'rough' : 'very rough';
    out.set(a.id, { animalId: a.id, trait, pct: round1(pct), low: round1(pct - spread), high: round1(pct + spread), records, confidence, label: `${confidence} estimate: ${records} record${records === 1 ? '' : 's'}` });
  }
  return out;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

// ---------- Suggestions ----------

export interface BreedingSuggestion {
  damId: string;
  sireId: string;
  coi: number;
  /** Expected offspring merit, % vs herd average, when a trait has a sourced heritability. */
  expectedPct: number | null;
  /** Plain explanation (also given to the on-device model to explain). */
  why: string;
  shallow: string | null;
}

export interface Excluded { sireId: string; reason: string }

/**
 * For one female: candidate males ranked by expected offspring merit with an inbreeding penalty
 * (1 point of merit per 1% COI). Pairings at or above the limit, and pairings matching a sourced
 * mating rule, are excluded and listed with the reason. When merit is within 1 point (or unknown),
 * the lower COI ranks first.
 */
export function suggestMates(p: Pedigree, damId: string, males: PedigreeAnimal[], spec: AnimalSpec | undefined, merit: Map<string, Merit>, limit = COI_DEFAULT_LIMIT): { suggestions: BreedingSuggestion[]; excluded: Excluded[] } {
  const dam = p.get(damId);
  const lim = Math.min(limit, COI_MAX_LIMIT);
  const suggestions: BreedingSuggestion[] = [], excluded: Excluded[] = [];
  if (!dam || dam.speciesId.startsWith('household:')) return { suggestions, excluded };
  const trait = meritTrait(spec);
  const label = trait ? TRAIT_LOG[trait.trait]!.label : null;
  for (const m of males) {
    if (m.id === damId || m.speciesId !== dam.speciesId || m.sex !== 'male') continue;
    const rule = spec?.reproduction.matingRules?.find((r) => dam.traits?.includes(r.ifBoth) && m.traits?.includes(r.ifBoth));
    if (rule) { excluded.push({ sireId: m.id, reason: `Not suggested: ${rule.reason}.` }); continue; }
    const coi = p.pairingCoi(m.id, damId);
    if (coi >= lim - 1e-12) { excluded.push({ sireId: m.id, reason: `Not suggested: COI ${(coi * 100).toFixed(1)}% is at or above the ${(lim * 100).toFixed(2).replace(/\.?0+$/, '')}% limit.` }); continue; }
    const md = merit.get(damId), ms = merit.get(m.id);
    const expectedPct = trait && (md || ms) ? round1(((md?.pct ?? 0) + (ms?.pct ?? 0)) / 2) : null;
    const depth = (x: string) => p.pedigreeDepth(x);
    const shallow = shallowPedigreeWarning({ completeness: Math.min(depth(damId).completeness, depth(m.id).completeness), knownGenerations: Math.min(depth(damId).knownGenerations, depth(m.id).knownGenerations) });
    const parts = [
      expectedPct !== null ? `Expected ${label} ${expectedPct >= 0 ? '+' : ''}${expectedPct}% vs herd average` : trait ? `No ${label} records yet` : 'No sourced heritability for this species, so ranked by inbreeding only',
      `COI ${(coi * 100).toFixed(1)}%`,
      ...(trait ? [`${dam.name}: ${md ? md.label : 'no records'}; ${m.name}: ${ms ? ms.label : 'no records'}`] : []),
    ];
    suggestions.push({ damId, sireId: m.id, coi, expectedPct, why: `${parts.join('; ')}.`, shallow });
  }
  suggestions.sort((a, b) => {
    const sa = (a.expectedPct ?? 0) - a.coi * 100, sb = (b.expectedPct ?? 0) - b.coi * 100;
    return Math.abs(sa - sb) <= 1 ? a.coi - b.coi : sb - sa;
  });
  return { suggestions, excluded };
}
