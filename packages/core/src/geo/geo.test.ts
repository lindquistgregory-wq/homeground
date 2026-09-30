import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centralMeridian, fromUtm, toUtm, utmEpsg, utmZoneFor } from './utm';
import { areaM2, centroid, normalizeAreal, perimeterM, pointInAreal, ringSignedAreaDeg, distanceM } from './measure';
import type { Polygon } from './types';

const close = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('UTM zone selection and EPSG codes', () => {
  assert.deepEqual(utmZoneFor(42.25, -73.98), { zone: 18, hemisphere: 'N' });
  assert.deepEqual(utmZoneFor(-33.9, 151.2), { zone: 56, hemisphere: 'S' });
  assert.equal(utmEpsg({ zone: 18, hemisphere: 'N' }), 32618);
  assert.equal(centralMeridian(18), -75);
});

test('UTM on the central meridian matches the meridian arc (WGS84)', () => {
  const eq = toUtm(0, -75);
  close(eq.easting, 500000, 1e-6);
  close(eq.northing, 0, 1e-6);
  close(eq.scale, 0.9996, 1e-12);
  // Meridian arc length to 45°N on WGS84 is 4,984,944.378 m; UTM northing = k0 × arc.
  const p = toUtm(45, -75);
  close(p.northing, 0.9996 * 4984944.378, 0.01);
  close(p.easting, 500000, 1e-6);
});

test('UTM round trip is sub-millimetre across a zone', () => {
  for (const [lat, lon] of [
    [42.2528, -73.9857],
    [25.76, -80.19],
    [47.6, -122.33],
    [64.84, -147.72],
    [-33.87, 151.21],
    [30.0, -77.9], // near zone edge
  ] as const) {
    const u = toUtm(lat, lon);
    const back = fromUtm(u.easting, u.northing, u);
    close(back.lat, lat, 1e-9, 'lat');
    close(back.lon, lon, 1e-9, 'lon');
  }
});

/** Exact ellipsoidal area of a lat/lon cell (authalic-latitude formula). */
function ellipsoidCellArea(lat1: number, lat2: number, dLonDeg: number): number {
  const a = 6378137, f = 1 / 298.257223563;
  const e2 = f * (2 - f), e = Math.sqrt(e2), b2 = a * a * (1 - e2);
  const q = (phi: number) => {
    const s = Math.sin(phi);
    return s / (1 - e2 * s * s) + (1 / (2 * e)) * Math.log((1 + e * s) / (1 - e * s));
  };
  const r = Math.PI / 180;
  return ((dLonDeg * r * b2) / 2) * (q(lat2 * r) - q(lat1 * r));
}

test('parcel area matches the exact ellipsoidal area within 0.02 %', () => {
  const [lat, lon, d] = [42.25, -73.98, 0.004]; // ~330 m × 445 m, ~36 acres
  const poly: Polygon = {
    type: 'Polygon',
    coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
  };
  const truth = ellipsoidCellArea(lat, lat + d, d);
  const got = areaM2(poly);
  assert.ok(Math.abs(got - truth) / truth < 2e-4, `area ${got} vs ${truth}`);
});

test('holes are subtracted and winding does not matter', () => {
  const outer: [number, number][] = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
  const hole: [number, number][] = [[0.004, 0.004], [0.006, 0.004], [0.006, 0.006], [0.004, 0.006], [0.004, 0.004]];
  const solid = areaM2({ type: 'Polygon', coordinates: [outer] });
  const holed = areaM2({ type: 'Polygon', coordinates: [outer, hole] });
  const reversed = areaM2({ type: 'Polygon', coordinates: [[...outer].reverse(), [...hole].reverse()] });
  close(holed / solid, 0.96, 1e-3);
  close(reversed, holed, 1e-6);
});

test('perimeter of a ~1 km square', () => {
  const d = 0.009; // ≈1 km of latitude
  const poly: Polygon = { type: 'Polygon', coordinates: [[[-75, 40], [-75 + d, 40], [-75 + d, 40 + d], [-75, 40 + d], [-75, 40]]] };
  const p = perimeterM(poly);
  const expected = 2 * distanceM({ lat: 40, lon: -75 }, { lat: 40 + d, lon: -75 }) + 2 * distanceM({ lat: 40, lon: -75 }, { lat: 40, lon: -75 + d });
  assert.ok(Math.abs(p - expected) / expected < 3e-3, `${p} vs ${expected}`);
});

test('point in polygon respects holes; centroid of a square is its centre', () => {
  const poly: Polygon = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
      [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]],
    ],
  };
  assert.equal(pointInAreal({ lon: 0.25, lat: 0.25 }, poly), true);
  assert.equal(pointInAreal({ lon: 1, lat: 1 }, poly), false);
  assert.equal(pointInAreal({ lon: 3, lat: 1 }, poly), false);
  const sq: Polygon = { type: 'Polygon', coordinates: [[[-74, 42], [-73.99, 42], [-73.99, 42.01], [-74, 42.01], [-74, 42]]] };
  const c = centroid(sq);
  close(c.lon, -73.995, 1e-5);
  close(c.lat, 42.005, 1e-5);
});

test('normalizeAreal closes rings, dedupes, and orients per RFC 7946', () => {
  const g = normalizeAreal({
    type: 'Polygon',
    coordinates: [[[0, 0], [0, 1], [0, 1], [1, 1], [1, 0]]], // clockwise, unclosed, duplicate
  });
  assert.equal(g.type, 'Polygon');
  const ring = (g as Polygon).coordinates[0]!;
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  assert.ok(ringSignedAreaDeg(ring) > 0, 'outer ring should be CCW');
});
