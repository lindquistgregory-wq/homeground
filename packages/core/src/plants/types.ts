/**
 * Plant data model (§7.1). Values are typical horticultural ranges for US home gardens, written for
 * this project from general knowledge and cross-checked against land-grant extension guidance (see
 * `docs/PLANT_DATA.md`). They are facts, not copied text; the app links out to extension guides
 * for how-to content. Seed packets and local extension advice win over these defaults.
 *
 * Units: temperatures °F, spacing inches, heights inches, days, yields in pounds.
 */

export type PlantKind = 'vegetable' | 'herb' | 'berry' | 'fruit-tree' | 'nut-tree' | 'vine-fruit' | 'cover-crop' | 'flower';
export type Lifecycle = 'annual' | 'biennial' | 'perennial';
/**
 * tender: damaged at 32 °F · half-hardy: survives light frost (~30–32 °F) · hardy: survives hard
 * frost (~26–28 °F) · very-hardy: survives ~20 °F and below.
 */
export type FrostTolerance = 'tender' | 'half-hardy' | 'hardy' | 'very-hardy';
export type Level = 'low' | 'medium' | 'high';
export type Season = 'cool' | 'warm' | 'perennial';
export type Drainage = 'well-drained' | 'moist' | 'tolerates-wet';
export type Texture = 'sandy' | 'loamy' | 'clayey';

export interface SowingPlan {
  /** How it's usually established. 'plant' = crowns, sets, bare-root or container stock. */
  method: 'direct' | 'transplant' | 'either' | 'plant';
  /** Weeks before the median last spring frost to start seeds indoors, [earliest, latest]. */
  indoorStartWeeks?: [number, number];
  /** Days relative to the last spring frost to set out transplants (negative = before). */
  transplantDays?: [number, number];
  /** Days relative to the last spring frost to direct-sow or plant (negative = before). */
  directSowDays?: [number, number];
  /** Minimum soil temperature (°F) at planting depth to sow or transplant. */
  minSoilF?: number;
  /** Fall crop: sow/transplant this many days before the median first fall frost, [earliest, latest]. */
  fallDaysBeforeFirstFrost?: [number, number];
  /** Days between successive sowings for a continuous harvest. */
  successionDays?: number;
}

export interface PlantSpec {
  id: string;
  commonName: string;
  scientificName: string;
  family: string;
  kind: PlantKind;
  lifecycle: Lifecycle;
  season: Season;
  frost: FrostTolerance;
  heat: Level;
  /** Direct-sun hours per day: below `min` it won't produce well; `ideal` for full yield. */
  sunHours: { min: number; ideal: number };
  /** Days to first harvest, [fast variety, slow variety], counted from `maturityFrom`. */
  daysToMaturity?: [number, number];
  maturityFrom?: 'seed' | 'transplant' | 'planting';
  /** Heat units to maturity (°F·days above `gddBaseF`), where commonly published. */
  gddToMaturity?: number;
  gddBaseF?: number;
  germination?: { minSoilF: number; optimalF: [number, number]; days?: [number, number] };
  sowing: SowingPlan;
  /** How long a planting keeps producing once it starts, days. */
  harvestWindowDays?: number;
  water: Level;
  soil: { pH: [number, number]; drainage: Drainage; textures?: Texture[] };
  spacingIn: { inRow: number; betweenRows: number };
  /** Plants per square foot in square-foot gardening (for small crops). */
  perSquareFoot?: number;
  heightIn: number;
  spreadIn: number;
  /** USDA hardiness zones where a perennial overwinters, [coldest, warmest]. */
  zones?: [number, number];
  /** Winter chilling hours (32–45 °F) needed to fruit, [low-chill variety, high-chill variety]. */
  chillHours?: [number, number];
  pollination?: 'self' | 'partly-self' | 'needs-partner' | 'wind';
  /** Diseases that thrive in humid, wet-leaf weather, and how exposed this crop is. */
  humidityDisease: Level;
  diseases: string[];
  pests: string[];
  /** Traditional companion pairings (plant ids). Evidence is mostly anecdotal; shown as tips only. */
  companions?: string[];
  avoidNear?: string[];
  /** Typical home-garden yield per 10 ft of row, pounds (annuals), or per mature plant (perennials). */
  yieldLb?: { per: '10ft-row' | 'plant'; range: [number, number] };
  /** Years to first real crop for perennials. */
  yearsToBearing?: [number, number];
  notes?: string[];
}
