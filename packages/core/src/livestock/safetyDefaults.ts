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

/**
 * When no species-specific onset is sourced, heat stress is still flagged with the air temperature
 * (°F) plus humidity (%) index that extension services use for horses and camelids: under 120 the
 * animal copes, 130 is the usual limit and 150 is dangerous (NMSU, UGA, Ohio State). The cutoff
 * follows the species' heat tolerance, cautious end first: low or unknown 120, medium 130, high 150.
 */
export const FALLBACK_T_PLUS_RH: Record<'low' | 'medium' | 'high', number> = { low: 120, medium: 130, high: 150 };
/**
 * The general limit only applies on a genuinely warm day: below this air temperature an assumed muggy
 * humidity alone would trip it (70 °F + 70% = 140), and daily alerts on mild days teach people to
 * ignore real ones.
 */
export const FALLBACK_MIN_AIR_F = 80;
/** Kinds the fallback doesn't apply to: bees regulate the hive, fish and worms aren't helped by this advice. */
const NO_FALLBACK = new Set(['pollinator', 'aquatic', 'invertebrate']);

export function fallbackHeatOnset(a: AnimalSpec): number | undefined {
  const h = a.heat;
  if (h.airOnsetF !== undefined || h.tPlusRhOnset !== undefined || h.thiOnset !== undefined || NO_FALLBACK.has(a.kind)) return undefined;
  return FALLBACK_T_PLUS_RH[h.tolerance ?? 'low'];
}

/**
 * Hard-cold night low for species with no sourced safe minimum, by cold tolerance (cautious end for
 * unknown): low 20 °F, medium 10 °F, high 0 °F. It prompts shelter from wind and wet, not heat.
 */
export const FALLBACK_COLD_MIN_F: Record<'low' | 'medium' | 'high', number> = { low: 20, medium: 10, high: 0 };

/** The night low below which to warn about hard cold: the sourced minimum, else the tolerance fallback. */
export function coldMinF(a: AnimalSpec): number | undefined {
  if (a.cold.safeMinF !== undefined) return a.cold.safeMinF;
  if (NO_FALLBACK.has(a.kind)) return undefined;
  return FALLBACK_COLD_MIN_F[a.cold.tolerance ?? 'low'];
}

/** Is this hour hot enough to stress the species? Uses whichever sourced threshold trips first. */
export function heatStress(a: AnimalSpec, tempF: number, rhPct?: number, summerRhPct?: number): { stressed: boolean; basis?: string } {
  const fallback = fallbackHeatOnset(a);
  if (fallback !== undefined) {
    if (tempF < FALLBACK_MIN_AIR_F) return { stressed: false };
    const rh = rhPct ?? fallbackHumidity(summerRhPct);
    const v = tempF + rh;
    return v >= fallback
      ? { stressed: true, basis: `°F + humidity ${Math.round(v)} ≥ ${fallback}, a cautious general limit (no ${a.commonName.toLowerCase()}-specific figure is sourced)${rhPct === undefined ? ', assuming humid air' : ''}` }
      : { stressed: false };
  }
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
