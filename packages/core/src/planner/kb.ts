/**
 * Shapes of the planner's bundled knowledge base (the data itself ships in @plotwright/data, so this
 * package stays free of bundled datasets and the engine can be tested with small fixtures).
 */
export type Range = [number, number];

export interface KbSource {
  title: string;
  url: string;
  year: number | null;
}

export interface Nutrients {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbG: number | null;
  fiberG: number | null;
  vitARaeUg: number | null;
  vitCMg: number | null;
  calciumMg: number | null;
  ironMg: number | null;
}

export interface FoodEntry {
  food: boolean;
  name: string;
  fdcId?: number | null;
  dataType?: string;
  description?: string;
  per100g?: Nutrients;
  /** Fraction of harvested weight that is edible (SR Legacy refuse), or null when not published. */
  ediblePortion?: number | null;
  refuseNote?: string;
  harvestForm?: string;
  notes?: string[];
  perEggEdibleG?: Record<string, number>;
  /** Meat birds: edible meat as a fraction of the dressed carcass. */
  carcassToEdible?: Record<string, number | null> | number | null;
  [k: string]: unknown;
}

export type AgeBand = '1-3' | '4-8' | '9-13' | '14-18' | '19-30' | '31-50' | '51-70' | '71+';
export type Activity = 'sedentary' | 'moderatelyActive' | 'active';

export interface NutrientTargets {
  proteinG: number;
  vitARaeUg: number;
  vitCMg: number;
  calciumMg: number;
  ironMg: number;
  fiberG: number;
}

export interface NutritionKb {
  source: string;
  retrieved: string;
  foods: Record<string, FoodEntry>;
  dri: {
    energy: {
      source: string;
      url: string;
      byAge: Array<{ age: string; male: Record<Activity, number>; female: Record<Activity, number> }>;
      pregnancyLactationDelta: Record<string, number | string>;
    };
    rda: {
      source: string;
      urls: Record<string, string>;
      byBand: Record<AgeBand, { male: NutrientTargets; female: NutrientTargets }>;
      pregnancy?: unknown;
      lactation?: unknown;
    };
  };
}

export interface LivestockProfile {
  unit: string;
  minGroupSize: number | null;
  starterFlockSize: Range | null;
  spaceIndoorSqFt: Range | null;
  spaceOutdoorSqFt: Range | null;
  pastureAcresPerHead: Range | null;
  feedLbPerYear?: Range | null;
  feedLbPerGrowOut?: Range | null;
  growOutDays?: Range | null;
  waterGalPerDay?: Range | null;
  production: Record<string, unknown>;
  laborHoursPerWeek: Range | null;
  startupCostUSD: Range | null;
  annualCostUSD: Range | null;
  regulatory: string[];
  climate: string | string[] | null;
  predators: string | string[] | null;
  welfare: string | string[] | null;
  sources: KbSource[];
  oldPrice?: boolean;
  [k: string]: unknown;
}

export interface EnterpriseProfile {
  scale: string;
  landNeededAcres: Range | null;
  startupCostUSD?: Range | null;
  weeklyLaborHours: Range | null;
  seasonality: string;
  marketChannels: string[];
  keySkills: string[];
  regulatory: string[];
  risks: string[];
  sources: KbSource[];
  [k: string]: unknown;
}

export interface InfrastructureItem {
  note: string;
  year?: number | null;
  costUSD?: Range | null;
  costUSDPerLinearFt?: Range | null;
  costUSDPer1000SqFt?: Range | null;
  costUSDPerSqFt?: Range | null;
  costUSDPerGallonStorage?: Range | null;
  highlyVariable?: boolean;
  oldPrice?: boolean;
  sources: KbSource[];
  [k: string]: unknown;
}

export interface PreservationMethod {
  shelfLifeMonths?: Range | null;
  note: string;
  suits: string[];
  sources: KbSource[];
  [k: string]: unknown;
}

export interface HomesteadKb {
  retrieved: string;
  conventions: Record<string, string>;
  livestock: Record<string, LivestockProfile>;
  enterprises: Record<string, EnterpriseProfile>;
  infrastructure: Record<string, InfrastructureItem>;
  preservation: Record<string, PreservationMethod | string> & { safetyNote: string };
}


/** USDA ERS per-capita food availability (lb/person/year, mostly farm weight; not loss-adjusted). */
export interface ConsumptionKb {
  source: string;
  url: string;
  dataYear: number;
  notes: string[];
  perCapitaLb: Record<string, { fresh: number | null; processed: number | null; total: number | null; basis?: string; note?: string }>;
}

/** Everything the planner engine needs, in one object. */
export interface KnowledgeBase {
  nutrition: NutritionKb;
  homestead: HomesteadKb;
  /** Optional: caps garden plans at realistic household consumption. */
  consumption?: ConsumptionKb;
}
