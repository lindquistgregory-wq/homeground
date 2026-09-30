/**
 * Parcel analysis for design mode and the sun screen (§4–§5). Loads the terrain grids, optional canopy
 * heights, far horizon and parcel mask once per parcel, then computes direct-sun hours for a design
 * on demand, using the native inner loop when it's linked and the TypeScript engine otherwise.
 */
import {
  DEFAULT_TRANSMITTANCE, affectedMask, boundsUtm, footprintUtm, burnCanopy, burnDesign, bbox, cellCenter, coldAirPoolingIndex, contours, daySunSamples, emptySurface,
  fromUtm, horizonProfile, isLeafOn, like, makeGrid, prepareSamples, rasterizePolygon, sampleBilinear, slopeAspect, sunHours,
  solarDayOf, solarPosition, toPolygons, type Areal, type ContourLine, type DesignObject, type Grid, type HorizonProfile, type Layer, type LocalFrame,
  type PreparedSample, type SurfaceModel, frameForBoundary, project,
} from '@plotwright/core';
import { parcelCanopy, parcelTerrain, utmBoxFor, type ParcelTerrain } from '@plotwright/providers';
import { ShadeNativeModule } from '@plotwright/shade-native';
import { inflateSync, unzlibSync } from 'fflate';
import { http } from './http';

/** Cap on analysis cells so a big parcel stays interactive; larger parcels use a coarser grid. */
const MAX_CELLS = 60_000;

export interface ParcelAnalysis {
  parcelId: string;
  frame: LocalFrame;
  boundary: Areal;
  terrain: Layer<ParcelTerrain>;
  canopy?: Layer<Grid>;
  /** Analysis grid (bare earth) covering the parcel plus a margin, at ≤ MAX_CELLS inside the parcel. */
  ground: Grid;
  /** 1 inside the parcel. */
  mask: Uint8Array;
  maskGrid: Grid;
  horizon?: HorizonProfile;
  slope?: Grid;
  aspect?: Grid;
  pooling?: Grid;
  frost?: { lastSpringDoy?: number | null; firstFallDoy?: number | null };
}

const cache = new Map<string, Promise<ParcelAnalysis>>();

/**
 * TIFF compression 8 / 32946 is zlib-wrapped DEFLATE (starts 0x78). fflate's inflateSync expects raw
 * DEFLATE, so unwrap with unzlibSync, falling back to raw for the rare writer that omits the header.
 */
const inflate = (b: Uint8Array) => {
  try {
    return unzlibSync(b);
  } catch {
    return inflateSync(b);
  }
};

function resample(src: Grid, cell: number, box: [number, number, number, number]): Grid {
  const width = Math.max(1, Math.ceil((box[2] - box[0]) / cell));
  const height = Math.max(1, Math.ceil((box[3] - box[1]) / cell));
  const g = makeGrid({ width, height, cell, x0: box[0], y0: box[3], zone: src.zone }, NaN);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const [x, y] = cellCenter(g, i, j);
      g.data[j * width + i] = sampleBilinear(src, x, y);
    }
  return g;
}

export async function loadAnalysis(
  parcelId: string,
  boundary: Areal,
  opts: { canopy: boolean; frost?: ParcelAnalysis['frost']; refresh?: boolean },
): Promise<ParcelAnalysis> {
  // Boundary edits must invalidate the cached mask; frost dates only change leaf-on timing.
  const key = `${parcelId}:${opts.canopy ? 'c' : 'n'}:${hashString(JSON.stringify(boundary))}`;
  if (!opts.refresh && cache.has(key)) {
    const cached = await cache.get(key)!;
    if (opts.frost) cached.frost = opts.frost;
    return cached;
  }
  const p = (async (): Promise<ParcelAnalysis> => {
    const frame = frameForBoundary(boundary);
    const client = opts.refresh ? http.fresh() : http;
    const box = utmBoxFor(bbox(boundary), frame.zone);
    const terrain = await parcelTerrain(client, box, { inflate });

    // Analysis extent: parcel + 60 m so trees and buildings just outside still cast shade in.
    const margin = 60;
    const ext: [number, number, number, number] = [box.xmin - margin, box.ymin - margin, box.xmax + margin, box.ymax + margin];
    const parcelArea = (box.xmax - box.xmin) * (box.ymax - box.ymin);
    const baseCell = terrain.status === 'ok' ? terrain.value.near.cell : 1;
    const cell = Math.max(baseCell, Math.sqrt(parcelArea / MAX_CELLS), 0.5);

    let ground: Grid;
    if (terrain.status === 'ok') ground = resample(terrain.value.near, cell, ext);
    else {
      // No DEM: flat ground still gives useful building/tree shade.
      const w = Math.ceil((ext[2] - ext[0]) / cell), h = Math.ceil((ext[3] - ext[1]) / cell);
      ground = makeGrid({ width: w, height: h, cell, x0: ext[0], y0: ext[3], zone: frame.zone }, 0);
    }

    const rings = toPolygons(boundary).flatMap((poly) => poly.map((r) => r.map((pt) => project(frame, pt) as [number, number])));
    const maskGrid = rasterizePolygon(ground, rings);
    const mask = new Uint8Array(maskGrid.data.length);
    for (let k = 0; k < mask.length; k++) mask[k] = maskGrid.data[k] ? 1 : 0;

    let canopy: Layer<Grid> | undefined;
    if (opts.canopy) canopy = await parcelCanopy(client, like(ground, 0), inflate);

    let horizon: HorizonProfile | undefined, slope: Grid | undefined, aspect: Grid | undefined, pooling: Grid | undefined;
    if (terrain.status === 'ok') {
      const cx = (box.xmin + box.xmax) / 2, cy = (box.ymin + box.ymax) / 2;
      // Start the far horizon where the near grid ends so no terrain band is skipped.
      const nearEdge = Math.min(cx - ext[0], ext[2] - cx, cy - ext[1], ext[3] - cy);
      horizon = horizonProfile(terrain.value.far, cx, cy, { minDistM: Math.max(30, nearEdge - 2 * cell) });
      ({ slope, aspect } = slopeAspect(ground));
      pooling = coldAirPoolingIndex(ground);
    }
    return { parcelId, frame, boundary, terrain, canopy, ground, mask, maskGrid, horizon, slope, aspect, pooling, frost: opts.frost };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function surfaceFor(a: ParcelAnalysis, objects: DesignObject[]): SurfaceModel {
  const s = emptySurface(a.ground);
  if (a.canopy?.status === 'ok') burnCanopy(s, a.canopy.value);
  burnDesign(s, objects, a.frame);
  return s;
}

export type SunPeriod = 'today' | 'winter' | 'equinox' | 'summer' | 'growing';

export const PERIOD_LABELS: Record<SunPeriod, string> = {
  today: 'Today',
  winter: 'Dec 21',
  equinox: 'Equinox',
  summer: 'Jun 21',
  growing: 'Growing season avg',
};

function periodDates(period: SunPeriod, year: number, lon: number): Date[] {
  const d = (m: number, day: number) => new Date(Date.UTC(year, m, day, 12));
  switch (period) {
    case 'today':
      return [solarDayOf(new Date(), lon)];
    case 'winter':
      return [d(11, 21)];
    case 'equinox':
      return [d(2, 20)];
    case 'summer':
      return [d(5, 21)];
    case 'growing':
      return [d(3, 15), d(4, 15), d(5, 15), d(6, 15), d(7, 15), d(8, 15)];
  }
}

const doyOf = (date: Date) => Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);

export interface SunResult {
  hours: Grid;
  period: SunPeriod;
  engine: 'native' | 'js';
  ms: number;
  /** Hours of daylight the sun is above the far horizon (the most any cell could get). */
  possibleHours: number;
}

function runEngine(s: SurfaceModel, samples: PreparedSample[], leafOn: boolean, mask: Uint8Array, out: Grid): 'native' | 'js' {
  if (ShadeNativeModule) {
    const n = s.ground.data.length;
    const heights = new Float32Array(2 * n);
    heights.set(s.height, 0);
    heights.set(s.base, n);
    const smp = new Float32Array(samples.length * 4);
    samples.forEach((p, i) => smp.set([p.sx, p.sy, p.tanAlt, p.hours], i * 4));
    const tr = DEFAULT_TRANSMITTANCE;
    const trans = new Float32Array([1, tr.opaque, leafOn ? tr.deciduousLeafOn : tr.deciduousLeafOff, tr.evergreen, tr.film]);
    ShadeNativeModule.sunHours(s.ground.data, heights, s.material, smp, trans, mask, out.data,
      new Float64Array([s.ground.width, s.ground.height, s.ground.cell, 0.3, 250]));
    return 'native';
  }
  sunHours(s, samples, { sampleHours: samples[0]?.hours ?? 0.25, leafOn, mask }, out);
  return 'js';
}

/** Objects that only cast shade part of the year, such as tall crops between midsummer and frost. */
export interface SeasonalObjects {
  objects: DesignObject[];
  /** Inclusive day-of-year range when they stand at full height. */
  fromDoy: number;
  toDoy: number;
}

/**
 * Direct-sun hours per parcel cell for a design and period (averaged over the period's dates).
 * Pass `prev` and the objects that changed to recompute only the cells their shadows can reach
 * (single-date periods); this is the < 500 ms "move a structure" path.
 */
export function computeSun(
  a: ParcelAnalysis, objects: DesignObject[], period: SunPeriod, stepMin = 15,
  incremental?: { prev: SunResult; changed: DesignObject[] },
  seasonal?: SeasonalObjects,
): SunResult {
  const t0 = Date.now();
  const base = surfaceFor(a, objects);
  const withSeasonal = seasonal?.objects.length ? surfaceFor(a, [...objects, ...seasonal.objects]) : base;
  const surfaceOn = (date: Date) => (seasonal && doyOf(date) >= seasonal.fromDoy && doyOf(date) <= seasonal.toDoy ? withSeasonal : base);
  const c = a.frame.origin;
  const dates = periodDates(period, new Date().getUTCFullYear(), c.lon);
  if (incremental && incremental.prev.period === period && dates.length === 1 && incremental.changed.length && incremental.prev.hours.data.length === a.ground.data.length) {
    const date = dates[0]!;
    const samples = prepareSamples(daySunSamples(date, c.lat, c.lon, stepMin), { horizon: a.horizon, sampleHours: stepMin / 60 });
    let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    let maxH = 0;
    for (const o of incremental.changed) {
      const ob = boundsUtm(footprintUtm(o, a.frame));
      b = [Math.min(b[0], ob[0]), Math.min(b[1], ob[1]), Math.max(b[2], ob[2]), Math.max(b[3], ob[3])];
      maxH = Math.max(maxH, o.height);
    }
    const m = affectedMask(a.ground, b, maxH, samples);
    for (let k = 0; k < m.length; k++) m[k] = m[k]! & a.mask[k]!;
    const out = like(a.ground, 0);
    out.data.set(incremental.prev.hours.data);
    const leafOn = isLeafOn(doyOf(date), a.frost?.lastSpringDoy, a.frost?.firstFallDoy);
    const engine = runEngine(surfaceOn(date), samples, leafOn, m, out);
    return { hours: out, period, engine, ms: Date.now() - t0, possibleHours: incremental.prev.possibleHours };
  }
  const acc = like(a.ground, 0);
  const tmp = like(a.ground, 0);
  let engine: 'native' | 'js' = 'js';
  let possible = 0;
  for (const date of dates) {
    const samples = prepareSamples(daySunSamples(date, c.lat, c.lon, stepMin), { horizon: a.horizon, sampleHours: stepMin / 60 });
    possible += samples.length * (stepMin / 60);
    const leafOn = isLeafOn(doyOf(date), a.frost?.lastSpringDoy, a.frost?.firstFallDoy);
    engine = runEngine(surfaceOn(date), samples, leafOn, a.mask, tmp);
    for (let k = 0; k < acc.data.length; k++) if (a.mask[k]) acc.data[k] = acc.data[k]! + tmp.data[k]! / dates.length;
  }
  for (let k = 0; k < acc.data.length; k++) if (!a.mask[k]) acc.data[k] = NaN;
  return { hours: acc, period, engine, ms: Date.now() - t0, possibleHours: possible / dates.length };
}

/** Is a point in direct sun at `when` according to the model (for "sun checks"). */
export function modeledSunAt(a: ParcelAnalysis, objects: DesignObject[], lat: number, lon: number, when: Date): boolean | null {
  const [x, y] = project(a.frame, [lon, lat]);
  const i = Math.floor((x - a.ground.x0) / a.ground.cell), j = Math.floor((a.ground.y0 - y) / a.ground.cell);
  if (i < 0 || j < 0 || i >= a.ground.width || j >= a.ground.height) return null;
  const pos = solarPosition(when, lat, lon);
  if (pos.elevation <= 0) return false; // sun is down
  const samples = prepareSamples([{ ...pos, time: when }], { horizon: a.horizon, sampleHours: 1 });
  if (!samples.length) return false; // behind the far horizon
  const mask = new Uint8Array(a.ground.data.length);
  mask[j * a.ground.width + i] = 1;
  const out = like(a.ground, 0);
  runEngine(surfaceFor(a, objects), samples, isLeafOn(doyOf(when), a.frost?.lastSpringDoy, a.frost?.firstFallDoy), mask, out);
  return out.data[j * a.ground.width + i]! > 0.5;
}

// ---------------- Map layers ----------------

type Feature = { type: 'Feature'; geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'LineString'; coordinates: number[][] }; properties: Record<string, number | string> };

/** Heatmap cells as GeoJSON polygons (aggregated to ≤ ~15k features for the map). */
export function heatmapGeoJSON(a: ParcelAnalysis, hours: Grid): { type: 'FeatureCollection'; features: Feature[] } {
  let inside = 0;
  for (const m of a.mask) inside += m;
  const f = Math.max(1, Math.ceil(Math.sqrt(inside / 15_000)));
  const g = a.ground;
  const features: Feature[] = [];
  // One inverse projection per lattice vertex (shared by up to 4 cells), rounded to ~1 cm.
  const cols = Math.ceil(g.width / f) + 1;
  const vertexCache = new Map<number, number[]>();
  const vertex = (vi: number, vj: number) => {
    const key = vj * cols + vi;
    let v = vertexCache.get(key);
    if (!v) {
      const { lat, lon } = fromUtm(g.x0 + vi * f * g.cell, g.y0 - vj * f * g.cell, g.zone);
      v = [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
      vertexCache.set(key, v);
    }
    return v;
  };
  for (let j = 0; j < g.height; j += f)
    for (let i = 0; i < g.width; i += f) {
      let sum = 0, n = 0;
      for (let dj = 0; dj < f && j + dj < g.height; dj++)
        for (let di = 0; di < f && i + di < g.width; di++) {
          const k = (j + dj) * g.width + i + di;
          if (a.mask[k] && !Number.isNaN(hours.data[k]!)) (sum += hours.data[k]!), n++;
        }
      if (!n) continue;
      const vi = i / f, vj = j / f;
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[vertex(vi, vj), vertex(vi + 1, vj), vertex(vi + 1, vj + 1), vertex(vi, vj + 1), vertex(vi, vj)]] },
        properties: { hours: Math.round((sum / n) * 10) / 10 },
      });
    }
  return { type: 'FeatureCollection', features };
}

/**
 * Contour lines over the parcel. The interval is widened if needed so there are at most ~80 levels,
 * which keeps this under a few hundred ms on a phone. Returns the interval actually used.
 */
export function contourGeoJSON(a: ParcelAnalysis, intervalM: number): { type: 'FeatureCollection'; features: Feature[]; intervalM: number } {
  let min = Infinity, max = -Infinity;
  for (const v of a.ground.data) if (!Number.isNaN(v)) (min = Math.min(min, v)), (max = Math.max(max, v));
  const used = Number.isFinite(min) ? Math.max(intervalM, (max - min) / 80) : intervalM;
  const lines: ContourLine[] = contours(a.ground, used, 3000);
  return {
    type: 'FeatureCollection',
    features: lines.map((l) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: l.points.map(([x, y]) => { const { lat, lon } = fromUtm(x, y, a.ground.zone); return [lon, lat]; }) },
      properties: { level: Math.round(l.level * 10) / 10 },
    })),
    intervalM: used,
  };
}

/** Summary of sun classes inside the parcel for the legend. */
export function sunSummary(a: ParcelAnalysis, hours: Grid): { full: number; part: number; shade: number; cellAreaM2: number } {
  let full = 0, part = 0, shade = 0;
  for (let k = 0; k < hours.data.length; k++) {
    if (!a.mask[k]) continue;
    const h = hours.data[k]!;
    if (Number.isNaN(h)) continue;
    if (h >= 6) full++;
    else if (h >= 3) part++;
    else shade++;
  }
  return { full, part, shade, cellAreaM2: a.ground.cell * a.ground.cell };
}
