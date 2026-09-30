import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundaryImportError, detectFormat, georeference, parseDxf, parseGeoJson, parseGpx, parseKml, parseKmz, parseShapefile,
} from './import';
import { walkToPolygon, type GpsFix } from './walk';
import { areaM2 } from '../geo/measure';
import type { Polygon } from '../geo/types';

const SQUARE = [[-73.99, 42.25], [-73.98, 42.25], [-73.98, 42.26], [-73.99, 42.26], [-73.99, 42.25]];

test('GeoJSON FeatureCollection with a polygon', () => {
  const r = parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [SQUARE] } }] }));
  assert.equal(r.needsGeoreference, false);
  assert.equal(r.geometry?.type, 'Polygon');
  assert.ok(areaM2(r.geometry!) > 900_000);
});

test('GeoJSON in a projected CRS asks for georeferencing', () => {
  const r = parseGeoJson(JSON.stringify({
    type: 'Feature', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32618' } },
    geometry: { type: 'Polygon', coordinates: [[[580000, 4678000], [580100, 4678000], [580100, 4678100], [580000, 4678000]]] }, properties: {},
  }));
  assert.equal(r.needsGeoreference, true);
  assert.equal(r.geometry, null);
});

test('invalid or empty files raise a friendly error', () => {
  assert.throws(() => parseGeoJson('not json'), BoundaryImportError);
  assert.throws(() => parseGeoJson('{"type":"FeatureCollection","features":[]}'), /No polygon/);
});

test('KML polygon with hole and namespace prefixes', () => {
  const kml = `<?xml version="1.0"?><kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Document><kml:Placemark>
    <kml:Polygon><kml:outerBoundaryIs><kml:LinearRing><kml:coordinates>
      -73.99,42.25,0 -73.98,42.25,0 -73.98,42.26,0 -73.99,42.26,0 -73.99,42.25,0
    </kml:coordinates></kml:LinearRing></kml:outerBoundaryIs>
    <kml:innerBoundaryIs><kml:LinearRing><kml:coordinates>-73.986,42.254 -73.984,42.254 -73.984,42.256 -73.986,42.256 -73.986,42.254</kml:coordinates></kml:LinearRing></kml:innerBoundaryIs>
    </kml:Polygon></kml:Placemark></kml:Document></kml:kml>`;
  const r = parseKml(kml);
  const g = r.geometry as Polygon;
  assert.equal(g.coordinates.length, 2);
  const solid = areaM2({ type: 'Polygon', coordinates: [g.coordinates[0]!] });
  assert.ok(areaM2(g) < solid);
});

test('KMZ delegates to the inner doc.kml', () => {
  const kml = `<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${SQUARE.map((p) => p.join(',')).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
  const r = parseKmz(new Uint8Array([1]), () => ({ 'files/doc.kml': new TextEncoder().encode(kml) }));
  assert.equal(r.format, 'kmz');
  assert.equal(r.geometry?.type, 'Polygon');
});

test('GPX track becomes a closed polygon', () => {
  const gpx = `<gpx><trk><trkseg>${SQUARE.slice(0, 4).map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"><ele>10</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
  const r = parseGpx(gpx);
  const ring = (r.geometry as Polygon).coordinates[0]!;
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  assert.ok(r.warnings.some((w) => /closed/.test(w)));
});

/** Build a minimal single-record Polygon .shp in memory. */
function makeShp(rings: number[][][]): Uint8Array {
  const numPoints = rings.reduce((n, r) => n + r.length, 0);
  const content = 44 + rings.length * 4 + numPoints * 16;
  const buf = new ArrayBuffer(100 + 8 + content);
  const dv = new DataView(buf);
  dv.setInt32(0, 9994, false);
  dv.setInt32(24, (100 + 8 + content) / 2, false);
  dv.setInt32(28, 1000, true);
  dv.setInt32(32, 5, true);
  dv.setInt32(100, 1, false);
  dv.setInt32(104, content / 2, false);
  const rec = 108;
  dv.setInt32(rec, 5, true);
  dv.setInt32(rec + 36, rings.length, true);
  dv.setInt32(rec + 40, numPoints, true);
  let idx = 0;
  rings.forEach((r, i) => {
    dv.setInt32(rec + 44 + i * 4, idx, true);
    idx += r.length;
  });
  let p = rec + 44 + rings.length * 4;
  for (const r of rings) for (const [x, y] of r) (dv.setFloat64(p, x!, true), dv.setFloat64(p + 8, y!, true), (p += 16));
  return new Uint8Array(buf);
}

test('Shapefile: clockwise outer ring in WGS84 with .prj', () => {
  const cw = [...SQUARE].reverse(); // shapefile outer rings are clockwise
  const r = parseShapefile({
    'parcel.shp': makeShp([cw]),
    'parcel.prj': new TextEncoder().encode('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]'),
  });
  assert.equal(r.needsGeoreference, false);
  assert.ok(Math.abs(areaM2(r.geometry!) - areaM2({ type: 'Polygon', coordinates: [SQUARE as [number, number][]] })) < 1);
});

test('Shapefile in a projected CRS needs georeferencing and keeps the WKT', () => {
  const r = parseShapefile({
    'lot.shp': makeShp([[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]]),
    'lot.prj': new TextEncoder().encode('PROJCS["NAD_1983_StatePlane_New_York_East_FIPS_3101_Feet",GEOGCS["GCS_North_American_1983"]]'),
  });
  assert.equal(r.needsGeoreference, true);
  assert.match(r.crsHint!, /StatePlane/);
  assert.throws(() => parseShapefile({ 'x.dbf': new Uint8Array(4) }), /\.shp/);
});

test('DXF LWPOLYLINE from a survey is georeferenced with a user-chosen transform', () => {
  const dxf = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'BOUNDARY', '90', '4', '70', '1',
    '10', '580000', '20', '4678000', '10', '580100', '20', '4678000', '10', '580100', '20', '4678100', '10', '580000', '20', '4678100',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n');
  const r = parseDxf(dxf);
  assert.equal(r.needsGeoreference, true);
  assert.equal(r.crsHint, 'Drawing units: metres');
  // Stand-in for proj4: UTM 18N → lon/lat via our own inverse.
  const g = georeference(r, (x, y) => {
    const lon = -75 + (x - 500000) / 82000; // rough linear map, fine for this test
    const lat = y / 111_000;
    return [lon, lat];
  });
  assert.equal(g.type, 'Polygon');
  assert.throws(() => georeference(r, (x, y) => [x, y]), /does not place this boundary/);
});

test('format detection', () => {
  assert.equal(detectFormat('Survey.DXF'), 'dxf');
  assert.equal(detectFormat('lot.zip'), 'shapefile');
  assert.equal(detectFormat('photo.jpg'), null);
});

test('walk-the-line drops inaccurate fixes and simplifies jitter', () => {
  const fixes: GpsFix[] = [];
  let t = 0;
  const corners = SQUARE.slice(0, 4);
  // Walk each edge with 20 points and ±0.3 m of jitter, plus one terrible fix.
  for (let e = 0; e < 4; e++) {
    const [a, b] = [corners[e]!, corners[(e + 1) % 4]!];
    for (let i = 0; i < 20; i++) {
      const f = i / 20;
      const jitter = (i % 2 ? 1 : -1) * 0.000003;
      fixes.push({ lon: a[0]! + (b[0]! - a[0]!) * f + jitter, lat: a[1]! + (b[1]! - a[1]!) * f + jitter, accuracyM: 5, timestamp: t++ });
    }
  }
  fixes.push({ lon: -73.5, lat: 42.5, accuracyM: 80, timestamp: t++ });
  const r = walkToPolygon(fixes);
  assert.equal(r.dropped, 1);
  assert.equal(r.medianAccuracyM, 5);
  const ring = r.polygon!.coordinates[0]!;
  assert.ok(ring.length <= 8, `expected a few corners, got ${ring.length}`);
  const truth = areaM2({ type: 'Polygon', coordinates: [SQUARE as [number, number][]] });
  assert.ok(Math.abs(areaM2(r.polygon!) - truth) / truth < 0.01);
});

test('walk-the-line: a loop that ends exactly where it started', () => {
  const corners = SQUARE.slice(0, 4);
  const fixes: GpsFix[] = [];
  let t = 0;
  for (let e = 0; e < 4; e++) {
    const [a, b] = [corners[e]!, corners[(e + 1) % 4]!];
    for (let i = 0; i < 10; i++) {
      const f = i / 10;
      fixes.push({ lon: a[0]! + (b[0]! - a[0]!) * f, lat: a[1]! + (b[1]! - a[1]!) * f, accuracyM: 4, timestamp: t++ });
    }
  }
  fixes.push({ lon: corners[0]![0]!, lat: corners[0]![1]!, accuracyM: 4, timestamp: t++ }); // back at the start
  const r = walkToPolygon(fixes);
  assert.ok(r.polygon, 'closed walk must produce a polygon');
  const ring = r.polygon!.coordinates[0]!;
  assert.equal(ring.length, 5, `expected 4 corners + closing point, got ${ring.length}`);
  const truth = areaM2({ type: 'Polygon', coordinates: [SQUARE as [number, number][]] });
  assert.ok(Math.abs(areaM2(r.polygon!) - truth) / truth < 0.001);
});
