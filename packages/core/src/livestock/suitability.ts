/**
 * Explainable animal × property fit (prompt §4), the counterpart of plants/suitability.ts: each
 * factor gives a 0–1 score, a weight and a plain-language reason; hard fails cap the verdict.
 * Zoning and noise are flags, never blockers: the app can't know local code.
 */
import { zoneNumber } from '../plants/suitability';
import { heatStress, minimumGroup, pastureAcres, thi, fallbackHumidity } from './safetyDefaults';
import type { AnimalSpec } from './types';

export type AnimalFactorKey = 'heat' | 'cold' | 'land' | 'housing' | 'social' | 'wetGround' | 'shade' | 'labor';

export interface AnimalFactor {
  key: AnimalFactorKey;
  label: string;
  score: number;
  weight: number;
  status: 'good' | 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface AnimalSuitability {
  animalId: string;
  score: number;
  verdict: 'great' | 'good' | 'fair' | 'poor' | 'not-suitable';
  factors: AnimalFactor[];
  hardFails: string[];
  /** Always-on reminders (zoning, noise): shown, never scored. */
  flags: string[];
  summary: string;
}

export interface AnimalSite {
  zone?: string;
  peakSummerMaxF?: number;
  summerRhPct?: number;
  parcelAcres?: number;
  /** Cold-air pooling at the housing spot (m below surroundings); > ~1 m is a low, wet frost pocket. */
  coldPoolingM?: number;
  inFloodZone?: boolean;
  /** Owner's available hours per week (planner goal), when known. */
  hoursPerWeek?: number;
}

export interface HousingFit {
  name: string;
  fits: number;
  planned: number;
  /** Summer sun-hours on the housing, from the shade engine. */
  summerSunHours?: number;
}

export const ANIMAL_WEIGHTS: Record<AnimalFactorKey, number> = { heat: 3, cold: 2, land: 3, housing: 3, social: 2, wetGround: 1, shade: 1, labor: 1 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const statusOf = (s: number): AnimalFactor['status'] => (s >= 0.85 ? 'good' : s >= 0.6 ? 'ok' : s > 0 ? 'warn' : 'fail');

/** USDA zone → average extreme minimum, °F (zone 1a starts at −60 °F; each half-zone is 5 °F). */
export function zoneMinF(zone: string | undefined): number | undefined {
  const n = zone ? zoneNumber(zone) : undefined;
  return n === undefined ? undefined : -60 + (n - 1) * 10;
}

export function scoreAnimal(a: AnimalSpec, site: AnimalSite, housing?: HousingFit, count?: number): AnimalSuitability {
  const factors: AnimalFactor[] = [];
  const hardFails: string[] = [];
  const add = (key: AnimalFactorKey, label: string, score: number, detail: string) =>
    factors.push({ key, label, score: clamp01(score), weight: ANIMAL_WEIGHTS[key], status: statusOf(clamp01(score)), detail });
  const n = count ?? housing?.planned ?? a.starterGroupSize?.[0] ?? minimumGroup(a);

  // Heat: how far summer highs go past the sourced onset.
  if (site.peakSummerMaxF !== undefined && (a.heat.airOnsetF !== undefined || a.heat.thiOnset !== undefined)) {
    const s = heatStress(a, site.peakSummerMaxF, undefined, site.summerRhPct);
    const over = a.heat.airOnsetF !== undefined
      ? site.peakSummerMaxF - a.heat.airOnsetF
      : thi(site.peakSummerMaxF, fallbackHumidity(site.summerRhPct)) - a.heat.thiOnset!;
    add('heat', 'Summer heat', s.stressed ? 1 - over / 20 : 1,
      s.stressed ? `Summer highs reach about ${Math.round(site.peakSummerMaxF)} °F (${s.basis}): plan shade, water and air flow.` : `Summer highs (about ${Math.round(site.peakSummerMaxF)} °F) stay under the heat-stress threshold.`);
  } else if (site.peakSummerMaxF !== undefined) {
    add('heat', 'Summer heat', a.heat.tolerance === 'low' ? 0.7 : 0.85, `No sourced heat threshold for ${a.commonName.toLowerCase()}; ${a.heat.tolerance === 'low' ? 'it handles heat poorly, so plan shade' : 'provide shade and water'}.`);
  }

  // Cold: the zone's average extreme minimum against the sourced safe minimum or tolerance.
  const minF = zoneMinF(site.zone);
  if (minF !== undefined) {
    if (a.cold.safeMinF !== undefined) add('cold', 'Winter cold', minF >= a.cold.safeMinF ? 1 : 0.4, `Winters reach about ${minF} °F; shelter keeps it above ${a.cold.safeMinF} °F.`);
    else {
      const tol = a.cold.tolerance;
      const score = minF >= 0 ? 1 : tol === 'high' ? 0.95 : tol === 'medium' ? 0.8 : 0.55;
      add('cold', 'Winter cold', score, `Winters reach about ${minF} °F (zone ${site.zone}). ${tol === 'low' ? 'It needs good shelter in hard cold.' : 'Shelter from wind and wet; keep water from freezing.'}`);
    }
  }

  // Land: pasture species need enough acres for the group.
  const acresEach = pastureAcres(a);
  if (acresEach !== undefined && site.parcelAcres !== undefined) {
    const need = acresEach * n;
    const ratio = site.parcelAcres / need;
    if (ratio < 1) hardFails.push(`${n} need about ${need.toFixed(2)} acres of pasture; the parcel is ${site.parcelAcres.toFixed(2)} acres.`);
    add('land', 'Pasture', ratio >= 2 ? 1 : ratio >= 1 ? 0.75 : 0, `${n} need about ${need.toFixed(2)} acres (${acresEach} acre each, the larger cited figure); the parcel is ${site.parcelAcres.toFixed(2)} acres.`);
  }

  // Housing capacity (welfare: overcrowding is never "fine").
  if (housing) {
    const ok = housing.planned <= housing.fits;
    if (!ok) hardFails.push(`${housing.name} fits ${housing.fits}; ${housing.planned} are planned.`);
    add('housing', 'Housing space', ok ? 1 : 0, ok ? `${housing.name} fits ${housing.fits}; ${housing.planned} planned.` : `${housing.name} fits ${housing.fits} at the sourced space per animal; ${housing.planned} are planned.`);
    if (a.shadeNeeded && housing.summerSunHours !== undefined)
      add('shade', 'Summer shade', housing.summerSunHours <= 9 ? 1 : 0.6, housing.summerSunHours <= 9 ? 'The spot gets some summer shade.' : `About ${housing.summerSunHours.toFixed(1)} h of summer sun: add shade.`);
  }

  // Social: never plan a social species alone.
  const group = minimumGroup(a);
  if (n < group) hardFails.push(`${a.commonName} shouldn’t be kept alone: plan at least ${group}.`);
  add('social', 'Company', n >= group ? 1 : 0, n >= group ? (a.socialNote ?? 'Group size is fine.') : `Plan at least ${group}. ${a.socialNote ?? ''}`.trim());

  if ((site.coldPoolingM !== undefined && site.coldPoolingM > 1) || site.inFloodZone)
    add('wetGround', 'Dry ground', 0.5, site.inFloodZone ? 'The parcel is in a mapped flood zone: keep housing on high ground.' : 'This spot is a low pocket that collects cold, wet air: pick higher ground for housing.');

  if (site.hoursPerWeek !== undefined && a.laborHoursPerWeek)
    add('labor', 'Your time', a.laborHoursPerWeek[0] <= site.hoursPerWeek ? 1 : 0.4, `About ${a.laborHoursPerWeek[0]}–${a.laborHoursPerWeek[1]} h a week (extension budgets) against your ${site.hoursPerWeek} h.`);

  const wsum = factors.reduce((s, f) => s + f.weight, 0) || 1;
  let score = (factors.reduce((s, f) => s + f.score * f.weight, 0) / wsum) * 100;
  if (hardFails.length) score = Math.min(score, 40);
  const verdict: AnimalSuitability['verdict'] = hardFails.length ? 'not-suitable' : score >= 85 ? 'great' : score >= 70 ? 'good' : score >= 55 ? 'fair' : 'poor';
  const flags = ['Check local zoning, HOA and lease rules first.', ...(a.noise === 'high' ? [`${a.commonName} can be loud: consider neighbours.`] : [])];
  const concerns = [...hardFails, ...factors.filter((f) => f.status === 'warn' || f.status === 'fail').map((f) => f.detail)];
  const summary = `${a.commonName}: ${verdict.replace('-', ' ')} (${Math.round(score)}/100).${concerns.length ? ' ' + concerns.slice(0, 2).join(' ') : ''}`;
  return { animalId: a.id, score: Math.round(score), verdict, factors, hardFails, flags, summary };
}

export function rankAnimals(list: AnimalSpec[], site: AnimalSite, housing?: (a: AnimalSpec) => HousingFit | undefined): AnimalSuitability[] {
  return list.map((a) => scoreAnimal(a, site, housing?.(a))).sort((x, y) => y.score - x.score);
}
