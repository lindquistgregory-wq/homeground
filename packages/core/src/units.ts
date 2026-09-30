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
