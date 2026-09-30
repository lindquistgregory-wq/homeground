/**
 * Measurement in a local projected CRS (§2.3): geometry is stored in EPSG:4326 and measured in the
 * parcel's UTM zone, with the grid scale factor at the parcel centroid removed so results are true
 * ground distances/areas (error well under 0.01 % for parcel-sized shapes).
 */
import { fromUtm, toUtm, utmZoneFor, type UtmZone } from './utm';
import { toPolygons, type Areal, type BBox, type LatLon, type Position, type Ring } from './types';

export interface LocalFrame {
  zone: UtmZone;
  /** Scale factor at the frame origin; divide grid lengths by this to get ground lengths. */
  scale: number;
  origin: LatLon;
}

export function localFrame(origin: LatLon): LocalFrame {
  const zone = utmZoneFor(origin.lat, origin.lon);
  const { scale } = toUtm(origin.lat, origin.lon, zone);
  return { zone, scale, origin };
}

/** Project to ground-true metres in the frame's UTM zone. */
export function project(frame: LocalFrame, p: Position): [number, number] {
  const u = toUtm(p[1], p[0], frame.zone);
  return [u.easting, u.northing];
}

export function unproject(frame: LocalFrame, xy: [number, number]): Position {
  const { lat, lon } = fromUtm(xy[0], xy[1], frame.zone);
  return [lon, lat];
}

export function bbox(g: Areal): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of toPolygons(g))
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
  return [w, s, e, n];
}

export function bboxCenter(b: BBox): LatLon {
  return { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
}

/** Expand a bbox by a distance in metres (approximate, fine for query envelopes). */
export function bufferBBox(b: BBox, metres: number): BBox {
  const midLat = (b[1] + b[3]) / 2;
  const dLat = metres / 111_320;
  const dLon = metres / (111_320 * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

function ringAreaGrid(frame: LocalFrame, ring: Ring): number {
  const pts = ring.map((p) => project(frame, p));
  let sum = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1];
  }
  return sum / 2; // shoelace: positive for counter-clockwise
}

/** Signed planar area of a lon/lat ring (degrees²). Positive = counter-clockwise. For orientation only. */
export function ringSignedAreaDeg(ring: Ring | number[][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j]![0]! * ring[i]![1]! - ring[i]![0]! * ring[j]![1]!;
  }
  return sum / 2;
}

/** Ground area in m². Holes are subtracted regardless of ring winding. */
export function areaM2(g: Areal, frame: LocalFrame = localFrame(bboxCenter(bbox(g)))): number {
  let total = 0;
  for (const poly of toPolygons(g)) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringAreaGrid(frame, ring));
      total += i === 0 ? a : -a;
    });
  }
  return total / (frame.scale * frame.scale);
}

export function perimeterM(g: Areal, frame: LocalFrame = localFrame(bboxCenter(bbox(g)))): number {
  let total = 0;
  for (const poly of toPolygons(g)) {
    const outer = poly[0];
    if (!outer) continue;
    const pts = outer.map((p) => project(frame, p));
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  }
  return total / frame.scale;
}

export function distanceM(a: LatLon, b: LatLon): number {
  // Haversine on the mean-radius sphere; adequate for "nearest station" style ranking.
  const R = 6_371_008.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Area-weighted centroid of the largest polygon (projected), returned in lon/lat. */
export function centroid(g: Areal): LatLon {
  const frame = localFrame(bboxCenter(bbox(g)));
  let best: { a: number; cx: number; cy: number } | null = null;
  for (const poly of toPolygons(g)) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const pts = outer.map((p) => project(frame, p));
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      const cross = xj * yi - xi * yj;
      a += cross;
      cx += (xj + xi) * cross;
      cy += (yj + yi) * cross;
    }
    a /= 2;
    if (a === 0) continue;
    const c = { a: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
    if (!best || c.a > best.a) best = c;
  }
  if (!best) return bboxCenter(bbox(g));
  const [lon, lat] = unproject(frame, [best.cx, best.cy]);
  return { lat, lon };
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInAreal(p: LatLon, g: Areal): boolean {
  for (const poly of toPolygons(g)) {
    const [outer, ...holes] = poly;
    if (outer && pointInRing(p.lon, p.lat, outer) && !holes.some((h) => pointInRing(p.lon, p.lat, h))) return true;
  }
  return false;
}

/** Close rings, drop consecutive duplicate points, and orient outer rings CCW / holes CW (RFC 7946). */
export function normalizeAreal(g: Areal): Areal {
  const fixRing = (ring: Ring, outer: boolean): Ring => {
    const out: Ring = [];
    for (const p of ring) {
      const prev = out[out.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push([p[0], p[1]]);
    }
    const first = out[0], last = out[out.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push([first[0], first[1]]);
    const ccw = ringSignedAreaDeg(out) > 0;
    if (ccw !== outer) out.reverse();
    return out;
  };
  const polys = toPolygons(g)
    .map((poly) => poly.map((r, i) => fixRing(r, i === 0)).filter((r) => r.length >= 4))
    .filter((poly) => poly.length > 0);
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0]! };
  return { type: 'MultiPolygon', coordinates: polys };
}
