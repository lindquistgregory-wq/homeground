/**
 * Regular raster grid in a parcel's UTM frame (square metre cells, north-up).
 * Cell (i, j): column i from west, row j from north. Its centre is
 *   x = x0 + (i + 0.5)·cell,  y = y0 − (j + 0.5)·cell
 * where (x0, y0) is the north-west corner in UTM metres.
 */
import type { UtmZone } from '../geo/utm';

export interface Grid {
  width: number;
  height: number;
  cell: number;
  x0: number;
  y0: number;
  zone: UtmZone;
  data: Float32Array;
}

export function makeGrid(g: Omit<Grid, 'data'>, fill = 0): Grid {
  return { ...g, data: new Float32Array(g.width * g.height).fill(fill) };
}

export function like(g: Grid, fill = 0): Grid {
  return makeGrid({ width: g.width, height: g.height, cell: g.cell, x0: g.x0, y0: g.y0, zone: g.zone }, fill);
}

export function cellCenter(g: Grid, i: number, j: number): [number, number] {
  return [g.x0 + (i + 0.5) * g.cell, g.y0 - (j + 0.5) * g.cell];
}

/** Continuous (fractional) cell coordinates for a UTM point. */
export function toCell(g: Grid, x: number, y: number): [number, number] {
  return [(x - g.x0) / g.cell - 0.5, (g.y0 - y) / g.cell - 0.5];
}

export function at(g: Grid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.width || j >= g.height) return NaN;
  return g.data[j * g.width + i]!;
}

export function sampleNearest(g: Grid, x: number, y: number): number {
  const [fi, fj] = toCell(g, x, y);
  return at(g, Math.round(fi), Math.round(fj));
}

export function sampleBilinear(g: Grid, x: number, y: number): number {
  const [fi, fj] = toCell(g, x, y);
  const i = Math.floor(fi), j = Math.floor(fj);
  const tx = fi - i, ty = fj - j;
  const a = at(g, i, j), b = at(g, i + 1, j), c = at(g, i, j + 1), d = at(g, i + 1, j + 1);
  if ([a, b, c, d].some(Number.isNaN)) {
    const n = sampleNearest(g, x, y);
    return n;
  }
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Replace NaN cells by averaging valid neighbours, repeated until filled (small voids only). */
export function fillVoids(g: Grid, maxPasses = 50): number {
  let remaining = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    remaining = 0;
    const next = g.data.slice();
    for (let j = 0; j < g.height; j++)
      for (let i = 0; i < g.width; i++) {
        const k = j * g.width + i;
        if (!Number.isNaN(g.data[k]!)) continue;
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const v = at(g, i + di, j + dj);
            if (!Number.isNaN(v)) (s += v), n++;
          }
        if (n) next[k] = s / n;
        else remaining++;
      }
    g.data = next;
    if (remaining === 0) break;
  }
  return remaining;
}

export function stats(g: Grid): { min: number; max: number; mean: number; valid: number } {
  let min = Infinity, max = -Infinity, sum = 0, valid = 0;
  for (const v of g.data) {
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    valid++;
  }
  return { min, max, mean: valid ? sum / valid : NaN, valid };
}

/** Rasterize polygon rings (UTM metres) into a mask by cell-centre point-in-polygon. */
export function rasterizePolygon(g: Grid, rings: Array<Array<[number, number]>>, value = 1, target = like(g)): Grid {
  const [outer, ...holes] = rings;
  if (!outer) return target;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of outer) (minX = Math.min(minX, x)), (maxX = Math.max(maxX, x)), (minY = Math.min(minY, y)), (maxY = Math.max(maxY, y));
  const [i0, j1] = toCell(g, minX, minY), [i1, j0] = toCell(g, maxX, maxY);
  const inside = (x: number, y: number, ring: Array<[number, number]>) => {
    let c = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a]!, [xb, yb] = ring[b]!;
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
    }
    return c;
  };
  for (let j = Math.max(0, Math.floor(j0)); j <= Math.min(g.height - 1, Math.ceil(j1)); j++)
    for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(g.width - 1, Math.ceil(i1)); i++) {
      const [x, y] = cellCenter(g, i, j);
      if (inside(x, y, outer) && !holes.some((h) => inside(x, y, h))) target.data[j * g.width + i] = value;
    }
  return target;
}
