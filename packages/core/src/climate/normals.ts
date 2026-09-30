/**
 * Parsing for NOAA NCEI U.S. Climate Normals 1991–2020 (dataset `normals-annualseasonal-1991-2020`)
 * as returned by the NCEI Access Data Service with `format=json&includeStationLocation=1`.
 *
 * Freeze-probability element names look like `ANN-TMIN-PRBLST-T32FP10`:
 *   PRBLST = last spring occurrence, PRBFST = first fall occurrence, PRBGSL = growing-season length (days)
 *   T32    = threshold 32 °F (also 36, 28, 24, 20, 16)
 *   FP10   = probability level 10 %
 * Semantics (verified against station USW00014735, Albany NY: PRBLST-T32FP10 = 05/11, FP90 = 04/16):
 *   PRBLST-TxxFPyy = date after which there is only a yy % chance of a later spring freeze.
 *   PRBFST-TxxFPyy = date before which there is only a yy % chance of an earlier fall freeze.
 * Values arrive as space-padded strings; NCEI uses sentinel codes like "-4444", "-6666", "-7777", "-9999".
 */

export const FREEZE_THRESHOLDS_F = [36, 32, 28, 24, 20, 16] as const;
export const FREEZE_PROBABILITIES = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
export type FreezeThresholdF = (typeof FREEZE_THRESHOLDS_F)[number];
export type FreezeProbability = (typeof FREEZE_PROBABILITIES)[number];

/** Day-of-year in a non-leap year (Jan 1 = 1). */
export type DayOfYear = number;

export type FreezeTable = Partial<Record<FreezeThresholdF, Partial<Record<FreezeProbability, DayOfYear>>>>;

export interface StationNormals {
  stationId: string;
  name?: string;
  lat: number;
  lon: number;
  elevationM: number;
  lastSpring: FreezeTable;
  firstFall: FreezeTable;
  /** Growing-season length in days between freezes, keyed like the freeze tables. */
  growingSeasonDays: FreezeTable;
  /** Seasonal mean daily minimum temperature normals, °F. */
  tminF: { DJF?: number; MAM?: number; JJA?: number; SON?: number; ANN?: number };
  /** Annual growing degree days base 50 °F (NCEI `ANN-GRDD-BASE50`), if present. */
  gddBase50F?: number;
  /** Annual precipitation normal, inches. */
  precipIn?: number;
}

const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function mmddToDoy(mmdd: string): DayOfYear | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(mmdd.trim());
  if (!m) return undefined;
  const month = Number(m[1]), day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return CUMULATIVE_DAYS[month - 1]! + day;
}

export function doyToMonthDay(doy: DayOfYear): { month: number; day: number } {
  const d = Math.min(365, Math.max(1, Math.round(doy)));
  let month = 12;
  while (month > 1 && CUMULATIVE_DAYS[month - 1]! >= d) month--;
  return { month, day: d - CUMULATIVE_DAYS[month - 1]! };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDoy(doy: DayOfYear): string {
  const { month, day } = doyToMonthDay(doy);
  return `${MONTHS[month - 1]} ${day}`;
}

function isSentinel(raw: string): boolean {
  return /^-(\d)\1{3}$/.test(raw.trim());
}

function num(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (s === '' || isSentinel(s)) return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

const KEY_RE = /^ANN-TMIN-(PRBLST|PRBFST|PRBGSL)-T(\d{2})FP(\d{2})$/;

/** Parse one row of the Access Data Service JSON array. Returns undefined if location is missing. */
export function parseNormalsRow(row: Record<string, unknown>): StationNormals | undefined {
  const lat = num(row.LATITUDE), lon = num(row.LONGITUDE), elev = num(row.ELEVATION);
  const stationId = typeof row.STATION === 'string' ? row.STATION.trim() : undefined;
  if (lat === undefined || lon === undefined || !stationId) return undefined;

  const out: StationNormals = {
    stationId,
    name: typeof row.NAME === 'string' ? row.NAME.trim() : undefined,
    lat,
    lon,
    elevationM: elev ?? NaN,
    lastSpring: {},
    firstFall: {},
    growingSeasonDays: {},
    tminF: {},
    gddBase50F: num(row['ANN-GRDD-BASE50']),
    precipIn: num(row['ANN-PRCP-NORMAL']),
  };

  for (const [key, raw] of Object.entries(row)) {
    const m = KEY_RE.exec(key);
    if (m) {
      const kind = m[1]!, t = Number(m[2]) as FreezeThresholdF, p = Number(m[3]) as FreezeProbability;
      if (typeof raw !== 'string' || isSentinel(raw)) continue;
      const table = kind === 'PRBLST' ? out.lastSpring : kind === 'PRBFST' ? out.firstFall : out.growingSeasonDays;
      const value = kind === 'PRBGSL' ? num(raw) : mmddToDoy(raw);
      if (value === undefined) continue;
      (table[t] ??= {})[p] = value;
      continue;
    }
    const season = /^(DJF|MAM|JJA|SON|ANN)-TMIN-NORMAL$/.exec(key);
    if (season) {
      const v = num(raw);
      if (v !== undefined) out.tminF[season[1] as keyof StationNormals['tminF']] = v;
    }
  }
  return out;
}

/** The element list to request, keeping responses small (only what the frost engine uses). */
export function normalsDataTypes(): string[] {
  const types: string[] = [];
  for (const kind of ['PRBLST', 'PRBFST', 'PRBGSL'])
    for (const t of [32, 28])
      for (const p of [10, 50, 90]) types.push(`ANN-TMIN-${kind}-T${t}FP${p}`);
  types.push('DJF-TMIN-NORMAL', 'MAM-TMIN-NORMAL', 'JJA-TMIN-NORMAL', 'SON-TMIN-NORMAL', 'ANN-TMIN-NORMAL');
  types.push('ANN-GRDD-BASE50', 'ANN-PRCP-NORMAL');
  return types;
}

/** Station publishes median 32 °F spring and fall freeze dates. (Elevation is checked separately.) */
export function hasFreezeData(s: StationNormals): boolean {
  return s.lastSpring[32]?.[50] !== undefined && s.firstFall[32]?.[50] !== undefined;
}

/** Station reports temperature normals at all (precipitation-only stations don't). */
export function hasTemperatureData(s: StationNormals): boolean {
  return Object.values(s.tminF).some((v) => v !== undefined);
}
