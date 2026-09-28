/**
 * Daily climate curves for the planting calendar (§7.3), built from NOAA seasonal normals:
 *  - air temperature: an annual harmonic (mean + first sine) fitted to the four seasonal means of
 *    daily min and max, adjusted to the parcel's elevation with the lapse rate;
 *  - soil temperature at ~2 in: the daily-mean air curve lagged and damped (bare, moist soil). Used
 *    only when no sensor or regional soil station is available, and labelled "modeled";
 *  - growing degree days (averaging method, with an upper cap) calibrated against the station's
 *    published annual GDD base 50 °F when present;
 *  - winter chill hours (32–45 °F) from a sinusoidal day/night cycle.
 * All temperatures °F; days are day-of-year in a non-leap year.
 */
import type { StationNormals } from '../climate/normals';
import { DEFAULT_LAPSE_RATE_C_PER_KM } from '../climate/frost';
import { deltaCToF } from '../units';

export interface Harmonic {
  mean: number;
  a: number; // cosine coefficient
  b: number; // sine coefficient
}

export interface ClimateCurves {
  tmin: Harmonic;
  tmax: Harmonic;
  /** Multiplier applied to raw daily GDD so the annual total matches the station's published value. */
  gddCalibration: number;
  /** Temperature offset applied for the parcel's elevation (°F; negative = colder than the station). */
  elevationOffsetF: number;
  stationId: string;
  notes: string[];
}

/** Season centres: mid-Jan, mid-Apr, mid-Jul, mid-Oct. */
const CENTRES = { DJF: 15, MAM: 105, JJA: 196, SON: 288 } as const;
const W = (2 * Math.PI) / 365;

export function evalHarmonic(h: Harmonic, doy: number): number {
  return h.mean + h.a * Math.cos(W * doy) + h.b * Math.sin(W * doy);
}

/** Least-squares first-harmonic fit through (day, value) points. */
export function fitHarmonic(points: Array<[number, number]>): Harmonic {
  // Normal equations for [1, cos, sin].
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [0, 0, 0];
  for (const [d, y] of points) {
    const f = [1, Math.cos(W * d), Math.sin(W * d)];
    for (let i = 0; i < 3; i++) {
      v[i]! += f[i]! * y;
      for (let j = 0; j < 3; j++) M[i]![j]! += f[i]! * f[j]!;
    }
  }
  // Solve 3×3 by Cramer's rule.
  const det = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const D = det(M);
  const col = (k: number) => M.map((row, i) => row.map((x, j) => (j === k ? v[i]! : x)));
  return { mean: det(col(0)) / D, a: det(col(1)) / D, b: det(col(2)) / D };
}

function seasonal(t: StationNormals['tminF']): Array<[number, number]> {
  return (['DJF', 'MAM', 'JJA', 'SON'] as const).filter((k) => t[k] !== undefined).map((k) => [CENTRES[k], t[k]!]);
}

export function climateCurves(
  station: StationNormals,
  parcelElevationM: number,
  opts: { lapseRateCPerKm?: number } = {},
): ClimateCurves | null {
  const minPts = seasonal(station.tminF), maxPts = seasonal(station.tmaxF);
  if (minPts.length < 3 || maxPts.length < 3) return null;
  const lapse = opts.lapseRateCPerKm ?? DEFAULT_LAPSE_RATE_C_PER_KM;
  const dz = Number.isFinite(station.elevationM) ? parcelElevationM - station.elevationM : 0;
  const off = deltaCToF((-lapse * dz) / 1000);
  const tmin = fitHarmonic(minPts), tmax = fitHarmonic(maxPts);
  tmin.mean += off;
  tmax.mean += off;
  const curves: ClimateCurves = {
    tmin, tmax, gddCalibration: 1, elevationOffsetF: off, stationId: station.stationId,
    notes: [
      `Daily temperatures fitted to NOAA 1991–2020 seasonal normals at ${station.name ?? station.stationId}${Math.abs(off) >= 0.1 ? `, ${off > 0 ? '+' : ''}${off.toFixed(1)} °F for your elevation` : ''}.`,
    ],
  };
  // Calibrate GDD against the station's published annual total (before the elevation offset).
  if (station.gddBase50F && station.gddBase50F > 0) {
    const raw = annualGdd({ ...curves, tmin: { ...tmin, mean: tmin.mean - off }, tmax: { ...tmax, mean: tmax.mean - off } }, 50, 86, 1);
    if (raw > 0) {
      curves.gddCalibration = Math.max(0.7, Math.min(1.3, station.gddBase50F / raw));
      curves.notes.push(`Heat units calibrated to the station's published ${Math.round(station.gddBase50F)} GDD (base 50 °F).`);
    }
  }
  return curves;
}

export const dailyMin = (c: ClimateCurves, doy: number) => evalHarmonic(c.tmin, doy);
export const dailyMax = (c: ClimateCurves, doy: number) => evalHarmonic(c.tmax, doy);
export const dailyMean = (c: ClimateCurves, doy: number) => (dailyMin(c, doy) + dailyMax(c, doy)) / 2;

/**
 * Modeled soil temperature at ~2 in depth: daily mean air temperature lagged ~7 days with the annual
 * swing damped ~10 %, which is typical for bare, moist garden soil. Mulch and shade run cooler.
 */
export function modeledSoilF(c: ClimateCurves, doy: number): number {
  const lag = 7, damp = 0.9;
  const mean = (c.tmin.mean + c.tmax.mean) / 2;
  const a = (c.tmin.a + c.tmax.a) / 2, b = (c.tmin.b + c.tmax.b) / 2;
  const d = doy - lag;
  return mean + damp * (a * Math.cos(W * d) + b * Math.sin(W * d));
}

/** First day in [from, to] when `f(doy)` reaches `threshold` and stays there for 5 days. */
export function firstDayAtLeast(f: (doy: number) => number, threshold: number, from = 1, to = 365): number | null {
  for (let d = from; d <= to; d++) {
    let ok = true;
    for (let k = 0; k < 5 && ok; k++) ok = f(Math.min(365, d + k)) >= threshold;
    if (ok) return d;
  }
  return null;
}

/** Daily growing degree days (averaging method with the max capped at `capF`, min raised to base). */
export function dailyGdd(c: ClimateCurves, doy: number, baseF = 50, capF = 86): number {
  const hi = Math.min(dailyMax(c, doy), capF);
  const lo = Math.max(dailyMin(c, doy), baseF);
  return Math.max(0, (hi + lo) / 2 - baseF) * c.gddCalibration;
}

export function annualGdd(c: ClimateCurves, baseF = 50, capF = 86, calibration = c.gddCalibration): number {
  let s = 0;
  const cc = { ...c, gddCalibration: calibration };
  for (let d = 1; d <= 365; d++) s += dailyGdd(cc, d, baseF, capF);
  return s;
}

/** Cumulative GDD from `from` (inclusive) to `to` (inclusive), wrapping the year end if needed. */
export function gddBetween(c: ClimateCurves, from: number, to: number, baseF = 50, capF = 86): number {
  let s = 0;
  for (let d = from; d !== to + 1; d = d === 365 ? 1 : d + 1) {
    s += dailyGdd(c, d, baseF, capF);
    if (d === to) break;
  }
  return s;
}

/** Day by which `gdd` heat units have accumulated after `from`, or null within a year. */
export function dayGddReached(c: ClimateCurves, from: number, gdd: number, baseF = 50, capF = 86): number | null {
  let s = 0;
  for (let k = 0; k < 365; k++) {
    const d = ((from - 1 + k) % 365) + 1;
    s += dailyGdd(c, d, baseF, capF);
    if (s >= gdd) return d;
  }
  return null;
}

/** Temperature at hour `h` (0–23): coldest at 6 am, warmest at 3 pm, cosine-shaped between. */
export function hourlyTemp(lo: number, hi: number, h: number): number {
  if (h >= 6 && h <= 15) return lo + ((hi - lo) * (1 - Math.cos((Math.PI * (h - 6)) / 9))) / 2;
  const since = (h - 15 + 24) % 24; // 0..15 hours after the afternoon peak
  return hi - ((hi - lo) * (1 - Math.cos((Math.PI * since) / 15))) / 2;
}

/**
 * Winter chill hours (hours between 32 and 45 °F), 1 Oct – 28 Feb, assuming a sinusoidal day/night
 * cycle between each day's normal min and max. A rough guide (±25 %): orchard chill models and
 * actual winters vary.
 */
export function chillHours(c: ClimateCurves): number {
  let hours = 0;
  const days = [...Array.from({ length: 92 }, (_, i) => 274 + i), ...Array.from({ length: 59 }, (_, i) => 1 + i)];
  for (const d of days) {
    const lo = dailyMin(c, d), hi = dailyMax(c, d);
    for (let h = 0; h < 24; h++) {
      const t = hourlyTemp(lo, hi, h);
      if (t >= 32 && t <= 45) hours++;
    }
  }
  return hours;
}

/** Hottest normal daily maximum of the year (°F), for heat-stress checks. */
export function peakSummerMax(c: ClimateCurves): number {
  let m = -Infinity;
  for (let d = 1; d <= 365; d++) m = Math.max(m, dailyMax(c, d));
  return m;
}
