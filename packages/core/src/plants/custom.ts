/**
 * Plants the user adds themselves. They live alongside the bundled database (same PlantSpec, so
 * suitability, calendars, bed layout and yields all work) but are stored on the device by the app,
 * which registers them here at start-up and after each edit. Ids start with "custom-" so they can
 * never collide with a bundled plant.
 */
import type { PlantKind, PlantSpec } from './types';

export const CUSTOM_PREFIX = 'custom-';
export const isCustomPlantId = (id: string): boolean => id.startsWith(CUSTOM_PREFIX);

let custom: PlantSpec[] = [];
let customById = new Map<string, PlantSpec>();

/** Replace the registered custom plants (the app's store calls this after loading or editing). */
export function setCustomPlants(list: PlantSpec[]): void {
  custom = list.filter((p) => isCustomPlantId(p.id));
  customById = new Map(custom.map((p) => [p.id, p]));
}

export function customPlants(): PlantSpec[] {
  return custom;
}

export function customPlantById(id: string): PlantSpec | undefined {
  return customById.get(id);
}

/**
 * Problems that would make a plant spec misbehave in the calendar, scoring or layout: the same rules
 * the bundled database is tested against. Empty when the spec is usable.
 */
export function validatePlantSpec(p: PlantSpec): string[] {
  const e: string[] = [];
  if (!p.commonName.trim()) e.push('Give the plant a name.');
  if (!(p.sunHours.min > 0) || p.sunHours.min > p.sunHours.ideal) e.push('Sun: the minimum hours must be above 0 and no more than the ideal.');
  if (p.sunHours.ideal > 16) e.push('Sun: ideal hours can’t exceed 16.');
  if (!(p.soil.pH[0] >= 4 && p.soil.pH[1] <= 8.5 && p.soil.pH[0] < p.soil.pH[1])) e.push('Soil pH: enter a range between 4 and 8.5, low value first.');
  if (p.daysToMaturity && !(p.daysToMaturity[0] > 0 && p.daysToMaturity[0] <= p.daysToMaturity[1])) e.push('Days to harvest: enter a range, shortest first.');
  if (p.germination && p.germination.minSoilF > p.germination.optimalF[0]) e.push('Germination: the minimum soil temperature must be at or below the best range.');
  if (p.sowing.indoorStartWeeks && p.sowing.indoorStartWeeks[0] < p.sowing.indoorStartWeeks[1]) e.push('Indoor start: enter the earliest (most weeks) first.');
  if (!(p.spacingIn.inRow > 0)) e.push('Spacing: plants need some space in the row.');
  else if (p.spacingIn.betweenRows < p.spacingIn.inRow * 0.5) e.push('Spacing: rows must be at least half the in-row spacing apart.');
  if (!(p.heightIn > 0) || !(p.spreadIn > 0)) e.push('Size: enter a height and a spread.');
  const s = p.sowing;
  if (!s.indoorStartWeeks && !s.transplantDays && !s.directSowDays && !s.fallDaysBeforeFirstFrost) e.push('Timing: add at least one way to plant it (sow, transplant or plant out).');
  if (p.lifecycle === 'perennial' && p.kind !== 'vegetable' && p.kind !== 'herb' && !p.zones) e.push('Perennials need hardiness zones.');
  if (p.zones && !(p.zones[0] >= 1 && p.zones[1] <= 13 && p.zones[0] <= p.zones[1])) e.push('Zones: enter a range from 1 to 13, coldest first.');
  if (p.chillHours && p.chillHours[0] > p.chillHours[1]) e.push('Chill hours: lowest first.');
  return e;
}

/** A sensible starting point for a new plant of this kind; the form edits it. */
export function blankPlantSpec(id: string, kind: PlantKind = 'vegetable'): PlantSpec {
  const perennial = kind === 'fruit-tree' || kind === 'nut-tree' || kind === 'berry' || kind === 'vine-fruit';
  return {
    id, commonName: '', scientificName: '', family: 'Custom', kind,
    lifecycle: perennial ? 'perennial' : 'annual', season: perennial ? 'perennial' : 'warm',
    frost: perennial ? 'hardy' : 'tender', heat: 'medium', sunHours: { min: 6, ideal: 8 },
    ...(perennial ? { maturityFrom: 'planting' as const, yearsToBearing: [2, 4] as [number, number], zones: [5, 8] as [number, number] }
      : { daysToMaturity: [60, 80] as [number, number], maturityFrom: 'seed' as const }),
    germination: perennial ? undefined : { minSoilF: 50, optimalF: [65, 80], days: [5, 10] },
    sowing: perennial ? { method: 'plant', directSowDays: [-28, 0] } : { method: 'direct', directSowDays: [7, 28], minSoilF: 55 },
    water: 'medium', soil: { pH: [6.0, 7.0], drainage: 'well-drained' },
    spacingIn: perennial ? { inRow: 72, betweenRows: 96 } : { inRow: 12, betweenRows: 24 },
    heightIn: perennial ? 96 : 24, spreadIn: perennial ? 72 : 12,
    humidityDisease: 'medium', diseases: [], pests: [],
  };
}
