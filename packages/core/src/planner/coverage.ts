/**
 * estimate_food_coverage (§9.2): planned crops and animals vs the household's yearly needs, with gaps and
 * what will need storing or preserving. Pure arithmetic over the knowledge base; ranges throughout.
 */
import { plantById } from '../plants/index';
import type { HouseholdMember } from './goals';
import type { KnowledgeBase, Range } from './kb';
import {
  NUTRIENT_KEYS, NUTRIENT_LABEL, annualNeeds, cropContribution, livestockContribution, sumNutrients,
  type Contribution, type CropAmount, type NutrientKey, type NutrientTotals,
} from './nutrition';

export interface PlannedFood {
  crops: CropAmount[];
  livestock: Array<{ species: string; count: number }>;
}

export interface CoverageReport {
  needs: NutrientTotals;
  supplyLow: NutrientTotals;
  supplyHigh: NutrientTotals;
  /** Share of each need met, low–high (1 = 100 %). */
  share: Record<NutrientKey, Range>;
  contributions: Contribution[];
  /** Items that couldn't be counted, and why. */
  notCounted: Array<{ id: string; reason: string }>;
  gaps: string[];
  storage: StorageNeed[];
  sources: string[];
}

export interface StorageNeed {
  method: 'root-cellar' | 'curing' | 'canning' | 'freezing' | 'dehydrating';
  crops: string[];
  lb: Range;
  shelfLifeMonths?: Range | null;
  note: string;
}

/** How each storable crop keeps best (NCHFP / extension storage guidance, grouped). */
const STORAGE: Record<string, StorageNeed['method']> = {
  potato: 'root-cellar', carrot: 'root-cellar', beet: 'root-cellar', parsnip: 'root-cellar', turnip: 'root-cellar', cabbage: 'root-cellar', leek: 'root-cellar',
  'squash-winter': 'curing', pumpkin: 'curing', 'sweet-potato': 'curing', onion: 'curing', garlic: 'curing', 'bean-dry': 'dehydrating', hazelnut: 'dehydrating',
  tomato: 'canning', apple: 'root-cellar', pear: 'root-cellar', peach: 'canning', plum: 'canning', 'cherry-sour': 'freezing', 'cherry-sweet': 'freezing',
  'bean-bush': 'freezing', 'bean-pole': 'freezing', 'bean-lima': 'freezing', pea: 'freezing', corn: 'freezing', broccoli: 'freezing', 'pepper-sweet': 'freezing',
  strawberry: 'freezing', blueberry: 'freezing', 'blueberry-rabbiteye': 'freezing', raspberry: 'freezing', blackberry: 'freezing', grape: 'canning',
};
/** Exposed for tests: every key must be a real plant id. */
export const STORAGE_METHOD = STORAGE;

export function estimateFoodCoverage(members: HouseholdMember[], plan: PlannedFood, kb: KnowledgeBase): CoverageReport {
  const needs = annualNeeds(members, kb);
  const contributions: Contribution[] = [];
  const notCounted: CoverageReport['notCounted'] = [];
  for (const c of plan.crops) {
    const p = plantById(c.plantId);
    if (!p) { notCounted.push({ id: c.plantId, reason: 'unknown plant' }); continue; }
    const food = kb.nutrition.foods[p.id];
    if (food && !food.food) { notCounted.push({ id: p.id, reason: `${p.commonName} is a soil-building crop, not food` }); continue; }
    const k = cropContribution(p, c, kb);
    if (k) contributions.push(k);
    else notCounted.push({ id: p.id, reason: !p.yieldLb ? `no yield figure for ${p.commonName}` : `no USDA nutrient data for ${p.commonName}` });
  }
  for (const l of plan.livestock) {
    if (l.count <= 0) continue;
    const k = livestockContribution(l.species, l.count, kb);
    if (k) contributions.push(k);
    else notCounted.push({ id: l.species, reason: `no sourced edible yield for ${l.species.replace(/_/g, ' ')} (e.g. dressed weight isn't in the knowledge base)` });
  }
  const supplyLow = sumNutrients(contributions.map((c) => c.nutrients.low));
  const supplyHigh = sumNutrients(contributions.map((c) => c.nutrients.high));
  const share = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, needs[k] > 0 ? [supplyLow[k] / needs[k], supplyHigh[k] / needs[k]] : [0, 0]])) as Record<NutrientKey, Range>;

  const gaps: string[] = [];
  for (const k of NUTRIENT_KEYS) {
    const [lo, hi] = share[k];
    if (hi < 0.25) gaps.push(`${NUTRIENT_LABEL[k]}: ${pct(lo)}–${pct(hi)} of needs`);
  }

  // Storage: harvest of storable crops, grouped by the way they keep.
  const byMethod = new Map<StorageNeed['method'], { crops: string[]; lo: number; hi: number }>();
  for (const c of contributions) {
    const m = STORAGE[c.id];
    if (!m) continue;
    const e = byMethod.get(m) ?? { crops: [], lo: 0, hi: 0 };
    e.crops.push(c.label);
    e.lo += c.amountLb[0];
    e.hi += c.amountLb[1];
    byMethod.set(m, e);
  }
  const pres = kb.homestead.preservation as Record<string, { shelfLifeMonths?: Range | null; note: string } | string>;
  const presKey: Record<StorageNeed['method'], string> = { 'root-cellar': 'root_cellar', curing: 'curing', canning: 'canning', freezing: 'freezing', dehydrating: 'dehydrating' };
  const storage: StorageNeed[] = [...byMethod.entries()].map(([method, e]) => {
    const p = pres[presKey[method]];
    return { method, crops: e.crops, lb: [e.lo, e.hi], shelfLifeMonths: typeof p === 'object' ? p.shelfLifeMonths ?? null : null, note: typeof p === 'object' ? p.note : '' };
  });

  return {
    needs, supplyLow, supplyHigh, share, contributions, notCounted, gaps, storage,
    sources: [
      'USDA FoodData Central SR Legacy (nutrients, edible portions)',
      'Dietary Guidelines for Americans 2020–2025 (calorie needs); National Academies DRIs (nutrient targets)',
      'Plant yields: typical home-garden ranges in the bundled plant database',
    ],
  };
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
