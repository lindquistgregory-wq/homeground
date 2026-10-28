/** Unit conversions. Internally everything is SI (metres, °C, m², mm). Display converts at the edge. */

export type UnitSystem = 'imperial' | 'metric';

export const M_PER_FT = 0.3048;
export const M2_PER_ACRE = 4046.8564224;
export const M2_PER_HECTARE = 10_000;
export const MM_PER_IN = 25.4;

export const mToFt = (m: number): number => m / M_PER_FT;
export const ftToM = (ft: number): number => ft * M_PER_FT;
export const m2ToAcres = (m2: number): number => m2 / M2_PER_ACRE;
export const acresToM2 = (ac: number): number => ac * M2_PER_ACRE;
export const m2ToHectares = (m2: number): number => m2 / M2_PER_HECTARE;
export const m2ToFt2 = (m2: number): number => m2 / (M_PER_FT * M_PER_FT);
export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const fToC = (f: number): number => ((f - 32) * 5) / 9;
/** Convert a temperature *difference* (not an absolute temperature). */
export const deltaCToF = (dc: number): number => (dc * 9) / 5;
export const deltaFToC = (df: number): number => (df * 5) / 9;
export const inToMm = (i: number): number => i * MM_PER_IN;
export const mmToIn = (mm: number): number => mm / MM_PER_IN;

function round(n: number, digits: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatLength(m: number, system: UnitSystem): string {
  if (system === 'metric') return m >= 1000 ? `${round(m / 1000, 2)} km` : `${round(m, 1)} m`;
  const ft = mToFt(m);
  return ft >= 5280 ? `${round(ft / 5280, 2)} mi` : `${round(ft, 0)} ft`;
}

export function formatArea(m2: number, system: UnitSystem): string {
  if (system === 'metric') return m2 >= M2_PER_HECTARE ? `${round(m2ToHectares(m2), 2)} ha` : `${round(m2, 0)} m²`;
  const acres = m2ToAcres(m2);
  return acres >= 0.25 ? `${round(acres, 2)} ac` : `${round(m2ToFt2(m2), 0)} ft²`;
}

export function formatTemp(c: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(c, 1)} °C` : `${round(cToF(c), 0)} °F`;
}

export function formatElevation(m: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(m, 0)} m` : `${round(mToFt(m), 0)} ft`;
}

// Figures sourced in US units (animal needs, germination, yields) shown in the user's units.
export const LITRES_PER_GALLON = 3.785411784;
export const KG_PER_LB = 0.45359237;

/** A °F figure (e.g. "85 °F" or "29 °C"). */
export function formatTempF(f: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(fToC(f), 0)} °C` : `${round(f, 0)} °F`;
}
/** A °F difference (e.g. a sensor running 4 °F colder: "4 °F" or "2 °C"). */
export function formatTempDeltaF(df: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(deltaFToC(df), 0)} °C` : `${round(df, 0)} °F`;
}
/** A small area sourced in sq ft (shelter space per animal). */
export function formatSqFt(ft2: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(ft2 * M_PER_FT * M_PER_FT, 1)} m²` : `${round(ft2, 0)} sq ft`;
}
/** Land sourced in acres (pasture per head). */
export function formatAcres(ac: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(m2ToHectares(acresToM2(ac)), 2)} ha` : `${round(ac, 2)} acre${ac === 1 ? '' : 's'}`;
}
export function formatWind(mph: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(mph * 1.609344, 0)} km/h` : `${round(mph, 0)} mph`;
}
export function formatGallons(gal: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(gal * LITRES_PER_GALLON, 0)} L` : `${round(gal, 0)} gal`;
}
export function formatPounds(lb: number, system: UnitSystem): string {
  return system === 'metric' ? `${round(lb * KG_PER_LB, 0)} kg` : `${round(lb, 0)} lb`;
}
/** A [low, high] range through one of the formatters: "3–5 gal" (one unit at the end). */
export function formatRangeIn(r: readonly [number, number], fmt: (n: number) => string): string {
  if (r[0] === r[1]) return fmt(r[0]);
  const lo = fmt(r[0]), hi = fmt(r[1]);
  const unit = hi.replace(/^[\d.,\s−-]+/, '');
  return `${lo.replace(unit, '').trim()}–${hi}`;
}
/** Growing degree days counted on a °F base, in the user's units (°C-days are 5/9 as many). */
export function formatGdd(gddF: number, system: UnitSystem): string {
  return system === 'metric' ? `${round((gddF * 5) / 9, 0)} GDD (base 10 °C)` : `${round(gddF, 0)} GDD (base 50 °F)`;
}
