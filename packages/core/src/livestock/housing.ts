/**
 * Herds on the map (prompt §5, phase 4): how full a housing object is when several herds share it,
 * which species shouldn't share, suggested limits for a sensor in a coop or barn, live heat stress
 * from that sensor's own humidity, and the care tasks coming up across herds. Pure; the app supplies
 * the herds and readings.
 */
import type { DesignObject } from '../design/design';
import type { LocalFrame } from '../geo/measure';
import { formatDoy } from '../climate/normals';
import type { AnimalEvent } from './calendar';
import { housingCapacity, type Capacity } from './capacity';
import { FREEZE_F, heatStress } from './safetyDefaults';
import type { AnimalSpec } from './types';

export interface HousedHerd { herdId: string; animal: AnimalSpec; count: number }

export interface HousingOccupancy {
  /** Share of the space in use (1 = full), or null when no herd here has a sourced space figure. */
  used: number | null;
  over: boolean;
  shares: Array<HousedHerd & { capacity: Capacity }>;
  /** Pairs that shouldn't share housing, with the sourced reason. */
  conflicts: string[];
}

/**
 * Several herds in one coop or paddock: each uses count ÷ (how many of its kind would fit alone).
 * Herds without a sourced figure don't count toward the total, so the total is a floor, never a pass.
 */
export function housingOccupancy(herds: HousedHerd[], o: DesignObject, frame: LocalFrame): HousingOccupancy {
  const shares = herds.map((h) => ({ ...h, capacity: housingCapacity(h.animal, o, frame, h.count) }));
  const sized = shares.filter((s) => s.capacity.fits !== null);
  const used = sized.length ? sized.reduce((x, s) => x + (s.capacity.fits! > 0 ? s.count / s.capacity.fits! : s.count > 0 ? Infinity : 0), 0) : null;
  const conflicts: string[] = [];
  for (let i = 0; i < herds.length; i++)
    for (let j = i + 1; j < herds.length; j++) {
      const a = herds[i]!.animal, b = herds[j]!.animal;
      const k = a.keepApart.find((x) => x.id === b.id) ?? b.keepApart.find((x) => x.id === a.id);
      if (k) conflicts.push(`${a.commonName} and ${b.commonName.toLowerCase()}: ${k.reason}`);
    }
  return { used, over: used !== null && used > 1 + 1e-9, shares, conflicts };
}

export interface SensorLimits {
  /** Alert above this air temperature (°F): the lowest sourced heat-stress onset among the herds. */
  maxF?: number;
  /** Alert below this (°F): freezing water, or a higher sourced safe minimum. */
  minF: number;
  basis: string[];
}

/** Suggested limits for a temperature sensor in animal housing, from the species living there. */
export function housingSensorLimits(animals: AnimalSpec[]): SensorLimits {
  const basis: string[] = [];
  const onsets = animals.filter((a) => a.heat.airOnsetF !== undefined);
  let maxF: number | undefined;
  if (onsets.length) {
    const lowest = onsets.reduce((x, a) => (a.heat.airOnsetF! < x.heat.airOnsetF! ? a : x));
    maxF = lowest.heat.airOnsetF!;
    basis.push(`Heat: ${maxF} °F, where heat stress begins for ${lowest.commonName.toLowerCase()}.`);
  }
  if (animals.some((a) => a.heat.airOnsetF === undefined && a.heat.thiOnset !== undefined))
    basis.push('For animals rated by heat index (THI), the sensor’s own humidity is used too.');
  const mins = animals.filter((a) => a.cold.safeMinF !== undefined && a.cold.safeMinF > FREEZE_F);
  let minF = FREEZE_F;
  if (mins.length) {
    const warmest = mins.reduce((x, a) => (a.cold.safeMinF! > x.cold.safeMinF! ? a : x));
    minF = warmest.cold.safeMinF!;
    basis.push(`Cold: ${minF} °F, the sourced safe minimum for ${warmest.commonName.toLowerCase()}.`);
  } else basis.push(`Cold: ${FREEZE_F} °F, when water starts to freeze.`);
  return { maxF, minF, basis };
}

/**
 * Heat stress right now from a sensor in the housing, using its measured humidity for THI species.
 * Returns the animals affected and why; empty when none are stressed or there are no readings.
 */
export function housingHeatCheck(animals: AnimalSpec[], tempF: number | undefined, rhPct: number | undefined): Array<{ animal: AnimalSpec; basis: string }> {
  if (tempF === undefined) return [];
  return animals.flatMap((a) => {
    const s = heatStress(a, tempF, rhPct);
    return s.stressed ? [{ animal: a, basis: s.basis! }] : [];
  });
}

/** Day of year for an ISO date (YYYY-MM-DD…), or undefined. */
export function doyOfIso(iso: string | undefined): number | undefined {
  const m = iso && /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  return Math.round((Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) - Date.UTC(+m[1]!, 0, 0)) / 86_400_000);
}

export interface HerdTask extends AnimalEvent { herdId: string; animalId: string }

/** Does a window (which may wrap past New Year, e.g. Nov–Mar) overlap [from, to]? */
export function windowOverlaps(e: { start: number; end: number }, from: number, to: number): boolean {
  if (e.start <= e.end) return e.end >= from && e.start <= to;
  return e.start <= to || e.end >= from;
}

/** Care tasks across herds that overlap [from, to], soonest first (a wrapped window in progress counts as now). */
export function upcomingAnimalTasks(cals: Array<{ herdId: string; animalId: string; events: AnimalEvent[] }>, from: number, to: number): HerdTask[] {
  const out: HerdTask[] = [];
  for (const c of cals) for (const e of c.events) if (windowOverlaps(e, from, to)) out.push({ ...e, herdId: c.herdId, animalId: c.animalId });
  const key = (e: HerdTask) => (e.start > e.end && e.start > to ? e.start - 365 : e.start);
  return out.sort((a, b) => key(a) - key(b));
}

/** "Mar 28" or "Nov 7 – Mar 28". */
export function formatWindow(e: { start: number; end: number }): string {
  return e.start === e.end ? formatDoy(e.start) : `${formatDoy(e.start)} – ${formatDoy(e.end)}`;
}
