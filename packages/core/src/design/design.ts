/**
 * Design model (§6): objects placed to scale on the parcel, versions, validation (setbacks, slope,
 * boundary, overlaps), snapping, and burning objects into the shade engine's surface model.
 * Objects are stored in WGS84 (so designs sync and export cleanly) and measured in the parcel's UTM frame.
 */
import { localFrame, project, unproject, type LocalFrame } from '../geo/measure';
import type { Areal, LatLon, Position } from '../geo/types';
import { toPolygons } from '../geo/types';
import { at, rasterizePolygon, toCell, type Grid } from '../raster/grid';
import { traceContour } from '../raster/terrain';
import { Material, burnObstacle, type MaterialCode, type SurfaceModel } from '../sun/shade';
import { objectType, type Shape } from './library';

export interface DesignObject {
  id: string;
  kind: string;
  label?: string;
  shape: Shape;
  /** Centre [lon, lat]. For line objects, the midpoint. */
  center: [number, number];
  /** Degrees clockwise from north that the object's length axis points. */
  rotationDeg: number;
  width: number;
  length: number;
  height: number;
  material: MaterialCode;
  crownBase?: number;
  /** Explicit polyline [lon, lat][] for line objects (swales, fences, paths). */
  path?: Array<[number, number]>;
  /** Explicit footprint ring [lon, lat][] (e.g. an existing building traced from map data). */
  polygon?: Array<[number, number]>;
  /** Existing feature detected from map data (not something the user plans to build). */
  existing?: boolean;
  costUsd?: number;
  notes?: string;
}

export interface Design {
  id: string;
  parcelId: string;
  name: string;
  objects: DesignObject[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignVersion {
  id: string;
  designId: string;
  label: string;
  createdAt: string;
  objects: DesignObject[];
}

export function newObject(kind: string, center: LatLon, id: string): DesignObject {
  const t = objectType(kind);
  if (!t) throw new Error(`Unknown object kind ${kind}`);
  return {
    id, kind, shape: t.shape, center: [center.lon, center.lat], rotationDeg: 0,
    width: t.width, length: t.length, height: t.height, material: t.material, crownBase: t.crownBase,
  };
}

// ---------------- Geometry ----------------

/**
 * Direction of true north in the UTM grid at a point, degrees clockwise from grid north (the
 * meridian-convergence correction). Object rotations are true-north-based, as the map shows them.
 */
export function trueNorthGridDeg(frame: LocalFrame, p: [number, number]): number {
  const [x0, y0] = project(frame, p);
  const [x1, y1] = project(frame, [p[0], p[1] + 1e-4]);
  return (Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI;
}

/** Footprint polygon ring in UTM metres (closed). */
export function footprintUtm(o: DesignObject, frame: LocalFrame): Array<[number, number]> {
  if (o.polygon && o.polygon.length >= 3) {
    const ring = o.polygon.map((p) => project(frame, p));
    const f = ring[0]!, l = ring[ring.length - 1]!;
    if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
    return ring;
  }
  if (o.shape === 'line' && o.path && o.path.length >= 2) return bufferLine(o.path.map((p) => project(frame, p)), Math.max(o.width, 0.05) / 2);
  const [cx, cy] = project(frame, o.center);
  if (o.shape === 'circle') {
    const r = o.width / 2;
    const ring: Array<[number, number]> = [];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * 2 * Math.PI;
      ring.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]);
    }
    return ring;
  }
  const a = ((o.rotationDeg + trueNorthGridDeg(frame, o.center)) * Math.PI) / 180;
  // Local axes: "along" = length direction (rotation from north), "across" = width.
  const ax = Math.sin(a), ay = Math.cos(a), bx = Math.cos(a), by = -Math.sin(a);
  const hl = o.length / 2, hw = o.width / 2;
  const c = (s: number, t: number): [number, number] => [cx + ax * s * hl + bx * t * hw, cy + ay * s * hl + by * t * hw];
  return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1), c(-1, -1)];
}

function bufferLine(pts: Array<[number, number]>, r: number): Array<[number, number]> {
  const left: Array<[number, number]> = [], right: Array<[number, number]> = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)]!, b = pts[Math.min(pts.length - 1, k + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    left.push([pts[k]![0] + nx * r, pts[k]![1] + ny * r]);
    right.push([pts[k]![0] - nx * r, pts[k]![1] - ny * r]);
  }
  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]!);
  return ring;
}

export function footprintLonLat(o: DesignObject, frame: LocalFrame): Position[] {
  return footprintUtm(o, frame).map((p) => unproject(frame, p));
}

export function boundsUtm(ring: Array<[number, number]>): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ring) (a = Math.min(a, x)), (b = Math.min(b, y)), (c = Math.max(c, x)), (d = Math.max(d, y));
  return [a, b, c, d];
}

export function footprintAreaM2(o: DesignObject, frame: LocalFrame): number {
  const r = footprintUtm(o, frame);
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
  return Math.abs(s / 2);
}

/** Burn every shade-casting object into the surface model. */
export function burnDesign(surface: SurfaceModel, objects: DesignObject[], frame: LocalFrame): void {
  for (const o of objects) {
    if (o.material === Material.none || o.height <= 0) continue;
    const mask = rasterizePolygon(surface.ground, [footprintUtm(o, frame)]);
    burnObstacle(surface, mask, o.height, o.material, (o.crownBase ?? 0) * o.height);
  }
}

// ---------------- Snapping ----------------

export function snapToGridM(frame: LocalFrame, p: [number, number], stepM = 0.5): [number, number] {
  const [x, y] = project(frame, p);
  const [lon, lat] = unproject(frame, [Math.round(x / stepM) * stepM, Math.round(y / stepM) * stepM]);
  return [lon, lat];
}

/** Snap a rotation to the nearest boundary edge direction (or its perpendicular) within `tolDeg`. */
export function snapRotationToBoundary(rotationDeg: number, boundary: Areal, frame: LocalFrame, tolDeg = 6): number {
  const outer = toPolygons(boundary)[0]?.[0] ?? [];
  let best = rotationDeg, bestDiff = tolDeg;
  for (let k = 1; k < outer.length; k++) {
    const [x0, y0] = project(frame, outer[k - 1]!), [x1, y1] = project(frame, outer[k]!);
    const conv = trueNorthGridDeg(frame, [outer[k]![0], outer[k]![1]]);
    const edgeRaw = (((((Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI - conv) % 180) + 180) % 180);
    const edge = (Math.round(edgeRaw * 100) / 100) % 180; // 0.01° is far below drawing precision
    for (const cand of [edge, (edge + 90) % 180]) {
      const r = ((rotationDeg % 180) + 180) % 180;
      const diff = Math.min(Math.abs(r - cand), 180 - Math.abs(r - cand));
      if (diff < bestDiff) (bestDiff = diff), (best = cand);
    }
  }
  return best;
}

/** Line objects that follow contour (swales): replace the path with the traced level line. */
export function snapToContour(o: DesignObject, dem: Grid, frame: LocalFrame): DesignObject {
  const [x, y] = project(frame, o.center);
  const pts = traceContour(dem, x, y, o.length / 2, Math.max(0.5, dem.cell));
  if (pts.length < 2) return o;
  return { ...o, path: pts.map((p) => unproject(frame, p) as [number, number]) };
}

// ---------------- Validation ----------------

export type WarningKind = 'outside-boundary' | 'setback' | 'steep-slope' | 'overlap';
export interface DesignWarning {
  objectId: string;
  kind: WarningKind;
  message: string;
}

export interface ValidationContext {
  boundary: Areal;
  /** Minimum distance from the property line for structures, metres (user-entered; 0 = off). */
  setbackM?: number;
  slope?: Grid;
  maxStructureSlopeDeg?: number;
}

function distPointSeg(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
}

function inRing(x: number, y: number, ring: Array<[number, number]>): boolean {
  let c = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a]!, [xb, yb] = ring[b]!;
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
  }
  return c;
}

export function validateDesign(objects: DesignObject[], ctx: ValidationContext, frame: LocalFrame): DesignWarning[] {
  const warnings: DesignWarning[] = [];
  const polys = toPolygons(ctx.boundary).map((p) => p[0]!.map((q) => project(frame, q)));
  const edges = polys.flatMap((ring) => ring.slice(1).map((b, k) => [ring[k]!, b] as [[number, number], [number, number]]));
  const maxSlope = ctx.maxStructureSlopeDeg ?? 10;
  const feet = (m: number) => `${(m / 0.3048).toFixed(0)} ft`;
  const fps = objects.map((o) => ({ o, ring: footprintUtm(o, frame), type: objectType(o.kind) }));

  for (const { o, ring, type } of fps) {
    const outside = ring.some(([x, y]) => !polys.some((p) => inRing(x, y, p)));
    if (outside) warnings.push({ objectId: o.id, kind: 'outside-boundary', message: `${type?.name ?? o.kind} extends past the property line.` });
    if (type?.isStructure && ctx.setbackM && ctx.setbackM > 0) {
      const d = Math.min(...ring.flatMap(([x, y]) => edges.map(([a, b]) => distPointSeg(x, y, a, b))));
      if (d < ctx.setbackM)
        warnings.push({ objectId: o.id, kind: 'setback', message: `${type.name} is ${feet(d)} from the property line; your setback is ${feet(ctx.setbackM)}.` });
    }
    if (type?.isStructure && ctx.slope) {
      let worst = 0;
      for (const [x, y] of ring) {
        const [fi, fj] = toCell(ctx.slope, x, y);
        const s = at(ctx.slope, Math.round(fi), Math.round(fj));
        if (s > worst) worst = s;
      }
      if (worst > maxSlope)
        warnings.push({ objectId: o.id, kind: 'steep-slope', message: `${type.name} sits on a ${worst.toFixed(0)}° slope; level ground or a foundation plan is needed.` });
    }
  }
  for (let a = 0; a < fps.length; a++)
    for (let b = a + 1; b < fps.length; b++) {
      const A = fps[a]!, B = fps[b]!;
      if (!A.type?.isStructure || !B.type?.isStructure) continue;
      const hit = A.ring.some(([x, y]) => inRing(x, y, B.ring)) || B.ring.some(([x, y]) => inRing(x, y, A.ring));
      if (hit) warnings.push({ objectId: B.o.id, kind: 'overlap', message: `${B.type.name} overlaps ${A.type.name}.` });
    }
  return warnings;
}

// ---------------- Material list ----------------

export interface MaterialLine {
  kind: string;
  name: string;
  count: number;
  areaM2: number;
  lengthM: number;
  costUsd?: number;
}

export function materialList(objects: DesignObject[], frame: LocalFrame): MaterialLine[] {
  const byKind = new Map<string, MaterialLine>();
  for (const o of objects) {
    const t = objectType(o.kind);
    const line = byKind.get(o.kind) ?? { kind: o.kind, name: t?.name ?? o.kind, count: 0, areaM2: 0, lengthM: 0 };
    line.count++;
    if (o.shape === 'line') {
      const pts = (o.path ?? []).map((p) => project(frame, p));
      line.lengthM += pts.length >= 2 ? pts.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - pts[k]![0], p[1] - pts[k]![1]), 0) : o.length;
    } else line.areaM2 += footprintAreaM2(o, frame);
    if (o.costUsd !== undefined) line.costUsd = (line.costUsd ?? 0) + o.costUsd;
    byKind.set(o.kind, line);
  }
  return [...byKind.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function frameForBoundary(boundary: Areal): LocalFrame {
  const ring = toPolygons(boundary)[0]![0]!;
  let lon = 0, lat = 0;
  for (const p of ring) (lon += p[0]), (lat += p[1]);
  return localFrame({ lon: lon / ring.length, lat: lat / ring.length });
}
