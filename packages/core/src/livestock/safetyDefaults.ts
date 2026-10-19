/**
 * Conservative defaults (owner decision 7): wherever a sourced range drives a health or safety
 * decision, read its protective end. Kept in one place so every screen and alert agrees, and tested.
 */
import type { AnimalRange, AnimalSpec } from './types';

/** Needs (space, water, group size): the larger figure protects the animal. */
export const protectiveNeed = (r: AnimalRange | null | undefined): number | undefined => (r ? Math.max(r[0], r[1]) : undefined);

/** Space per head for a housing kind, sq ft (the larger cited figure). */
export function spacePerHeadSqFt(a: AnimalSpec, where: 'indoor' | 'outdoor'): number | undefined {
  return protectiveNeed(where === 'indoor' ? a.spaceIndoorSqFt : a.spaceOutdoorSqFt);
}

/** Pasture per head, acres (the larger cited figure). */
export const pastureAcres = (a: AnimalSpec) => protectiveNeed(a.pastureAcresPerHead);

/** Daily water to plan for, gallons (the larger cited figure). */
export const waterGallons = (a: AnimalSpec) => protectiveNeed(a.waterGalPerDay);

/** Smallest group the species should be kept in (social welfare). */
export const minimumGroup = (a: AnimalSpec) => Math.max(a.minGroupSize ?? 1, a.livesAloneOk ? 1 : 2);

/** NRC (1971) temperature-humidity index, °F form: THI = T − (0.55 − 0.0055·RH)(T − 58). */
export function thi(tempF: number, rhPct: number): number {
  return tempF - (0.55 - 0.0055 * rhPct) * (tempF - 58);
}

/**
 * Humidity to assume when the forecast has none. Heat stress rises with humidity, so the cautious
 * choice is a muggy figure: the site's summer average where known, never below 70%.
 */
export const fallbackHumidity = (summerRhPct?: number) => Math.max(70, summerRhPct ?? 70);

/** Is this hour hot enough to stress the species? Uses whichever sourced threshold trips first. */
export function heatStress(a: AnimalSpec, tempF: number, rhPct?: number, summerRhPct?: number): { stressed: boolean; basis?: string } {
  const h = a.heat;
  if (h.airOnsetF !== undefined && tempF >= h.airOnsetF) return { stressed: true, basis: `${Math.round(tempF)} °F ≥ ${h.airOnsetF} °F` };
  if (h.tPlusRhOnset !== undefined) {
    const rh = rhPct ?? fallbackHumidity(summerRhPct);
    const v = tempF + rh;
    if (v >= h.tPlusRhOnset) return { stressed: true, basis: `heat index (°F + humidity) ${Math.round(v)} ≥ ${h.tPlusRhOnset}${rhPct === undefined ? ', assuming humid air' : ''}` };
  }
  if (h.thiOnset !== undefined) {
    const rh = rhPct ?? fallbackHumidity(summerRhPct);
    const v = thi(tempF, rh);
    if (v >= h.thiOnset) return { stressed: true, basis: `heat index (THI) ${Math.round(v)} ≥ ${h.thiOnset}${rhPct === undefined ? ', assuming humid air' : ''}` };
  }
  return { stressed: false };
}

/** Night low at or below which water lines and troughs can freeze. */
export const FREEZE_F = 32;
