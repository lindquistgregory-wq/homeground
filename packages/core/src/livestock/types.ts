/**
 * Animal data model (docs/prompts/LIVESTOCK_PROMPT.md §3), the counterpart of PlantSpec. Values
 * are [low, high] ranges, a single sourced value is [v, v], and `null` means no acceptable source
 * was found; nothing is guessed. Units are imperial like plants: °F, sq ft, acres, lb, gallons, days.
 * Health and safety thresholds are read at their protective end (livestock/safetyDefaults.ts).
 */

type Range = [number, number];
/** A [low, high] range (named so it doesn't clash with the planner's Range). */
export type AnimalRange = Range;

export type AnimalKind = 'poultry' | 'waterfowl' | 'small-stock' | 'ruminant' | 'pig' | 'cattle' | 'pollinator' | 'working' | 'equine' | 'aquatic' | 'invertebrate';
export type Purpose = 'eggs' | 'meat' | 'milk' | 'fiber' | 'honey' | 'guardian' | 'pest-control' | 'grazing' | 'breeding' | 'riding' | 'work' | 'rodent-control' | 'compost';
export type Tolerance = 'low' | 'medium' | 'high';

/** extension / government / research are preferred; industry and secondary sources are flagged in the UI. */
export interface AnimalSource {
  title: string;
  url: string;
  year: number | null;
  kind: 'extension' | 'government' | 'research' | 'industry' | 'secondary';
}

export interface HeatThresholds {
  tolerance: Tolerance | null;
  /** Air temperature at which stress begins (°F). */
  airOnsetF?: number;
  /** Temperature-humidity index at which stress begins (the scale named in `thiScale`). */
  thiOnset?: number;
  thiScale?: string;
  /**
   * Horses: the equine comfort index, air temperature (°F) plus relative humidity (%). Stress is
   * flagged at or above this sum (the most conservative extension cutoff).
   */
  tPlusRhOnset?: number;
  note?: string;
}

export interface ColdThresholds {
  tolerance: Tolerance | null;
  /** Lowest safe air temperature with the shelter described in `note` (°F), where sourced. */
  safeMinF?: number;
  note?: string;
}

export interface Production {
  eggsPerYear?: Range | null;
  layStartWeeks?: Range | null;
  productiveYears?: Range | null;
  milkLbPerLactation?: Range | null;
  lactationDays?: Range | null;
  growOutDays?: Range | null;
  liveWeightLb?: Range | null;
  fiberLbPerYear?: Range | null;
  honeyLbPerYear?: Range | null;
  littersPerYear?: Range | null;
  note?: string;
}

/** Shown only when "Show harvest and processing details" is on (owner decision 5). */
export interface Processing {
  ageDays?: Range | null;
  dressedWeightLb?: Range | null;
  note?: string;
}

export interface Reproduction {
  gestationDays?: Range | null;
  incubationDays?: Range | null;
  breedingSeason?: string;
  litterSize?: Range | null;
  weaningDays?: Range | null;
  /** Narrow-sense heritability of the main production traits, keyed by trait, with its source. */
  heritability?: Record<string, { value: Range; source: number }>;
  knownMatingRisks?: string[];
  /**
   * Machine-checkable versions of knownMatingRisks: pairings where both animals carry `trait`
   * (recorded on the animal, e.g. "polled") are never suggested.
   */
  matingRules?: Array<{ ifBoth: string; reason: string }>;
}

export interface Breed {
  name: string;
  climate: 'heat' | 'cold' | 'both' | null;
  purpose?: Purpose;
  note?: string;
  /** Index into the species' `sources`. */
  source?: number;
}

export interface AnimalSpec {
  id: string;
  commonName: string;
  aliases?: string[];
  scientificName: string;
  kind: AnimalKind;
  purposes: Purpose[];
  /** What one unit is ("per hen", "per doe", "per hive"). */
  unit: string;

  // Social
  minGroupSize: number | null;
  starterGroupSize: Range | null;
  maleNeeded: boolean | null;
  livesAloneOk: boolean;
  socialNote?: string;

  // Climate
  heat: HeatThresholds;
  cold: ColdThresholds;
  shadeNeeded: boolean;

  // Housing
  spaceIndoorSqFt: Range | null;
  spaceOutdoorSqFt: Range | null;
  pastureAcresPerHead: Range | null;
  /** Pond fish: how many per surface acre (capacity uses the lower, more cautious figure). */
  stockingPerAcre?: Range | null;
  animalUnitEquivalent?: number | null;
  nestBoxesPer?: number | null;
  fence?: string;
  /** Design-object kinds that can house it. */
  housingObjects: string[];

  // Feed and water
  feedLbPerYear?: Range | null;
  feedLbPerGrowOut?: Range | null;
  waterGalPerDay: Range | null;
  waterNote?: string;

  production: Production;
  processing?: Processing;
  reproduction: Reproduction;

  lifespanYears: Range | null;
  laborHoursPerWeek: Range | null;
  noise: Tolerance | null;
  startupCostUSD?: Range | null;
  annualCostUSD?: Range | null;
  priceYear?: number | null;

  manureNote?: string;
  predators: string[];
  /** Names and prevention only: never treatment or doses (prompt §8). */
  diseasesToKnow: string[];
  biosecurity?: string;
  companions: string[];
  keepApart: Array<{ id: string; reason: string }>;
  regulatory: string[];
  breeds: Breed[];
  notes: string[];
  sources: AnimalSource[];
  /** Figures from before 2016 (data) or 2020 (prices). */
  oldData?: boolean;
}
