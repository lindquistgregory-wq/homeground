/**
 * "Suggest a setup" for one bed: a few plants that suit the bed and each other. Starts from the bed's
 * own ranking (sun, soil, climate), then favours what the homestead plan calls for, traditional
 * companions of what's already there, a mix of heavy and light feeders, similar water needs and one
 * growing season, and avoids poor neighbours and last year's family. Every pick says why.
 *
 * Companion pairings are traditional tips (the evidence is mostly anecdotal); feeder groups follow the
 * plant-family grouping garden rotation guides use. Both are labelled that way.
 */
import { rotationAdvice, type PlantingRecord } from './garden';
import type { Suitability } from './suitability';
import type { Level, PlantSpec, Season } from './types';

export type Feeder = 'heavy' | 'medium' | 'light' | 'fixer';

const HEAVY = new Set(['Solanaceae', 'Brassicaceae', 'Cucurbitaceae', 'Poaceae']);
const LIGHT = new Set(['Apiaceae', 'Amaryllidaceae', 'Lamiaceae']);

/** Feeder group by plant family (legumes fix nitrogen; tomato, cabbage and squash families and corn feed heavily). */
export function feederOf(p: PlantSpec): Feeder {
  if (p.family === 'Fabaceae') return 'fixer';
  if (HEAVY.has(p.family)) return 'heavy';
  if (LIGHT.has(p.family) || p.kind === 'herb') return 'light';
  return 'medium';
}

export const FEEDER_LABEL: Record<Feeder, string> = { heavy: 'heavy feeder', medium: 'moderate feeder', light: 'light feeder', fixer: 'legume (adds nitrogen)' };
export const SETUP_BASIS = 'Ranked for this bed’s sun, soil and climate. Companion pairings are traditional tips; feeder groups follow the plant-family grouping used in garden rotation guides.';

export interface BedSetupInput {
  /** The bed's ranking (rankPlants for this spot). */
  ranked: Suitability[];
  plant: (id: string) => PlantSpec | undefined;
  /** This year's plantings already in the bed. */
  existing: Array<{ plantId: string; share: number }>;
  history: PlantingRecord[];
  year: number;
  /** Crops the homestead plan calls for (plant ids), if there's a plan. */
  planCrops?: string[];
  areaSqFt: number;
  /** At most this many new plants (default by bed size). */
  maxPicks?: number;
}

export interface BedSetupPick {
  plantId: string;
  share: number;
  score: number;
  reasons: string[];
}

export interface BedSetup {
  picks: BedSetupPick[];
  /** Share of the bed still free before these picks. */
  freeShare: number;
  notes: string[];
  basis: string;
}

const LEVEL: Record<Level, number> = { low: 0, medium: 1, high: 2 };
const pairs = (a: PlantSpec, b: PlantSpec, key: 'companions' | 'avoidNear') => !!(a[key]?.includes(b.id) || b[key]?.includes(a.id));
const VERDICT_OK = new Set(['great', 'good', 'fair']);

/** How many different plants suit a bed this size (a planning choice: small beds stay simple). */
export function picksForArea(areaSqFt: number): number {
  return areaSqFt < 12 ? 1 : areaSqFt < 24 ? 2 : areaSqFt < 48 ? 3 : 4;
}

export function suggestBedSetup(input: BedSetupInput): BedSetup {
  const notes: string[] = [];
  const existing = input.existing.flatMap((e) => { const p = input.plant(e.plantId); return p ? [p] : []; });
  const freeShare = Math.max(0, Math.round((1 - input.existing.reduce((a, e) => a + e.share, 0)) * 100) / 100);
  if (freeShare < 0.2) return { picks: [], freeShare, notes: ['This bed is full this year. Remove or harvest a planting to make room.'], basis: SETUP_BASIS };
  const want = Math.max(1, Math.min(input.maxPicks ?? picksForArea(input.areaSqFt) - existing.length, Math.floor(freeShare / 0.2)));
  const plan = new Set(input.planCrops ?? []);
  const lastYear = new Set(input.history.filter((h) => h.year === input.year - 1).map((h) => h.family));

  const chosen: Array<{ p: PlantSpec; s: Suitability; score: number; reasons: string[] }> = [];
  const pool = input.ranked.filter((s) => VERDICT_OK.has(s.verdict) && !input.existing.some((e) => e.plantId === s.plantId));

  for (let k = 0; k < want; k++) {
    const company = [...existing, ...chosen.map((c) => c.p)];
    const season: Season | undefined = company.find((c) => c.season !== 'perennial')?.season;
    let best: (typeof chosen)[number] | null = null;
    for (const s of pool) {
      const p = input.plant(s.plantId);
      if (!p || chosen.some((c) => c.p.id === p.id)) continue;
      // Never next to a traditional poor neighbour, or a second plant of the same family in one setup.
      if (company.some((c) => pairs(c, p, 'avoidNear'))) continue;
      if (chosen.some((c) => c.p.family === p.family)) continue;
      const reasons: string[] = [`Suits this bed (${s.verdict}, ${Math.round(s.score)}/100)`];
      let score = s.score;
      if (plan.has(p.id)) { score += 25; reasons.push('In your homestead plan'); }
      const friends = company.filter((c) => pairs(c, p, 'companions'));
      if (friends.length) { score += 15 * friends.length; reasons.push(`Traditional companion of ${friends.map((f) => f.commonName.toLowerCase()).join(' and ')}`); }
      const f = feederOf(p);
      const feeders = company.map(feederOf);
      if (feeders.includes('heavy') && (f === 'light' || f === 'fixer')) { score += 10; reasons.push(`A ${FEEDER_LABEL[f]} beside heavy feeders`); }
      else if (f === 'heavy' && feeders.filter((x) => x === 'heavy').length >= 1) score -= 10;
      const water = company.map((c) => LEVEL[c.water]);
      if (water.length && water.every((w) => Math.abs(w - LEVEL[p.water]) <= 1)) { if (water.some((w) => w === LEVEL[p.water])) reasons.push(`Same watering as ${company.find((c) => c.water === p.water)!.commonName.toLowerCase()}`); }
      else if (water.length) score -= 15;
      if (season && p.season !== 'perennial' && p.season !== season) score -= 12;
      if (lastYear.has(p.family) || !rotationAdvice(p, input.history, input.year).ok) score -= 30;
      if (!best || score > best.score) best = { p, s, score, reasons };
    }
    if (!best) break;
    chosen.push(best);
  }

  if (!chosen.length) notes.push('No plant suits this bed well enough to suggest. Check its sun and the site profile.');
  const each = Math.floor((freeShare / Math.max(1, chosen.length)) * 20) / 20;
  const feeders = new Set([...existing, ...chosen.map((c) => c.p)].map(feederOf));
  if (feeders.size === 1 && feeders.has('heavy')) notes.push('All heavy feeders: work in compost before planting and side-dress mid-season.');
  if (input.history.some((h) => h.family === 'Fabaceae' && h.year === input.year - 1)) notes.push('Last year’s legumes left extra nitrogen: a good spot for heavy feeders.');
  return {
    picks: chosen.map((c) => ({ plantId: c.p.id, share: each, score: Math.round(c.score), reasons: c.reasons })),
    freeShare, notes, basis: SETUP_BASIS,
  };
}

/** Facts about a bed for an AI model to reason over: only what the app already knows, no location or names. */
export function bedSetupFacts(input: BedSetupInput, conditions: string[]): { facts: string[]; candidates: string[] } {
  const existing = input.existing.flatMap((e) => { const p = input.plant(e.plantId); return p ? [`${p.commonName} (${p.id}) on ${Math.round(e.share * 100)}% of the bed`] : []; });
  const candidates = input.ranked.filter((s) => VERDICT_OK.has(s.verdict) && !input.existing.some((e) => e.plantId === s.plantId)).slice(0, 25);
  const facts = [
    ...conditions,
    `Bed area: ${Math.round(input.areaSqFt)} sq ft; free share: ${Math.round((1 - input.existing.reduce((a, e) => a + e.share, 0)) * 100)}%.`,
    existing.length ? `Already in the bed this year: ${existing.join('; ')}.` : 'Nothing in the bed yet this year.',
    ...(input.planCrops?.length ? [`The homestead plan calls for: ${input.planCrops.join(', ')}.`] : []),
    ...(input.history.length ? [`Grown here before: ${input.history.map((h) => `${h.plantId} (${h.year})`).join(', ')}.`] : []),
  ];
  const lines = candidates.flatMap((s) => {
    const p = input.plant(s.plantId);
    if (!p) return [];
    return [`${p.id}: ${p.commonName}; fit ${s.verdict} ${Math.round(s.score)}/100; ${p.season} season; water ${p.water}; ${FEEDER_LABEL[feederOf(p)]}; family ${p.family}${p.companions?.length ? `; companions ${p.companions.join(', ')}` : ''}${p.avoidNear?.length ? `; keep away from ${p.avoidNear.join(', ')}` : ''}`];
  });
  return { facts, candidates: lines };
}

/**
 * Check a model's picks: only plants from the candidate list, none already in the bed, no poor
 * neighbours, shares that fit the free space. Returns null when nothing usable is left.
 */
export function validateAiSetup(raw: unknown, input: BedSetupInput): BedSetupPick[] | null {
  const list = (raw as { picks?: unknown })?.picks;
  if (!Array.isArray(list)) return null;
  const allowed = new Set(input.ranked.filter((s) => VERDICT_OK.has(s.verdict)).map((s) => s.plantId));
  const existing = input.existing.flatMap((e) => input.plant(e.plantId) ?? []);
  const free = Math.max(0, 1 - input.existing.reduce((a, e) => a + e.share, 0));
  const out: BedSetupPick[] = [];
  for (const item of list.slice(0, 5)) {
    const id = String((item as { plantId?: unknown }).plantId ?? '');
    const p = input.plant(id);
    if (!p || !allowed.has(id) || out.some((o) => o.plantId === id) || input.existing.some((e) => e.plantId === id)) continue;
    if ([...existing, ...out.flatMap((o) => input.plant(o.plantId) ?? [])].some((c) => pairs(c, p, 'avoidNear'))) continue;
    const why = (item as { why?: unknown }).why;
    out.push({ plantId: id, share: 0, score: Math.round(input.ranked.find((s) => s.plantId === id)!.score), reasons: [typeof why === 'string' && why.trim() ? why.trim().slice(0, 240) : 'Suggested by AI'] });
  }
  if (!out.length || free < 0.2) return null;
  const each = Math.floor((free / out.length) * 20) / 20;
  return out.map((o) => ({ ...o, share: each }));
}
