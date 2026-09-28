/**
 * Phase 2 performance spike (§5.5, ADR 0001): times the shade engine on a synthetic backyard.
 * Run in Node with `pnpm bench:shade`, and on a phone from Settings → Diagnostics (same code), to
 * decide whether the inner loop must move to native code. Target: < 500 ms to update after moving a structure.
 */
import { makeGrid, rasterizePolygon } from '../raster/grid';
import { Material, affectedMask, burnCanopy, burnObstacle, emptySurface, prepareSamples, sunHours } from './shade';
import { daySunSamples } from './spa';

export interface ShadeBenchResult {
  cells: number;
  samples: number;
  fullDayMs: number;
  incrementalMs: number;
  incrementalCells: number;
  now: string;
}

export function runShadeBenchmark(opts: { sizeM?: number; cellM?: number; stepMin?: number; now?: () => number } = {}): ShadeBenchResult {
  const size = opts.sizeM ?? 100, cell = opts.cellM ?? 1, stepMin = opts.stepMin ?? 15;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const zone = { zone: 18, hemisphere: 'N' as const };
  const n = Math.round(size / cell);
  const g = makeGrid({ width: n, height: n, cell, x0: 580000, y0: 4680000 + size, zone }, 0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.data[j * n + i] = 100 + 0.03 * i * cell + 0.02 * j * cell;
  const s = emptySurface(g);
  const canopy = makeGrid({ width: n, height: n, cell, x0: g.x0, y0: g.y0, zone }, 0);
  const rect = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  rasterizePolygon(g, [rect(580000, 4680000, 580000 + size, 4680000 + 8)], 14, canopy); // tree line on the south edge
  burnCanopy(s, canopy, Material.deciduous);
  burnObstacle(s, rasterizePolygon(g, [rect(580060, 4680060, 580072, 4680070)]), 7, Material.opaque); // house
  const samples = prepareSamples(daySunSamples(new Date(Date.UTC(2026, 11, 21)), 42.25, -73.98, stepMin), { sampleHours: stepMin / 60 });

  let t = now();
  const out = sunHours(s, samples, { sampleHours: stepMin / 60, leafOn: false });
  const fullDayMs = now() - t;

  const b: [number, number, number, number] = [580030, 4680040, 580036, 4680043]; // 6 × 3 m greenhouse
  burnObstacle(s, rasterizePolygon(g, [rect(b[0], b[1], b[2], b[3])]), 3, Material.film);
  t = now();
  const mask = affectedMask(g, b, 3, samples);
  sunHours(s, samples, { sampleHours: stepMin / 60, leafOn: false, mask }, out);
  const incrementalMs = now() - t;
  let incrementalCells = 0;
  for (const m of mask) incrementalCells += m;
  return { cells: n * n, samples: samples.length, fullDayMs, incrementalMs, incrementalCells, now: new Date().toISOString() };
}
