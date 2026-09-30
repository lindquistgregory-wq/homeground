/**
 * Parcel-adjusted frost dates (§4 "Elevation-adjusted temperatures" and "Frost dates as probabilities").
 *
 * Method, shown to the user verbatim via `notes`:
 *  1. Take up to 3 nearby NCEI normals stations that publish freeze probabilities.
 *  2. For each, estimate how much warmer/colder the parcel is from the elevation difference and a
 *     standard lapse rate (default 6.5 °C/km, configurable).
 *  3. Convert that temperature offset into a date shift using how fast the station's minimum
 *     temperatures change in spring (DJF→MAM normals) and fall (JJA→SON normals).
 *  4. Blend stations by inverse-distance² weighting.
 * Cold-air drainage (frost pockets) is applied in Phase 2 via `extraShiftDays` from the DEM engine.
 */
import { distanceM } from '../geo/measure';
import type { LatLon } from '../geo/types';
import type { Confidence } from '../provenance';
import { deltaCToF } from '../units';
import { formatDoy, hasFreezeData, hasTemperatureData, type DayOfYear, type StationNormals } from './normals';

export const DEFAULT_LAPSE_RATE_C_PER_KM = 6.5;
const MAX_SHIFT_DAYS = 30;
const MIN_RATE_F_PER_DAY = 0.08; // guards against tiny seasonal gradients (e.g. maritime tropics)

export type RiskLevel = 10 | 50 | 90;
export type ThresholdF = 32 | 28;

export interface FrostDates {
  /** Last spring freeze: date after which only `risk` % of years still see a freeze. */
  lastSpring: Record<ThresholdF, Record<RiskLevel, DayOfYear | null>>;
  /** First fall freeze: date before which only `risk` % of years see a freeze. */
  firstFall: Record<ThresholdF, Record<RiskLevel, DayOfYear | null>>;
  /** Median (50 %) freeze-free season length at 32 °F, days. */
  freezeFreeDays: number | null;
  /** True when nearby stations report no 32 °F freeze in most years. */
  freezeRare: boolean;
}

export interface StationContribution {
  stationId: string;
  name?: string;
  distanceKm: number;
  elevationDiffM: number;
  weight: number;
  springShiftDays: number;
  fallShiftDays: number;
}

export interface FrostEstimate {
  dates: FrostDates;
  stations: StationContribution[];
  confidence: Confidence;
  notes: string[];
}

export interface FrostOptions {
  lapseRateCPerKm?: number;
  maxStations?: number;
  /** Stations further than this are ignored unless nothing else is available. */
  preferredRadiusKm?: number;
  maxRadiusKm?: number;
  /** Additional local shift (e.g. frost pocket), positive = later spring / earlier fall. */
  extraShiftDays?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Days to shift the station's dates for a parcel `dz` metres higher (negative = lower). */
export function elevationShiftDays(station: StationNormals, dzM: number, lapseCPerKm = DEFAULT_LAPSE_RATE_C_PER_KM) {
  const dTempF = deltaCToF((-lapseCPerKm * dzM) / 1000); // negative when parcel is higher (colder)
  const { DJF, MAM, JJA, SON } = station.tminF;
  // Seasonal means are centred ~90 days apart (mid-Jan → mid-Apr, mid-Jul → mid-Oct).
  const springRate = DJF !== undefined && MAM !== undefined ? Math.max(MIN_RATE_F_PER_DAY, (MAM - DJF) / 90) : 0.25;
  const fallRate = JJA !== undefined && SON !== undefined ? Math.max(MIN_RATE_F_PER_DAY, (JJA - SON) / 92) : 0.25;
  return {
    dTempF,
    // Colder parcel (dTempF < 0) → spring freeze later (+), fall freeze earlier (−).
    spring: clamp(-dTempF / springRate, -MAX_SHIFT_DAYS, MAX_SHIFT_DAYS),
    fall: clamp(dTempF / fallRate, -MAX_SHIFT_DAYS, MAX_SHIFT_DAYS),
  };
}

export function estimateFrostDates(
  parcel: LatLon & { elevationM: number },
  stations: StationNormals[],
  opts: FrostOptions = {},
): FrostEstimate | null {
  const lapse = opts.lapseRateCPerKm ?? DEFAULT_LAPSE_RATE_C_PER_KM;
  const maxStations = opts.maxStations ?? 3;
  const preferred = opts.preferredRadiusKm ?? 60;
  const maxRadius = opts.maxRadiusKm ?? 150;
  const extra = opts.extraShiftDays ?? 0;

  const ranked = stations
    .map((s) => ({ s, km: distanceM(parcel, s) / 1000 }))
    .filter((x) => x.km <= maxRadius)
    .sort((a, b) => a.km - b.km);
  if (ranked.length === 0) return null;

  const withFreeze = ranked.filter((x) => hasFreezeData(x.s));
  if (withFreeze.length === 0) {
    // Only conclude "frost is rare" when nearby stations measure temperature yet publish no freeze
    // dates. Precipitation-only stations tell us nothing either way.
    const nearest = ranked.find((x) => hasTemperatureData(x.s));
    if (!nearest || nearest.km > preferred) return null;
    const nullTable = () => ({ 10: null, 50: null, 90: null });
    return {
      dates: {
        lastSpring: { 32: nullTable(), 28: nullTable() },
        firstFall: { 32: nullTable(), 28: nullTable() },
        freezeFreeDays: 365,
        freezeRare: true,
      },
      stations: [],
      confidence: 'medium',
      notes: [`Nearby stations (nearest ${nearest.km.toFixed(0)} km) report no 32 °F freeze in most years.`],
    };
  }

  let chosen = withFreeze.filter((x) => x.km <= preferred).slice(0, maxStations);
  if (chosen.length === 0) chosen = withFreeze.slice(0, 1);

  const contributions: StationContribution[] = [];
  let wSum = 0;
  const noElevation: string[] = [];
  for (const { s, km } of chosen) {
    const w = 1 / Math.max(1, km) ** 2;
    const knownElevation = Number.isFinite(s.elevationM);
    if (!knownElevation) noElevation.push(s.name ?? s.stationId);
    const dz = knownElevation ? parcel.elevationM - s.elevationM : 0;
    const shift = elevationShiftDays(s, dz, lapse);
    contributions.push({
      stationId: s.stationId,
      name: s.name,
      distanceKm: km,
      elevationDiffM: dz,
      weight: w,
      springShiftDays: shift.spring + extra,
      fallShiftDays: shift.fall - extra,
    });
    wSum += w;
  }
  for (const c of contributions) c.weight /= wSum;

  const blend = (pick: (s: StationNormals) => number | undefined, shiftOf: (c: StationContribution) => number): number | null => {
    let acc = 0, wAcc = 0;
    chosen.forEach(({ s }, i) => {
      const v = pick(s);
      if (v === undefined) return;
      const c = contributions[i]!;
      acc += (v + shiftOf(c)) * c.weight;
      wAcc += c.weight;
    });
    return wAcc > 0 ? Math.round(acc / wAcc) : null;
  };

  const levels: RiskLevel[] = [10, 50, 90];
  const thresholds: ThresholdF[] = [32, 28];
  const lastSpring = {} as FrostDates['lastSpring'];
  const firstFall = {} as FrostDates['firstFall'];
  for (const t of thresholds) {
    lastSpring[t] = {} as Record<RiskLevel, DayOfYear | null>;
    firstFall[t] = {} as Record<RiskLevel, DayOfYear | null>;
    for (const p of levels) {
      lastSpring[t][p] = blend((s) => s.lastSpring[t]?.[p], (c) => c.springShiftDays);
      firstFall[t][p] = blend((s) => s.firstFall[t]?.[p], (c) => c.fallShiftDays);
    }
    // Stations can publish different subsets of levels, so blending may break ordering; restore it.
    // Spring: 10 % risk date is the latest. Fall: 10 % risk date is the earliest.
    const ls = lastSpring[t], ff = firstFall[t];
    if (ls[50] !== null) {
      if (ls[10] !== null) ls[10] = Math.max(ls[10], ls[50]);
      if (ls[90] !== null) ls[90] = Math.min(ls[90], ls[50]);
    }
    if (ff[50] !== null) {
      if (ff[10] !== null) ff[10] = Math.min(ff[10], ff[50]);
      if (ff[90] !== null) ff[90] = Math.max(ff[90], ff[50]);
    }
  }
  const ls = lastSpring[32][50], ff = firstFall[32][50];
  const freezeFreeDays = ls !== null && ff !== null ? Math.max(0, ff - ls) : null;

  const nearest = contributions[0]!;
  const maxDz = Math.max(...contributions.map((c) => Math.abs(c.elevationDiffM)));
  let confidence: Confidence =
    nearest.distanceKm <= 15 && maxDz <= 100 ? 'high' : nearest.distanceKm <= 40 && maxDz <= 300 ? 'medium' : 'low';
  if (noElevation.length && confidence === 'high') confidence = 'medium';

  const notes: string[] = [
    `Blended from ${contributions.length} NOAA 1991–2020 normals station${contributions.length > 1 ? 's' : ''} (nearest ${nearest.distanceKm.toFixed(0)} km).`,
    ...contributions.map((c) => {
      const dir = c.elevationDiffM >= 0 ? 'higher' : 'lower';
      return `${c.name ?? c.stationId}: parcel is ${Math.abs(c.elevationDiffM).toFixed(0)} m ${dir}; spring dates shifted ${fmtShift(c.springShiftDays)}, fall ${fmtShift(c.fallShiftDays)} (lapse rate ${lapse} °C/km).`;
    }),
  ];
  if (ls !== null && ff !== null)
    notes.push(`Median last 32 °F freeze ${formatDoy(ls)}; median first ${formatDoy(ff)}.`);
  if (noElevation.length) notes.push(`No published elevation for ${noElevation.join(', ')}; dates from ${noElevation.length > 1 ? 'those stations' : 'that station'} are not elevation-adjusted.`);
  if (extra !== 0) notes.push(`Includes a local adjustment of ${fmtShift(extra)} for cold-air pooling.`);
  if (confidence === 'low') notes.push('Stations are distant or at very different elevations — treat these dates as rough.');

  return { dates: { lastSpring, firstFall, freezeFreeDays, freezeRare: false }, stations: contributions, confidence, notes };
}

function fmtShift(d: number): string {
  const r = Math.round(d);
  return r === 0 ? '0 days' : `${r > 0 ? '+' : '−'}${Math.abs(r)} day${Math.abs(r) === 1 ? '' : 's'}`;
}
