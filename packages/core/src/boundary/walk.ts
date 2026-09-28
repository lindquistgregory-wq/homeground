/**
 * "Walk the line" boundary capture: the user walks their property line with GPS on.
 * Readings with poor accuracy are dropped, jitter is removed with Douglas–Peucker in local metres,
 * and the track is closed into a polygon.
 */
import { localFrame, normalizeAreal, project, unproject } from '../geo/measure';
import type { Polygon } from '../geo/types';

export interface GpsFix {
  lat: number;
  lon: number;
  /** Horizontal accuracy radius in metres, as reported by the OS. */
  accuracyM: number;
  timestamp: number;
}

export interface WalkOptions {
  maxAccuracyM?: number;
  simplifyToleranceM?: number;
}

export interface WalkResult {
  polygon: Polygon | null;
  kept: number;
  dropped: number;
  /** Median accuracy of kept fixes, to show the user how trustworthy the line is. */
  medianAccuracyM: number | null;
}

function dpSimplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > maxD) (maxD = d), (idx = i);
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function walkToPolygon(fixes: GpsFix[], opts: WalkOptions = {}): WalkResult {
  const maxAcc = opts.maxAccuracyM ?? 15;
  const tol = opts.simplifyToleranceM ?? 1.5;
  const good = fixes.filter((f) => f.accuracyM > 0 && f.accuracyM <= maxAcc).sort((a, b) => a.timestamp - b.timestamp);
  const dropped = fixes.length - good.length;
  const accs = good.map((f) => f.accuracyM).sort((a, b) => a - b);
  const medianAccuracyM = accs.length ? accs[Math.floor(accs.length / 2)]! : null;
  if (good.length < 3) return { polygon: null, kept: good.length, dropped, medianAccuracyM };

  const frame = localFrame({ lat: good[0]!.lat, lon: good[0]!.lon });
  const xy = good.map((f) => project(frame, [f.lon, f.lat]));
  const simple = dpSimplify(xy, tol);
  if (simple.length < 3) return { polygon: null, kept: good.length, dropped, medianAccuracyM };
  const ring = simple.map((p) => unproject(frame, p));
  const polygon = normalizeAreal({ type: 'Polygon', coordinates: [ring] }) as Polygon;
  return { polygon, kept: good.length, dropped, medianAccuracyM };
}
