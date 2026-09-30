/**
 * Household needs and food production in nutrients (§9.2 "estimate food self-sufficiency … computed by
 * a deterministic tool, not the model"). Energy: Dietary Guidelines 2020–2025 Appendix 2; nutrients:
 * National Academies DRIs; foods: USDA SR Legacy per 100 g × edible portion.
 */
import type { PlantSpec } from '../plants/types';
import type { HouseholdMember } from './goals';
import type { AgeBand, KnowledgeBase, Nutrients, Range } from './kb';

export const NUTRIENT_KEYS = ['kcal', 'proteinG', 'vitARaeUg', 'vitCMg', 'calciumMg', 'ironMg', 'fiberG'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type NutrientTotals = Record<NutrientKey, number>;

export const NUTRIENT_LABEL: Record<NutrientKey, string> = {
  kcal: 'Calories', proteinG: 'Protein', vitARaeUg: 'Vitamin A', vitCMg: 'Vitamin C', calciumMg: 'Calcium', ironMg: 'Iron', fiberG: 'Fibre',
};

const zero = (): NutrientTotals => ({ kcal: 0, proteinG: 0, vitARaeUg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, fiberG: 0 });
export const LB = 453.592;

// ---------------- Needs ----------------

function band(age: number): AgeBand {
  if (age < 4) return '1-3';
  if (age < 9) return '4-8';
  if (age < 14) return '9-13';
  if (age < 19) return '14-18';
  if (age < 31) return '19-30';
  if (age < 51) return '31-50';
  if (age < 71) return '51-70';
  return '71+';
}

/** Daily energy for one person from the DGA table (rows are single ages or ranges like "21-25", "76+"). */
export function dailyEnergy(m: HouseholdMember, kb: KnowledgeBase): number {
  const e = kb.nutrition.dri.energy;
  let kcal: number;
  if (m.age < 2) {
    // Toddlers: the 18-month row (no activity levels are given under 2).
    const row = (e as unknown as { toddlers12to23Months: Array<{ ageMonths: string; male: number; female: number }> }).toddlers12to23Months.find((r) => r.ageMonths === '18');
    kcal = row ? row[m.sex] : 1000;
  } else {
    const a = Math.floor(m.age);
    const row = e.byAge.find((r) => {
      if (r.age.endsWith('+')) return a >= Number(r.age.slice(0, -1));
      const [lo, hi] = r.age.split('-').map(Number);
      return hi === undefined ? a === lo : a >= lo! && a <= hi;
    }) ?? e.byAge[e.byAge.length - 1]!;
    kcal = row[m.sex][m.activity];
  }
  const d = e.pregnancyLactationDelta as Record<string, number>;
  // Stage unknown: use the 2nd-trimester and first-6-months additions (the middle values).
  if (m.pregnant) kcal += d.pregnancy2ndTrimester ?? 0;
  if (m.lactating) kcal += d.lactationFirst6Months ?? 0;
  return kcal;
}

export function dailyNeeds(m: HouseholdMember, kb: KnowledgeBase): NutrientTotals {
  const b = band(m.age);
  const rda = kb.nutrition.dri.rda as unknown as {
    byBand: Record<AgeBand, Record<'male' | 'female', Omit<NutrientTotals, 'kcal'>>>;
    pregnancy?: Record<string, Omit<NutrientTotals, 'kcal'>>;
    lactation?: Record<string, Omit<NutrientTotals, 'kcal'>>;
  };
  const special = m.sex === 'female' && (m.lactating ? rda.lactation : m.pregnant ? rda.pregnancy : undefined);
  const t = (special && special[b]) || rda.byBand[b][m.sex];
  return { kcal: dailyEnergy(m, kb), ...t };
}

export function annualNeeds(members: HouseholdMember[], kb: KnowledgeBase): NutrientTotals {
  const out = zero();
  for (const m of members) {
    const d = dailyNeeds(m, kb);
    for (const k of NUTRIENT_KEYS) out[k] += d[k] * 365;
  }
  return out;
}

// ---------------- Production ----------------

/** Nutrients in `grams` of the edible part of a food. */
export function nutrientsIn(per100g: Nutrients, grams: number): NutrientTotals {
  const out = zero();
  for (const k of NUTRIENT_KEYS) out[k] = ((per100g[k] ?? 0) * grams) / 100;
  return out;
}

export interface CropAmount {
  plantId: string;
  /** Give one of: bed/row area, row length, or number of plants (perennials). */
  areaSqFt?: number;
  rowFt?: number;
  plants?: number;
}

/**
 * Row feet a crop occupies in a given area, matching the bed layout rules: square-foot density for small
 * crops, otherwise rows at max(in-row spacing, 60 % of field row spacing).
 */
export function rowFeetForArea(p: PlantSpec, areaSqFt: number): number {
  if (p.perSquareFoot) return areaSqFt * p.perSquareFoot * (p.spacingIn.inRow / 12);
  const between = Math.max(p.spacingIn.inRow, p.spacingIn.betweenRows * 0.6) / 12;
  return areaSqFt / between;
}

/** Plants in a given area at the crop's spacing (perennials, trees). */
export function plantsForArea(p: PlantSpec, areaSqFt: number): number {
  const sq = Math.max(p.spacingIn.inRow, p.spreadIn) / 12;
  return Math.max(1, Math.floor(areaSqFt / (sq * sq)));
}

/** Harvest in lb per year (typical home-garden range) or null when the plant has no yield figure. */
export function cropHarvestLb(p: PlantSpec, a: CropAmount): Range | null {
  if (!p.yieldLb) return null;
  const [lo, hi] = p.yieldLb.range;
  if (p.yieldLb.per === 'plant') {
    const n = a.plants ?? (a.areaSqFt !== undefined ? plantsForArea(p, a.areaSqFt) : 0);
    return [lo * n, hi * n];
  }
  const rowFt = a.rowFt ?? (a.areaSqFt !== undefined ? rowFeetForArea(p, a.areaSqFt) : 0);
  return [(lo * rowFt) / 10, (hi * rowFt) / 10];
}

export interface Contribution {
  id: string;
  label: string;
  /** Harvest / product amount, lb (range). */
  amountLb: Range;
  /** Edible grams (range). */
  edibleG: Range;
  nutrients: { low: NutrientTotals; high: NutrientTotals };
  notes: string[];
}

export function cropContribution(p: PlantSpec, a: CropAmount, kb: KnowledgeBase): Contribution | null {
  const food = kb.nutrition.foods[p.id];
  const lb = cropHarvestLb(p, a);
  if (!food?.food || !food.per100g || !lb) return null;
  const notes: string[] = [];
  const edible = food.ediblePortion ?? 1;
  if (food.ediblePortion == null) notes.push('Edible share not published; whole harvest counted.');
  if (food.per100g.kcal === null) notes.push('No USDA nutrient data for this crop.');
  const g: Range = [lb[0] * LB * edible, lb[1] * LB * edible];
  return { id: p.id, label: p.commonName, amountLb: lb, edibleG: g, nutrients: { low: nutrientsIn(food.per100g, g[0]), high: nutrientsIn(food.per100g, g[1]) }, notes };
}

// ---------------- Livestock ----------------

const r = (v: unknown): Range | null => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') ? (v as Range) : null);

/**
 * Yearly edible output per unit (hen, doe, hive…) from the sourced production figures. The conversion
 * for each species is spelled out in `basis`; where the source gives no bone share the figure is
 * flagged as an upper bound instead of guessed.
 */
export function livestockOutput(species: string, kb: KnowledgeBase): { foodId: string; edibleGPerUnit: Range; basis: string; upperBound?: boolean } | null {
  const lp = kb.homestead.livestock[species];
  if (!lp) return null;
  const pr = lp.production as Record<string, unknown>;
  const foods = kb.nutrition.foods;
  const eggG = (id: string, size: string) => ((foods[id]?.perEggEdibleG as Record<string, number> | undefined)?.[size]);
  switch (species) {
    case 'laying_hens': {
      const eggs = r(pr.eggsPerYear), g = eggG('eggs-chicken', 'large');
      return eggs && g ? { foodId: 'eggs-chicken', edibleGPerUnit: [eggs[0] * g, eggs[1] * g], basis: `${eggs[0]}–${eggs[1]} eggs a year × ${g} g edible per large egg` } : null;
    }
    case 'ducks_layers': {
      const eggs = r(pr.eggsPerYear), g = eggG('eggs-duck', 'duck') ?? (Object.values((foods['eggs-duck']?.perEggEdibleG as Record<string, number>) ?? {})[0]);
      return eggs && g ? { foodId: 'eggs-duck', edibleGPerUnit: [eggs[0] * g, eggs[1] * g], basis: `${eggs[0]}–${eggs[1]} eggs a year × ${g} g edible per duck egg` } : null;
    }
    case 'meat_chickens':
    case 'turkeys': {
      const dressed = r(pr.dressedWeightLb);
      const foodId = species === 'turkeys' ? 'turkey-meat' : 'chicken-meat';
      const frac = (foods[foodId]?.carcassToEdible as Record<string, number> | undefined)?.meatAndSkin;
      return dressed && frac ? { foodId, edibleGPerUnit: [dressed[0] * LB * frac, dressed[1] * LB * frac], basis: `${dressed[0]}–${dressed[1]} lb dressed carcass × ${frac} meat and skin (USDA refuse), per bird` } : null;
    }
    case 'dairy_goats': {
      const milk = r(pr.milkLbPerLactation);
      return milk ? { foodId: 'goat-milk', edibleGPerUnit: [milk[0] * LB, milk[1] * LB], basis: `${milk[0]}–${milk[1]} lb milk per lactation (one a year)` } : null;
    }
    case 'meat_goats':
    case 'sheep': {
      const kids = r(pr.kidsPerDoe ?? pr.lambsPerEwe), dressed = r(pr.dressedWeightLb);
      const foodId = species === 'sheep' ? 'lamb' : 'goat-meat';
      return kids && dressed ? { foodId, edibleGPerUnit: [kids[0] * dressed[0] * LB, kids[1] * dressed[1] * LB], basis: `${kids[0]}–${kids[1]} young a year × ${dressed[0]}–${dressed[1]} lb carcass (bone not subtracted: no sourced figure)`, upperBound: true } : null;
    }
    case 'feeder_pigs': {
      const meat = r(pr.takeHomeMeatLb);
      return meat ? { foodId: 'pork', edibleGPerUnit: [meat[0] * LB, meat[1] * LB], basis: `${meat[0]}–${meat[1]} lb take-home cuts per pig (some bone-in)`, upperBound: true } : null;
    }
    case 'honeybees': {
      const honey = r(pr.honeyLbPerHivePerYear);
      return honey ? { foodId: 'honey', edibleGPerUnit: [honey[0] * LB, honey[1] * LB], basis: `${honey[0]}–${honey[1]} lb honey per hive a year (US average)` } : null;
    }
    default:
      return null; // e.g. meat rabbits: no sourced dressed weight
  }
}

export function livestockContribution(species: string, count: number, kb: KnowledgeBase): Contribution | null {
  const out = livestockOutput(species, kb);
  const food = out && kb.nutrition.foods[out.foodId];
  if (!out || !food?.per100g) return null;
  const g: Range = [out.edibleGPerUnit[0] * count, out.edibleGPerUnit[1] * count];
  return {
    id: species, label: `${count} × ${species.replace(/_/g, ' ')}`, amountLb: [g[0] / LB, g[1] / LB], edibleG: g,
    nutrients: { low: nutrientsIn(food.per100g, g[0]), high: nutrientsIn(food.per100g, g[1]) },
    notes: [out.basis, ...(out.upperBound ? ['Upper bound: bone weight not subtracted.'] : [])],
  };
}

export function sumNutrients(list: NutrientTotals[]): NutrientTotals {
  const out = zero();
  for (const n of list) for (const k of NUTRIENT_KEYS) out[k] += n[k];
  return out;
}
