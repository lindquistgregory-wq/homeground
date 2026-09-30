/**
 * Agro-meteorology from sensor and station data (§4, §8): dew point, vapour-pressure deficit,
 * leaf-wetness hours, FAO-56 reference evapotranspiration, and a simple irrigation balance.
 * All inputs and outputs are SI (°C, %, m/s, MJ/m²/day, mm).
 */

/** Saturation vapour pressure (kPa) at T °C, FAO-56 eq. 11. */
export const svpKpa = (tC: number): number => 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));

/** Dew point (°C) from temperature and RH, Magnus formula (Alduchov & Eskridge 1996 constants). */
export function dewPointC(tC: number, rhPct: number): number {
  const a = 17.625, b = 243.04;
  const g = Math.log(Math.max(rhPct, 0.1) / 100) + (a * tC) / (b + tC);
  return (b * g) / (a - g);
}

/** Vapour-pressure deficit (kPa). Plants like roughly 0.4–1.6 kPa; low VPD with warmth favours fungal disease. */
export const vpdKpa = (tC: number, rhPct: number): number => svpKpa(tC) * (1 - Math.min(100, Math.max(0, rhPct)) / 100);

/**
 * Hours of likely leaf wetness from RH samples (a common proxy: RH ≥ 90 %). Samples are
 * [utcMs, rh]; each sample counts for the time until the next one, capped at `maxGapMs`.
 */
export function leafWetHours(samples: Array<[number, number]>, thresholdPct = 90, maxGapMs = 3_600_000): number {
  const s = [...samples].sort((a, b) => a[0] - b[0]);
  let ms = 0;
  for (let i = 0; i < s.length - 1; i++) if (s[i]![1] >= thresholdPct) ms += Math.min(maxGapMs, s[i + 1]![0] - s[i]![0]);
  return ms / 3_600_000;
}

// ---------------- FAO-56 reference evapotranspiration ----------------

const RAD = Math.PI / 180;

/** Extraterrestrial radiation Ra (MJ/m²/day), FAO-56 eq. 21. */
export function extraterrestrialRadiation(latDeg: number, doy: number): number {
  const phi = latDeg * RAD;
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * doy);
  const decl = 0.409 * Math.sin(((2 * Math.PI) / 365) * doy - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl))));
  return ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
}

/** Wind speed at 2 m from a measurement at height z (m), FAO-56 eq. 47. */
export const windAt2m = (uz: number, zM: number): number => (zM === 2 ? uz : (uz * 4.87) / Math.log(67.8 * zM - 5.42));

export interface DailyWeather {
  latDeg: number;
  elevationM: number;
  doy: number;
  tmaxC: number;
  tminC: number;
  rhMaxPct?: number;
  rhMinPct?: number;
  rhMeanPct?: number;
  tdewC?: number;
  /** Mean wind speed (m/s) measured at `windHeightM` (default 2 m; a roof-top station is often ~10 m). */
  windMs?: number;
  windHeightM?: number;
  /** Measured solar radiation, MJ/m²/day (a station's W/m² mean × 0.0864). */
  solarMJ?: number;
  /** Near a large water body (Hargreaves radiation coefficient 0.19 instead of 0.16). */
  coastal?: boolean;
}

export interface Et0Result {
  et0Mm: number;
  /** What was measured vs estimated, for the "how was this computed" note. */
  estimated: Array<'humidity' | 'wind' | 'radiation'>;
}

/** FAO-56 Penman–Monteith daily reference ET (mm/day), estimating missing inputs the FAO-56 way. */
export function et0PenmanMonteith(d: DailyWeather): Et0Result {
  const estimated: Et0Result['estimated'] = [];
  const tmean = (d.tmaxC + d.tminC) / 2;
  const P = 101.3 * ((293 - 0.0065 * d.elevationM) / 293) ** 5.26;
  const gamma = 0.000665 * P;
  const delta = (4098 * svpKpa(tmean)) / (tmean + 237.3) ** 2;
  const es = (svpKpa(d.tmaxC) + svpKpa(d.tminC)) / 2;
  let ea: number;
  if (d.tdewC !== undefined) ea = svpKpa(d.tdewC);
  else if (d.rhMaxPct !== undefined && d.rhMinPct !== undefined) ea = (svpKpa(d.tminC) * d.rhMaxPct / 100 + svpKpa(d.tmaxC) * d.rhMinPct / 100) / 2;
  else if (d.rhMeanPct !== undefined) ea = (d.rhMeanPct / 100) * es;
  else {
    ea = svpKpa(d.tminC); // FAO-56: dew point ≈ Tmin where humidity is missing
    estimated.push('humidity');
  }
  let u2: number;
  if (d.windMs !== undefined) u2 = windAt2m(d.windMs, d.windHeightM ?? 2);
  else {
    u2 = 2; // FAO-56 recommends 2 m/s where wind data are missing
    estimated.push('wind');
  }
  const Ra = extraterrestrialRadiation(d.latDeg, d.doy);
  let Rs: number;
  if (d.solarMJ !== undefined) Rs = d.solarMJ;
  else {
    Rs = (d.coastal ? 0.19 : 0.16) * Math.sqrt(Math.max(0, d.tmaxC - d.tminC)) * Ra; // Hargreaves radiation, eq. 50
    estimated.push('radiation');
  }
  const Rso = (0.75 + 2e-5 * d.elevationM) * Ra;
  const Rns = 0.77 * Rs;
  const sigma = 4.903e-9;
  const tk4 = ((d.tmaxC + 273.16) ** 4 + (d.tminC + 273.16) ** 4) / 2;
  const Rnl = sigma * tk4 * (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * Math.min(1, Rs / Math.max(Rso, 1e-6)) - 0.35);
  const Rn = Rns - Rnl;
  const et0 = (0.408 * delta * Rn + gamma * (900 / (tmean + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2));
  return { et0Mm: Math.max(0, et0), estimated };
}

/** Hargreaves ET0 (mm/day), FAO-56 eq. 52: temperature-only fallback. */
export function et0Hargreaves(latDeg: number, doy: number, tmaxC: number, tminC: number): number {
  const Ra = extraterrestrialRadiation(latDeg, doy) * 0.408;
  return Math.max(0, 0.0023 * ((tmaxC + tminC) / 2 + 17.8) * Math.sqrt(Math.max(0, tmaxC - tminC)) * Ra);
}

// ---------------- Irrigation ----------------

/** Volumetric water content (%) below which to water, by soil texture: roughly half of plant-available water used. */
export const REFILL_VWC_PCT: Record<'sandy' | 'loamy' | 'clayey', number> = { sandy: 12, loamy: 22, clayey: 30 };

export interface WaterBalance {
  /** Crop water use over the period (Kc × ET0), mm. */
  cropUseMm: number;
  /** Rain that counts (small showers mostly evaporate), mm. */
  effectiveRainMm: number;
  /** Suggested irrigation, mm (≥ 0). */
  needMm: number;
  message: string;
}

/**
 * Simple checkbook water balance over recent days (FAO-56 single crop coefficient). `kc` ≈ 0.7 for
 * young plants, 1.0–1.15 for full-canopy vegetables mid-season. A soil-moisture reading, when
 * available, overrides the estimate: below the refill point means water now, above means wait.
 */
export function waterBalance(days: Array<{ et0Mm: number; rainMm: number }>, kc = 1.0, soil?: { vwcPct?: number; texture?: 'sandy' | 'loamy' | 'clayey' }): WaterBalance {
  const cropUseMm = days.reduce((s, d) => s + kc * d.et0Mm, 0);
  // Showers under ~2 mm wet the surface and evaporate; larger rain counts at ~80 %.
  const effectiveRainMm = days.reduce((s, d) => s + (d.rainMm >= 2 ? 0.8 * d.rainMm : 0), 0);
  let needMm = Math.max(0, cropUseMm - effectiveRainMm);
  let message: string;
  if (soil?.vwcPct !== undefined) {
    const refill = REFILL_VWC_PCT[soil.texture ?? 'loamy'];
    if (soil.vwcPct < refill) message = `Soil moisture ${Math.round(soil.vwcPct)} % is below the ~${refill} % refill point: water now.`;
    else {
      message = `Soil moisture ${Math.round(soil.vwcPct)} % is above the ~${refill} % refill point: no need to water yet.`;
      needMm = 0;
    }
  } else if (needMm < 5) message = 'Rain has kept up with what the plants used.';
  else message = `Plants used about ${Math.round(cropUseMm)} mm and rain supplied about ${Math.round(effectiveRainMm)} mm: water about ${Math.round(needMm)} mm.`;
  return { cropUseMm, effectiveRainMm, needMm, message };
}

// ---------------- Degree days ----------------

/** Growing degree days (°F·days) from daily min/max in °C, same averaging method as the calendar (max capped, min raised to base). */
export function gddFromDailyC(days: Array<{ tminC: number; tmaxC: number }>, baseF = 50, capF = 86): number {
  let s = 0;
  for (const d of days) {
    const hi = Math.min((d.tmaxC * 9) / 5 + 32, capF);
    const lo = Math.max((d.tminC * 9) / 5 + 32, baseF);
    s += Math.max(0, (hi + lo) / 2 - baseF);
  }
  return s;
}
