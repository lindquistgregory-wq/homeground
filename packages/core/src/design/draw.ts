/**
 * Freehand drawing on the design map: a finger stroke becomes a custom line (fence, path, hedge,
 * drainage) or, when it ends near where it started, a closed area (a garden, a pen, a woodlot).
 * Strokes are simplified so a wobbly finger doesn't make hundreds of points.
 */

type Pt = [number, number];

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const k = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
};

/** Ramer–Douglas–Peucker: drop points within `tolerance` of the line through their neighbours. */
export function simplifyPath(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points.slice();
  let worst = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDist(points[i]!, points[0]!, points[points.length - 1]!);
    if (d > worst) (worst = d), (at = i);
  }
  if (worst <= tolerance) return [points[0]!, points[points.length - 1]!];
  const left = simplifyPath(points.slice(0, at + 1), tolerance);
  return [...left.slice(0, -1), ...simplifyPath(points.slice(at), tolerance)];
}

/** Total length of a screen path. */
export const pathLength = (p: Pt[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1]), 0);

/**
 * Tidy a stroke (screen pixels) for saving: simplified, capped at `maxPoints`, and whether it reads
 * as a closed shape (ends within `closeWithin` px of its start and has some size).
 */
export function tidyStroke(points: Pt[], opts: { tolerance?: number; maxPoints?: number; closeWithin?: number } = {}): { points: Pt[]; closed: boolean } | null {
  const tolerance = opts.tolerance ?? 3, max = opts.maxPoints ?? 60, closeWithin = opts.closeWithin ?? 40;
  if (points.length < 2 || pathLength(points) < 12) return null;
  let p = simplifyPath(points, tolerance);
  for (let tol = tolerance * 2; p.length > max; tol *= 1.6) p = simplifyPath(points, tol);
  const first = p[0]!, last = p[p.length - 1]!;
  const closed = p.length >= 4 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= closeWithin && pathLength(p) > closeWithin * 3;
  if (closed) p = p.slice(0, -1); // the ring closes back to the first point
  return { points: p, closed };
}
