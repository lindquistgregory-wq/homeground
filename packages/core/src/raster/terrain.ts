/**
 * Terrain analysis on a DEM grid (§4): slope/aspect (Horn 1981), contours (marching squares),
 * D8 flow accumulation, cold-air pooling (frost-pocket) index, and contour tracing for swales.
 */
import { at, cellCenter, like, type Grid } from './grid';

/** Slope (degrees) and aspect (degrees clockwise from north, direction the slope faces; NaN on flats). */
export function slopeAspect(dem: Grid): { slope: Grid; aspect: Grid } {
  const slope = like(dem, NaN), aspect = like(dem, NaN);
  const c = dem.cell;
  for (let j = 0; j < dem.height; j++)
    for (let i = 0; i < dem.width; i++) {
      const z = (di: number, dj: number) => {
        const v = at(dem, i + di, j + dj);
        return Number.isNaN(v) ? at(dem, i, j) : v;
      };
      if (Number.isNaN(at(dem, i, j))) continue;
      // Horn: dz/dx positive toward east, dz/dy positive toward north (rows increase southward).
      const dzdx = (z(1, -1) + 2 * z(1, 0) + z(1, 1) - (z(-1, -1) + 2 * z(-1, 0) + z(-1, 1))) / (8 * c);
      const dzdy = (z(-1, -1) + 2 * z(0, -1) + z(1, -1) - (z(-1, 1) + 2 * z(0, 1) + z(1, 1))) / (8 * c);
      const k = j * dem.width + i;
      const g = Math.hypot(dzdx, dzdy);
      slope.data[k] = (Math.atan(g) * 180) / Math.PI;
      // Downslope direction = −gradient.
      aspect.data[k] = g < 1e-6 ? NaN : (((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI) + 360) % 360;
    }
  return { slope, aspect };
}

export interface ContourLine {
  level: number;
  /** Polyline vertices in UTM metres. */
  points: Array<[number, number]>;
}

/** Marching-squares contours at a fixed interval, joined into polylines. */
export function contours(dem: Grid, interval: number, maxLines = 5000): ContourLine[] {
  let min = Infinity, max = -Infinity;
  for (const v of dem.data) if (!Number.isNaN(v)) (min = Math.min(min, v)), (max = Math.max(max, v));
  if (!Number.isFinite(min)) return [];
  const out: ContourLine[] = [];
  for (let level = Math.ceil(min / interval) * interval; level <= max; level += interval) {
    const segs: Array<[[number, number], [number, number]]> = [];
    for (let j = 0; j < dem.height - 1; j++)
      for (let i = 0; i < dem.width - 1; i++) {
        const corners: Array<[number, number, number]> = [
          [...cellCenter(dem, i, j), at(dem, i, j)],
          [...cellCenter(dem, i + 1, j), at(dem, i + 1, j)],
          [...cellCenter(dem, i + 1, j + 1), at(dem, i + 1, j + 1)],
          [...cellCenter(dem, i, j + 1), at(dem, i, j + 1)],
        ];
        if (corners.some((c) => Number.isNaN(c[2]))) continue;
        const pts: Array<[number, number]> = [];
        for (let e = 0; e < 4; e++) {
          const a = corners[e]!, b = corners[(e + 1) % 4]!;
          const za = a[2] - level, zb = b[2] - level;
          if ((za < 0) !== (zb < 0)) {
            const t = za / (za - zb);
            pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
        if (pts.length === 2) segs.push([pts[0]!, pts[1]!]);
        else if (pts.length === 4) segs.push([pts[0]!, pts[1]!], [pts[2]!, pts[3]!]);
      }
    for (const line of joinSegments(segs)) {
      out.push({ level, points: line });
      if (out.length >= maxLines) return out;
    }
  }
  return out;
}

function joinSegments(segs: Array<[[number, number], [number, number]]>): Array<Array<[number, number]>> {
  const key = (p: [number, number]) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const byEnd = new Map<string, number[]>();
  segs.forEach((s, idx) => {
    for (const p of s) byEnd.set(key(p), [...(byEnd.get(key(p)) ?? []), idx]);
  });
  const used = new Uint8Array(segs.length);
  const lines: Array<Array<[number, number]>> = [];
  const extend = (line: Array<[number, number]>, atEnd: boolean) => {
    for (;;) {
      const tip = atEnd ? line[line.length - 1]! : line[0]!;
      const next = (byEnd.get(key(tip)) ?? []).find((k) => !used[k]);
      if (next === undefined) return;
      used[next] = 1;
      const [a, b] = segs[next]!;
      const other = key(a) === key(tip) ? b : a;
      if (atEnd) line.push(other);
      else line.unshift(other);
    }
  };
  segs.forEach((s, idx) => {
    if (used[idx]) return;
    used[idx] = 1;
    const line: Array<[number, number]> = [s[0], s[1]];
    extend(line, true);
    extend(line, false);
    lines.push(line);
  });
  return lines;
}

const D8: Array<[number, number, number]> = [
  [1, 0, 1], [1, 1, Math.SQRT2], [0, 1, 1], [-1, 1, Math.SQRT2], [-1, 0, 1], [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
];

/** D8 flow accumulation: upslope contributing area per cell, in m². */
export function flowAccumulation(dem: Grid): Grid {
  const n = dem.width * dem.height;
  const order = Array.from({ length: n }, (_, k) => k).filter((k) => !Number.isNaN(dem.data[k]!));
  order.sort((a, b) => dem.data[b]! - dem.data[a]!); // high → low
  const acc = like(dem, 0);
  const area = dem.cell * dem.cell;
  for (const k of order) acc.data[k]! += area;
  for (const k of order) {
    const i = k % dem.width, j = (k - i) / dem.width;
    const z = dem.data[k]!;
    let best = -1, bestDrop = 0;
    for (const [di, dj, dist] of D8) {
      const v = at(dem, i + di, j + dj);
      if (Number.isNaN(v)) continue;
      const drop = (z - v) / (dist * dem.cell);
      if (drop > bestDrop) (bestDrop = drop), (best = (j + dj) * dem.width + (i + di));
    }
    if (best >= 0) acc.data[best]! += acc.data[k]!;
  }
  for (let k = 0; k < n; k++) if (Number.isNaN(dem.data[k]!)) acc.data[k] = NaN;
  return acc;
}

/**
 * Cold-air pooling index (§4 frost pockets): how far a cell sits below the mean of its surroundings
 * within `radiusM` (metres, ≥ 0 means lower than surroundings). Cold air drains downslope at night
 * and pools in such hollows; the planting calendar shifts frost dates for high-index cells.
 */
export function coldAirPoolingIndex(dem: Grid, radiusM = 30): Grid {
  const r = Math.max(1, Math.round(radiusM / dem.cell));
  // Summed-area table for fast box means.
  const W = dem.width + 1;
  const sat = new Float64Array(W * (dem.height + 1));
  const cnt = new Float64Array(W * (dem.height + 1));
  for (let j = 0; j < dem.height; j++)
    for (let i = 0; i < dem.width; i++) {
      const v = dem.data[j * dem.width + i]!;
      const ok = !Number.isNaN(v);
      const k = (j + 1) * W + (i + 1);
      sat[k] = (ok ? v : 0) + sat[k - 1]! + sat[k - W]! - sat[k - W - 1]!;
      cnt[k] = (ok ? 1 : 0) + cnt[k - 1]! + cnt[k - W]! - cnt[k - W - 1]!;
    }
  const out = like(dem, NaN);
  for (let j = 0; j < dem.height; j++)
    for (let i = 0; i < dem.width; i++) {
      const v = dem.data[j * dem.width + i]!;
      if (Number.isNaN(v)) continue;
      const a = Math.max(0, i - r), b = Math.max(0, j - r), c = Math.min(dem.width, i + r + 1), d = Math.min(dem.height, j + r + 1);
      const s = sat[d * W + c]! - sat[b * W + c]! - sat[d * W + a]! + sat[b * W + a]!;
      const n = cnt[d * W + c]! - cnt[b * W + c]! - cnt[d * W + a]! + cnt[b * W + a]!;
      out.data[j * dem.width + i] = n ? s / n - v : NaN;
    }
  return out;
}

/**
 * Frost-date shift (days) for a cell from its pooling index: hollows of a few metres commonly run
 * 2–5 °C colder on radiative-frost nights. Conservative mapping: 1.5 days per metre of depth,
 * capped at 14 days. Returned value is added to spring and subtracted from fall freeze dates.
 */
export function frostPocketShiftDays(poolingIndexM: number): number {
  if (!(poolingIndexM > 0.5)) return 0;
  return Math.min(14, Math.round(poolingIndexM * 1.5));
}

/**
 * Trace a level contour through (x, y) for about `lengthM` metres each way — used to snap swales
 * and keyline paths to contour (§6). Steps perpendicular to the local gradient and corrects back to
 * the start elevation.
 */
export function traceContour(dem: Grid, x: number, y: number, lengthM: number, stepM = dem.cell): Array<[number, number]> {
  const bil = (px: number, py: number) => {
    const fi = (px - dem.x0) / dem.cell - 0.5, fj = (dem.y0 - py) / dem.cell - 0.5;
    const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, ty = fj - j;
    const a = at(dem, i, j), b = at(dem, i + 1, j), c = at(dem, i, j + 1), d = at(dem, i + 1, j + 1);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
  const target = bil(x, y);
  if (Number.isNaN(target)) return [[x, y]];
  const grad = (px: number, py: number): [number, number] => {
    const h = dem.cell;
    return [(bil(px + h, py) - bil(px - h, py)) / (2 * h), (bil(px, py + h) - bil(px, py - h)) / (2 * h)];
  };
  const walk = (sign: 1 | -1) => {
    const pts: Array<[number, number]> = [];
    let px = x, py = y, prev: [number, number] | null = null;
    for (let d = 0; d < lengthM; d += stepM) {
      const [gx, gy] = grad(px, py);
      const g = Math.hypot(gx, gy);
      if (!(g > 1e-4)) break; // flat: contour undefined
      let tx = (-gy / g) * sign, ty = (gx / g) * sign;
      if (prev && tx * prev[0] + ty * prev[1] < 0) (tx = -tx), (ty = -ty);
      prev = [tx, ty];
      px += tx * stepM;
      py += ty * stepM;
      // Newton step back onto the target elevation.
      const [gx2, gy2] = grad(px, py);
      const g2 = gx2 * gx2 + gy2 * gy2;
      const dz = bil(px, py) - target;
      if (Number.isNaN(dz) || g2 === 0) break;
      px -= (dz * gx2) / g2;
      py -= (dz * gy2) / g2;
      pts.push([px, py]);
    }
    return pts;
  };
  return [...walk(-1).reverse(), [x, y], ...walk(1)];
}
