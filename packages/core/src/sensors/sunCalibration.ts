/**
 * Measured vs modeled sun (§5.8, §8): a light sensor on the parcel tells direct sun from shade by
 * comparing its lux with what a clear sky would give at that solar elevation. Only clear days are
 * used (judged independently, e.g. from NASA POWER's all-sky/clear-sky ratio or an on-site
 * pyranometer), because on a cloudy day everything looks like shade.
 */
import { solarPosition } from '../sun/spa';

/** Clear-sky global horizontal irradiance (W/m²), Haurwitz model. */
export function clearSkyGhi(elevationDeg: number): number {
  if (elevationDeg <= 0) return 0;
  const s = Math.sin((elevationDeg * Math.PI) / 180);
  return 1098 * s * Math.exp(-0.057 / s);
}

/** Daylight luminous efficacy, lm/W, for converting irradiance to illuminance (≈ 100–120 in sunlight). */
export const LUX_PER_WM2 = 110;

export type SunState = 'sun' | 'shade' | 'unsure';

/**
 * Sun or shade from one light reading. A horizontal sensor in direct sun reads about the clear-sky
 * value; in shade it sees only diffuse sky light (~10–25 %). Low sun (< 8°) is too ambiguous to call.
 */
export function classifyLux(lux: number, elevationDeg: number): SunState {
  if (elevationDeg < 8) return 'unsure';
  const r = lux / (clearSkyGhi(elevationDeg) * LUX_PER_WM2);
  return r >= 0.55 ? 'sun' : r <= 0.35 ? 'shade' : 'unsure';
}

export interface SunComparisonDay {
  date: string;
  /** Hours the sensor saw direct sun (from sampled slots). */
  measuredHours: number;
  /** Hours the shade model says the sensor's spot is in sun, over the same slots. */
  modeledHours: number;
  /** Share of slots where sensor and model agree (unsure slots excluded). */
  agreement: number;
  slots: number;
}

export interface SunCalibration {
  days: SunComparisonDay[];
  /** Measured ÷ modeled sun-hours across clear days (1 = model right; < 1 = more shade than modeled). */
  ratio: number | null;
  agreement: number | null;
  /** Clear days used. At least 3 are needed before `ratio` is used to adjust a bed. */
  clearDays: number;
}

/**
 * Compare a light sensor with the model on clear days. `samples` are [utcMs, lux]; `modeledSun`
 * answers whether the model has that spot in sun at a time; `isClearDay` takes a local date.
 * Each sample stands for the interval to the next (max 30 min).
 */
export function compareSun(
  samples: Array<[number, number]>,
  lat: number,
  lon: number,
  modeledSun: (t: Date) => boolean | null,
  isClearDay: (date: string) => boolean,
  dateOf: (t: number) => string,
): SunCalibration {
  const s = [...samples].sort((a, b) => a[0] - b[0]);
  const byDay = new Map<string, SunComparisonDay>();
  for (let i = 0; i < s.length - 1; i++) {
    const [t, lux] = s[i]!;
    const dt = Math.min(s[i + 1]![0] - t, 30 * 60_000) / 3_600_000;
    const date = dateOf(t);
    if (!isClearDay(date) || dt <= 0) continue;
    const when = new Date(t);
    const pos = solarPosition(when, lat, lon);
    const state = classifyLux(lux, pos.elevation);
    const model = pos.elevation > 0 ? modeledSun(when) : false;
    if (state === 'unsure' || model === null) continue;
    const d = byDay.get(date) ?? { date, measuredHours: 0, modeledHours: 0, agreement: 0, slots: 0 };
    byDay.set(date, d);
    if (state === 'sun') d.measuredHours += dt;
    if (model) d.modeledHours += dt;
    d.agreement += (state === 'sun') === model ? 1 : 0;
    d.slots++;
  }
  const days = [...byDay.values()].filter((d) => d.slots >= 6).map((d) => ({ ...d, agreement: d.agreement / d.slots }));
  const meas = days.reduce((x, d) => x + d.measuredHours, 0), mod = days.reduce((x, d) => x + d.modeledHours, 0);
  const slots = days.reduce((x, d) => x + d.slots, 0);
  return {
    days,
    ratio: days.length && mod > 0 ? meas / mod : null,
    agreement: slots ? days.reduce((x, d) => x + d.agreement * d.slots, 0) / slots : null,
    clearDays: days.length,
  };
}

/** Apply a calibration to a modeled sun-hours value, only with enough clear days and within sane limits. */
export function calibratedSunHours(modeled: number, cal: SunCalibration | null, minDays = 3): { hours: number; calibrated: boolean } {
  if (!cal || cal.ratio === null || cal.clearDays < minDays) return { hours: modeled, calibrated: false };
  return { hours: modeled * Math.max(0.3, Math.min(1.5, cal.ratio)), calibrated: true };
}
