/**
 * Explainable plant × bed suitability (§7.2). Each factor gives a 0–1 score, a weight and a
 * plain-language reason. Hard fails (e.g. a perennial that can't survive the winter, or an annual
 * that can't mature before frost) cap the result, whatever the other factors say.
 * Weights are exported so they can be tuned (and are covered by tests).
 */
import type { FrostDates } from '../climate/frost';
import { gddBetween, type ClimateCurves } from './seasonModel';
import type { PlantSpec } from './types';

export interface BedConditions {
  /** Average direct-sun hours per day over the growing season, from the shade engine. */
  sunHours?: number;
  soil?: { pH?: number; drainageClass?: string; texture?: string; awsCm?: number; hydricPct?: number };
  /** Raised bed, container or amended bed: drainage and texture are what you put in it. */
  raised?: boolean;
  slopeDeg?: number;
  /** Aspect, degrees clockwise from north, of the downhill direction. */
  aspectDeg?: number;
  /** Cold-air pooling index (metres below surroundings); > ~1 m means a frost pocket. */
  coldPoolingM?: number;
}

export interface SiteConditions {
  /** USDA zone like "6b". */
  zone?: string;
  frost?: FrostDates;
  curves?: ClimateCurves;
  chillHours?: number;
  peakSummerMaxF?: number;
  /** Mean relative humidity in the warm months (%), for disease pressure. */
  summerRhPct?: number;
}

export type FactorKey = 'hardiness' | 'season' | 'heatUnits' | 'sun' | 'soilPh' | 'drainage' | 'texture' | 'chill' | 'heat' | 'disease' | 'frostPocket' | 'water';

export interface Factor {
  key: FactorKey;
  label: string;
  score: number; // 0..1
  weight: number;
  status: 'good' | 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface Suitability {
  plantId: string;
  score: number; // 0..100
  verdict: 'great' | 'good' | 'fair' | 'poor' | 'not-suitable';
  factors: Factor[];
  hardFails: string[];
  /** One-line summary, e.g. "Tomato in Bed 3: 5.2 sun-hours vs 6–8 needed…". */
  summary: string;
}

export const DEFAULT_WEIGHTS: Record<FactorKey, number> = {
  hardiness: 3, season: 3, heatUnits: 2, sun: 3, soilPh: 1, drainage: 1.5, texture: 0.5, chill: 2.5, heat: 1, disease: 1, frostPocket: 1, water: 0.5,
};

export function zoneNumber(zone: string): number | undefined {
  const m = /^(\d{1,2})([ab])?$/.exec(zone.trim());
  return m ? Number(m[1]) + (m[2] === 'b' ? 0.5 : 0) : undefined;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const statusOf = (s: number): Factor['status'] => (s >= 0.85 ? 'good' : s >= 0.6 ? 'ok' : s > 0 ? 'warn' : 'fail');

export function scorePlant(
  plant: PlantSpec,
  site: SiteConditions,
  bed: BedConditions = {},
  weights: Record<FactorKey, number> = DEFAULT_WEIGHTS,
  bedName = 'this spot',
): Suitability {
  const factors: Factor[] = [];
  const hardFails: string[] = [];
  const add = (key: FactorKey, label: string, score: number, detail: string, hard = false) => {
    const f: Factor = { key, label, score: clamp01(score), weight: weights[key], status: statusOf(clamp01(score)), detail };
    factors.push(f);
    if (hard && score <= 0) hardFails.push(detail);
  };

  // --- Winter survival (perennials) ---
  const z = site.zone ? zoneNumber(site.zone) : undefined;
  if (plant.zones && z !== undefined) {
    const [lo, hi] = plant.zones;
    if (z < lo) add('hardiness', 'Winter hardiness', 0, `Zone ${site.zone} is colder than ${plant.commonName} tolerates (zones ${lo}–${hi}).`, true);
    else if (z >= hi + 1) add('hardiness', 'Winter hardiness', 0.5, `Zone ${site.zone} is warmer than its usual range (zones ${lo}–${hi}); expect weak dormancy or heat stress.`);
    else add('hardiness', 'Winter hardiness', 1, `Hardy in zone ${site.zone} (zones ${lo}–${hi}).`);
  }

  // --- Season length (annual crops) ---
  const fr = site.frost;
  const dtm = plant.daysToMaturity;
  if (fr && dtm && plant.lifecycle !== 'perennial' && !fr.freezeRare) {
    const tender = plant.frost === 'tender';
    const start = tender ? fr.lastSpring[32][50] : fr.lastSpring[28][50];
    const end = tender ? fr.firstFall[32][50] : fr.firstFall[28][50];
    if (start !== null && end !== null) {
      // Tender crops go out ~2 weeks after the last frost; transplant crops count days from transplanting.
      const available = end - start - (tender ? 14 : 0);
      const need = dtm[0];
      const margin = available - need;
      if (margin < 0) add('season', 'Season length', 0, `About ${Math.max(0, available)} usable frost-free days; ${plant.commonName} needs at least ${need}.`, true);
      else add('season', 'Season length', clamp01(0.6 + margin / 60), `${available} usable frost-free days for a ${dtm[0]}–${dtm[1]}-day crop.`);
    }
  }

  // --- Heat units ---
  if (plant.gddToMaturity && site.curves && fr) {
    const s = fr.lastSpring[32][50], e = fr.firstFall[32][50];
    if (s !== null && e !== null) {
      const have = gddBetween(site.curves, s, e, plant.gddBaseF ?? 50);
      const r = have / plant.gddToMaturity;
      add('heatUnits', 'Summer heat', r >= 1.1 ? 1 : r >= 1 ? 0.8 : r >= 0.85 ? 0.4 : 0,
        `${Math.round(have)} heat units between frosts vs ${plant.gddToMaturity} needed (base ${plant.gddBaseF ?? 50} °F).`, r < 0.85);
    }
  }

  // --- Sun ---
  if (bed.sunHours !== undefined) {
    const { min, ideal } = plant.sunHours;
    const h = bed.sunHours;
    const score = h >= ideal ? 1 : h >= min ? 0.65 + (0.35 * (h - min)) / Math.max(0.1, ideal - min) : h >= min * 0.6 ? 0.3 : 0.05;
    const detail = h >= ideal
      ? `${h.toFixed(1)} sun-hours in ${bedName} meets the ${ideal}+ it wants.`
      : h >= min
        ? `${h.toFixed(1)} sun-hours in ${bedName} vs ${min}–${ideal} ideal: it will grow, with somewhat lower yield.`
        : `${h.toFixed(1)} sun-hours in ${bedName} vs ${min}–${ideal} needed: expect a poor crop.`;
    add('sun', 'Sunlight', score, detail);
  }

  // --- Soil ---
  const pH = bed.soil?.pH;
  if (pH !== undefined) {
    const [lo, hi] = plant.soil.pH;
    const off = pH < lo ? lo - pH : pH > hi ? pH - hi : 0;
    add('soilPh', 'Soil pH', off === 0 ? 1 : off <= 0.5 ? 0.6 : 0.25,
      off === 0 ? `Soil pH ${pH.toFixed(1)} is within ${lo}–${hi}.` : `Soil pH ${pH.toFixed(1)} vs ${lo}–${hi} preferred: ${pH < lo ? 'lime' : 'sulfur'} can correct it (get a soil test first).`);
  }
  if (bed.raised) {
    add('drainage', 'Drainage', 1, 'Raised bed: drainage depends on the fill, not the native soil.');
  } else if (bed.soil?.drainageClass) {
    const dc = bed.soil.drainageClass.toLowerCase();
    const wet = /very poorly|poorly/.test(dc) && !/somewhat poorly/.test(dc);
    const damp = /somewhat poorly/.test(dc);
    const want = plant.soil.drainage;
    const score = want === 'tolerates-wet' ? 1 : wet ? (want === 'moist' ? 0.5 : 0.15) : damp ? (want === 'moist' ? 0.9 : 0.55) : /excessively/.test(dc) && want === 'moist' ? 0.6 : 1;
    add('drainage', 'Drainage', score, score >= 0.85 ? `${bed.soil.drainageClass} soil suits it.` : `${bed.soil.drainageClass} soil; ${plant.commonName} wants ${want.replace('-', ' ')} ground. A raised bed fixes this.`);
  }
  if (!bed.raised && bed.soil?.texture && plant.soil.textures) {
    const t = bed.soil.texture.toLowerCase();
    const cls = /sand/.test(t) ? 'sandy' : /clay/.test(t) ? 'clayey' : 'loamy';
    const ok = plant.soil.textures.includes(cls as 'sandy');
    add('texture', 'Soil texture', ok ? 1 : 0.6, ok ? `${bed.soil.texture} suits it.` : `${bed.soil.texture} is not ideal (prefers ${plant.soil.textures.join(' or ')}); add compost.`);
  }

  // --- Winter chill (fruit) ---
  if (plant.chillHours && site.chillHours !== undefined) {
    const [lo, hi] = plant.chillHours;
    const c = site.chillHours;
    const score = c >= lo ? (c > hi * 1.8 ? 0.8 : 1) : c >= lo * 0.8 ? 0.5 : 0;
    add('chill', 'Winter chill', score,
      c >= lo ? `About ${Math.round(c)} chill hours here; varieties need ${lo}–${hi}. Pick one matched to your winters.`
        : `Only about ${Math.round(c)} chill hours here vs ${lo}+ needed: it may not flower or fruit well. Look for low-chill varieties.`, score === 0);
  }

  // --- Summer heat stress ---
  if (site.peakSummerMaxF !== undefined) {
    const t = site.peakSummerMaxF;
    const limit = plant.heat === 'low' ? 82 : plant.heat === 'medium' ? 90 : 97;
    const score = t <= limit ? 1 : t <= limit + 6 ? 0.6 : 0.3;
    add('heat', 'Summer heat', score, score === 1 ? `Normal summer highs (~${Math.round(t)} °F) suit it.`
      : plant.season === 'cool' ? `Summer highs reach ~${Math.round(t)} °F: grow it in spring and fall, not midsummer (it bolts or turns bitter).`
        : `Summer highs reach ~${Math.round(t)} °F: afternoon shade and mulch help.`);
  }

  // --- Humidity-driven disease ---
  if (site.summerRhPct !== undefined && plant.humidityDisease !== 'low') {
    const humid = site.summerRhPct >= 75;
    const score = !humid ? 1 : plant.humidityDisease === 'high' ? 0.55 : 0.8;
    add('disease', 'Disease pressure', score, humid
      ? `Humid summers (~${Math.round(site.summerRhPct)} % RH) favour ${plant.diseases.slice(0, 2).join(' and ')}: space plants, water the soil not the leaves, choose resistant varieties.`
      : `Summer humidity (~${Math.round(site.summerRhPct)} % RH) is moderate.`);
  }

  // --- Frost pockets (early-blooming fruit, tender crops) ---
  if (bed.coldPoolingM !== undefined && bed.coldPoolingM > 1) {
    const sensitive = plant.kind === 'fruit-tree' || plant.kind === 'berry' || plant.frost === 'tender';
    if (sensitive)
      add('frostPocket', 'Frost pocket', bed.coldPoolingM > 3 ? 0.3 : 0.6,
        `This spot sits ~${bed.coldPoolingM.toFixed(1)} m below its surroundings, where cold air pools on still nights: later spring frosts and earlier fall frosts than the parcel average.`);
  }

  // --- Water holding ---
  if (!bed.raised && plant.water === 'high' && bed.soil?.awsCm !== undefined && bed.soil.awsCm < 10) {
    add('water', 'Water supply', 0.6, `Soil holds little water (~${bed.soil.awsCm.toFixed(0)} cm in the top 1.5 m); plan on regular irrigation and mulch.`);
  }

  // --- Combine ---
  const wSum = factors.reduce((s, f) => s + f.weight, 0);
  let score = wSum > 0 ? (100 * factors.reduce((s, f) => s + f.score * f.weight, 0)) / wSum : 50;
  if (hardFails.length) score = Math.min(score, 20);
  const verdict: Suitability['verdict'] = hardFails.length ? 'not-suitable' : score >= 85 ? 'great' : score >= 70 ? 'good' : score >= 55 ? 'fair' : 'poor';
  // Lead with the biggest problems (lowest score × weight first).
  const concerns = factors
    .filter((f) => f.status === 'warn' || f.status === 'fail')
    .sort((a, b) => a.score * a.weight - b.score * b.weight)
    .map((f) => f.detail);
  const summary = `${plant.commonName} in ${bedName}: ${verdict.replace('-', ' ')} (${Math.round(score)}/100).${concerns.length ? ' ' + concerns.slice(0, 2).join(' ') : ''}`;
  return { plantId: plant.id, score: Math.round(score), verdict, factors, hardFails, summary };
}

/** Rank plants for a bed, best first; ties broken alphabetically. */
export function rankPlants(plants: PlantSpec[], site: SiteConditions, bed: BedConditions, bedName?: string): Suitability[] {
  return plants
    .map((p) => scorePlant(p, site, bed, DEFAULT_WEIGHTS, bedName))
    .sort((a, b) => b.score - a.score || a.plantId.localeCompare(b.plantId));
}
