/**
 * The Homestead Goals profile (§9.2): what the discovery interview learns. It is the planner's memory:
 * long conversations are summarised into it so small on-device models stay within their context.
 */
import type { Activity } from './kb';

export type Sex = 'male' | 'female';

export interface HouseholdMember {
  age: number;
  sex: Sex;
  activity: Activity;
  pregnant?: boolean;
  lactating?: boolean;
}

export type Goal = 'food' | 'savings' | 'income' | 'lifestyle' | 'ecology' | 'resilience';
export type DietFlag = 'vegetarian' | 'vegan' | 'no-pork' | 'no-dairy' | 'no-eggs';

/**
 * How much of the household's food they'd like to grow. These are the user's own targets, expressed as
 * shares of annual needs: vitamins A and C and fibre stand in for "vegetables"; calories for staples.
 */
export type FoodAmbition = 'kitchen' | 'most-veg' | 'veg-and-staples' | 'max';
export const FOOD_TARGETS: Record<FoodAmbition, { label: string; micro: number; kcal: number }> = {
  kitchen: { label: 'Fresh produce in season', micro: 0.25, kcal: 0.03 },
  'most-veg': { label: 'Most of our vegetables, year-round', micro: 0.75, kcal: 0.1 },
  'veg-and-staples': { label: 'Vegetables plus storage staples (potatoes, squash, beans)', micro: 0.9, kcal: 0.3 },
  max: { label: 'As much of our food as the land allows', micro: 1, kcal: 0.6 },
};

export type Experience = 'none' | 'some-gardening' | 'experienced' | 'livestock';
export type PhysicalLimits = 'none' | 'some' | 'significant';
export type AnimalRules = 'yes' | 'poultry-only' | 'no' | 'unsure';
export type WaterSource = 'municipal' | 'well' | 'rain-only' | 'none' | 'unsure';
export type MarketAccess = 'none' | 'some' | 'strong';

export interface HomesteadGoals {
  household?: HouseholdMember[];
  diet?: DietFlag[];
  ambition?: FoodAmbition;
  /** Hours a week available in the growing season. */
  hoursPerWeek?: number;
  budgetStartupUsd?: number;
  budgetAnnualUsd?: number;
  physical?: PhysicalLimits;
  experience?: Experience;
  goals?: Goal[];
  /** Square feet the household could put into vegetables (from the user; the parcel can be much larger). */
  gardenSpaceSqFt?: number;
  animals?: AnimalRules;
  roostersAllowed?: boolean;
  /** Livestock the household is interested in (knowledge-base ids). */
  animalInterest?: string[];
  willPreserve?: boolean;
  water?: WaterSource;
  wantsIncome?: boolean;
  marketAccess?: MarketAccess;
  /** Free-text facts the user shared that don't fit a field (kept short). */
  notes?: string[];
  /** Set when the user confirmed the summary. */
  confirmedAt?: string;
}

export const ACTIVITY_LABEL: Record<Activity, string> = { sedentary: 'mostly sitting', moderatelyActive: 'moderately active', active: 'very active' };

/** One-paragraph summary of the goals, for the user to confirm and for the model's context. */
export function summarizeGoals(g: HomesteadGoals): string {
  const parts: string[] = [];
  if (g.household?.length) {
    const adults = g.household.filter((m) => m.age >= 18).length, kids = g.household.length - adults;
    parts.push(`Household of ${g.household.length} (${adults} adult${adults === 1 ? '' : 's'}${kids ? `, ${kids} child${kids === 1 ? '' : 'ren'}` : ''})`);
  }
  if (g.diet?.length) parts.push(`diet: ${g.diet.join(', ')}`);
  if (g.ambition) parts.push(`food goal: ${FOOD_TARGETS[g.ambition].label.toLowerCase()}`);
  if (g.hoursPerWeek !== undefined) parts.push(`${g.hoursPerWeek} h/week in season`);
  if (g.budgetStartupUsd !== undefined) parts.push(`startup budget $${g.budgetStartupUsd.toLocaleString('en-US')}`);
  if (g.budgetAnnualUsd !== undefined) parts.push(`yearly budget $${g.budgetAnnualUsd.toLocaleString('en-US')}`);
  if (g.gardenSpaceSqFt !== undefined) parts.push(`about ${g.gardenSpaceSqFt.toLocaleString('en-US')} sq ft for vegetables`);
  if (g.experience) parts.push(`experience: ${g.experience.replace('-', ' ')}`);
  if (g.physical && g.physical !== 'none') parts.push(`${g.physical} physical limits`);
  if (g.goals?.length) parts.push(`priorities: ${g.goals.join(', ')}`);
  if (g.animals) parts.push(g.animals === 'no' ? 'no animals allowed' : g.animals === 'poultry-only' ? 'poultry only' : g.animals === 'unsure' ? 'animal rules unknown' : 'animals allowed');
  if (g.animalInterest?.length) parts.push(`interested in ${g.animalInterest.join(', ').replace(/_/g, ' ')}`);
  if (g.water) parts.push(`water: ${g.water.replace('-', ' ')}`);
  if (g.willPreserve !== undefined) parts.push(g.willPreserve ? 'will preserve food' : 'prefers not to preserve');
  if (g.wantsIncome !== undefined) parts.push(g.wantsIncome ? `wants some income (market access: ${g.marketAccess ?? 'unknown'})` : 'no income goal');
  return parts.length ? `${parts.join('; ')}.` : 'Nothing learned yet.';
}

/** Fields the plan is built on: changing one after confirmation needs a fresh confirmation. */
const ESSENTIAL_FIELDS: Array<keyof HomesteadGoals> = ['household', 'ambition', 'hoursPerWeek', 'budgetStartupUsd', 'gardenSpaceSqFt', 'diet', 'animals'];

/**
 * Merge a partial update (from a form or a model's structured output) into the goals. Undefined and null
 * values are ignored (a model leaving out an argument never erases an answer).
 */
export function mergeGoals(g: HomesteadGoals, patch: Partial<HomesteadGoals>): HomesteadGoals {
  const out: HomesteadGoals = { ...g };
  let essentialChanged = false;
  for (const [k, v] of Object.entries(patch) as Array<[keyof HomesteadGoals, unknown]>) {
    if (v === undefined || v === null || k === 'confirmedAt') continue;
    if (k === 'notes') { out.notes = [...new Set([...(g.notes ?? []), ...(v as string[])])].slice(-10); continue; }
    if (ESSENTIAL_FIELDS.includes(k) && JSON.stringify(g[k]) !== JSON.stringify(v)) essentialChanged = true;
    (out as Record<string, unknown>)[k] = v;
  }
  if (essentialChanged) delete out.confirmedAt;
  return out;
}
