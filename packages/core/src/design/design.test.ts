import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localFrame, project } from '../geo/measure';
import type { Polygon } from '../geo/types';
import { makeGrid } from '../raster/grid';
import { coldAirPoolingIndex, contours, flowAccumulation, frostPocketShiftDays, slopeAspect, traceContour } from '../raster/terrain';
import { emptySurface, prepareSamples, sunHours } from '../sun/shade';
import { daySunSamples } from '../sun/spa';
import { beamRatio, estimatePv, extraterrestrialDaily, planeOfArray } from '../sun/pv';
import { OBJECT_LIBRARY, objectType } from './library';
import {
  burnDesign, footprintAreaM2, footprintUtm, materialList, newObject, snapRotationToBoundary, snapToContour, validateDesign, type DesignObject,
} from './design';
import { designToDXF, designToGeoJSON, designToKML, designToSVG } from './export';
import { siteSuitability } from './siting';
import { parseDxf, parseGeoJson, parseKml } from '../boundary/import';

const ZONE = { zone: 18, hemisphere: 'N' as const };
const LOT: Polygon = { type: 'Polygon', coordinates: [[[-73.987, 42.252], [-73.984, 42.252], [-73.984, 42.254], [-73.987, 42.254], [-73.987, 42.252]]] };
const frame = localFrame({ lat: 42.253, lon: -73.9855 });

/** DEM in the parcel frame: plane rising 0.1 m per metre toward the north, with a 3 m hollow. */
function slopedDem() {
  const [cx, cy] = project(frame, [-73.9855, 42.253]);
  const g = makeGrid({ width: 200, height: 200, cell: 1, x0: cx - 100, y0: cy + 100, zone: frame.zone }, 0);
  for (let j = 0; j < 200; j++)
    for (let i = 0; i < 200; i++) {
      const northing = 100 - j;
      const hollow = 3 * Math.exp(-((i - 50) ** 2 + (j - 150) ** 2) / 200);
      g.data[j * 200 + i] = 200 + 0.1 * northing - hollow;
    }
  return { g, cx, cy };
}

test('library covers every §6 category with sane dimensions', () => {
  const cats = new Set(OBJECT_LIBRARY.map((o) => o.category));
  for (const c of ['growing', 'structure', 'animals', 'water-soil', 'energy-utility', 'trees']) assert.ok(cats.has(c as never), c);
  assert.ok(OBJECT_LIBRARY.every((o) => o.width > 0 && o.length > 0 && o.height >= 0));
  assert.equal(new Set(OBJECT_LIBRARY.map((o) => o.kind)).size, OBJECT_LIBRARY.length, 'kinds are unique');
});

test('footprints: rotated rectangle keeps its area; circle ≈ πr²', () => {
  const bed = { ...newObject('raised-bed', { lat: 42.253, lon: -73.9855 }, 'a'), rotationDeg: 33 };
  assert.ok(Math.abs(footprintAreaM2(bed, frame) - 1.2 * 2.4) < 1e-3);
  const tree = newObject('fruit-tree-semi', { lat: 42.253, lon: -73.9855 }, 'b');
  assert.ok(Math.abs(footprintAreaM2(tree, frame) - Math.PI * 2.25 ** 2) / (Math.PI * 2.25 ** 2) < 0.02);
  // Length axis along the rotation: a 90° bed is 2.4 m wide east–west.
  const r = footprintUtm({ ...bed, rotationDeg: 90 }, frame);
  const xs = r.map((p) => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 2.4) < 0.03, 'about 2.4 m east–west (grid convergence tilts it slightly)');
});

test('validation: outside boundary, setback, steep slope, overlap', () => {
  const { g } = slopedDem();
  for (let k = 0; k < g.data.length; k++) g.data[k] = g.data[k]! + ((k % 200) > 150 ? (k % 200 - 150) * 0.5 : 0); // steep east edge
  const { slope } = slopeAspect(g);
  const shedA: DesignObject = newObject('tool-shed', { lat: 42.2530, lon: -73.9855 }, 'shedA');
  const shedB: DesignObject = newObject('potting-shed', { lat: 42.25301, lon: -73.98551 }, 'shedB');
  const nearEdge: DesignObject = newObject('chicken-coop', { lat: 42.25202, lon: -73.9855 }, 'coop'); // ~2 m from the south line
  const outside: DesignObject = newObject('raised-bed', { lat: 42.2519, lon: -73.9855 }, 'out');
  const onSlope: DesignObject = newObject('barn', { lat: 42.2530, lon: -73.98475 }, 'barn');
  const w = validateDesign([shedA, shedB, nearEdge, outside, onSlope], { boundary: LOT, setbackM: 3, slope }, frame);
  const kinds = (id: string) => w.filter((x) => x.objectId === id).map((x) => x.kind);
  assert.deepEqual(kinds('out'), ['outside-boundary']);
  assert.ok(kinds('coop').includes('setback'));
  assert.ok(kinds('shedB').includes('overlap'));
  assert.ok(kinds('barn').includes('steep-slope'), JSON.stringify(w));
  assert.equal(kinds('shedA').length, 0);
});

test('snapping: rotation to boundary edges; swale follows the contour', () => {
  assert.equal(snapRotationToBoundary(3, LOT, frame), 0);
  assert.equal(snapRotationToBoundary(88, LOT, frame), 90);
  assert.equal(snapRotationToBoundary(45, LOT, frame), 45);
  const { g } = slopedDem();
  const swale = snapToContour(newObject('swale', { lat: 42.2530, lon: -73.9855 }, 's'), g, frame);
  const ys = swale.path!.map((p) => project(frame, p)[1]);
  assert.ok(swale.path!.length > 10);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.3, 'a contour on a north-rising plane runs east–west');
});

test('terrain: slope/aspect of a plane, contours, flow accumulation, frost pockets', () => {
  const { g } = slopedDem();
  const { slope, aspect } = slopeAspect(g);
  const k = 20 * 200 + 150; // far from the hollow
  assert.ok(Math.abs(slope.data[k]! - (Math.atan(0.1) * 180) / Math.PI) < 0.01);
  assert.ok(Math.abs(aspect.data[k]! - 180) < 0.5, 'rising to the north → faces south');
  const lines = contours(g, 2);
  assert.ok(lines.filter((l) => l.points.length > 100).length >= 9, 'one long east–west line per 2 m level');
  const acc = flowAccumulation(g);
  assert.ok(acc.data[150 * 200 + 50]! > acc.data[20 * 200 + 150]!, 'the hollow collects flow');
  const pool = coldAirPoolingIndex(g, 20);
  assert.ok(pool.data[150 * 200 + 50]! > 1.5, 'hollow detected as a frost pocket');
  assert.ok(Math.abs(pool.data[20 * 200 + 150]!) < 0.1);
  assert.equal(frostPocketShiftDays(pool.data[150 * 200 + 50]!), Math.min(14, Math.round(pool.data[150 * 200 + 50]! * 1.5)));
  assert.equal(frostPocketShiftDays(0.2), 0);
  assert.ok(traceContour(g, 0, 0, 5).length >= 1);
});

test('placing a shed south of a bed lowers its December sun (§14 acceptance)', () => {
  const [cx, cy] = project(frame, [-73.9855, 42.253]);
  const g = makeGrid({ width: 60, height: 60, cell: 0.5, x0: cx - 15, y0: cy + 15, zone: ZONE }, 100);
  const samples = prepareSamples(daySunSamples(new Date(Date.UTC(2026, 11, 21)), 42.253, -73.9855, 15), { sampleHours: 0.25 });
  const before = sunHours(emptySurface(g), samples, { sampleHours: 0.25 });
  const s = emptySurface(g);
  const [lon, lat] = [-73.9855, 42.253 - 3 / 111_000]; // shed centre 3 m south of the bed
  burnDesign(s, [newObject('tool-shed', { lat, lon }, 'shed')], frame);
  const after = sunHours(s, samples, { sampleHours: 0.25 });
  const bed = 30 * 60 + 30;
  assert.ok(after.data[bed]! < before.data[bed]! - 2, `${before.data[bed]} → ${after.data[bed]}`);
});

test('exports round-trip through our own importers; SVG has scale bar and north arrow', () => {
  const d = { id: 'd', parcelId: 'p', name: 'Plan A', createdAt: '', updatedAt: '', objects: [newObject('raised-bed', { lat: 42.253, lon: -73.9855 }, 'a'), newObject('greenhouse-hoop', { lat: 42.2533, lon: -73.9852 }, 'b')] };
  const gj = parseGeoJson(designToGeoJSON(d, LOT, frame, { includeBoundary: true }));
  assert.equal(gj.geometry?.type, 'MultiPolygon');
  const noBoundary = JSON.parse(designToGeoJSON(d, LOT, frame, { includeBoundary: false }));
  assert.equal(noBoundary.features.length, 2);
  assert.equal(parseKml(designToKML(d, LOT, frame, { includeBoundary: false })).rawPolygons.length, 2);
  const dxf = parseDxf(designToDXF(d, LOT, frame, { includeBoundary: true }).split('\n').slice(2).join('\n'));
  assert.equal(dxf.rawPolygons.length, 3);
  assert.equal(dxf.crsHint, 'Drawing units: metres');
  const svg = designToSVG(d, LOT, frame, { units: 'imperial' });
  assert.match(svg, /<svg[\s\S]*>N<\/text>[\s\S]*ft<\/text>/);
  const ml = materialList(d.objects, frame);
  assert.deepEqual(ml.map((m) => m.count), [1, 1]);
});

test('siting: greenhouse prefers winter sun, avoids the frost pocket', () => {
  const { g } = slopedDem();
  const mask = makeGrid({ width: 200, height: 200, cell: 1, x0: g.x0, y0: g.y0, zone: ZONE }, 1);
  const winterSun = makeGrid({ width: 200, height: 200, cell: 1, x0: g.x0, y0: g.y0, zone: ZONE }, 6);
  for (let k = 0; k < winterSun.data.length; k++) if (k % 200 < 20) winterSun.data[k] = 1; // shaded west strip
  const r = siteSuitability('greenhouse', { parcelMask: mask, winterSun, slope: slopeAspect(g).slope, pooling: coldAirPoolingIndex(g, 20) });
  const open = r.score.data[20 * 200 + 150]!, shaded = r.score.data[20 * 200 + 10]!, hollow = r.score.data[150 * 200 + 50]!;
  assert.ok(open > shaded && open > hollow, `${open} ${shaded} ${hollow}`);
  assert.ok(r.factors.includes('Winter sun (more is better)'));
});

test('PV: flat plane equals GHI; south tilt boosts winter; sanity of annual yield', () => {
  const ghi = [1.9, 2.8, 3.8, 4.7, 5.4, 5.9, 6.0, 5.2, 4.2, 2.9, 1.8, 1.5]; // NY-like kWh/m²/day
  const flat = planeOfArray(42.25, { ghi }, 0, 180);
  flat.monthly.forEach((v, m) => assert.ok(Math.abs(v - ghi[m]!) < 1e-9));
  const tilted = planeOfArray(42.25, { ghi }, 40, 180);
  assert.ok(tilted.monthly[11]! > ghi[11]! * 1.4, 'December gain on a steep south tilt');
  assert.ok(beamRatio(42.25, 172, 0, 180) === 1);
  assert.ok(extraterrestrialDaily(42.25, 172) > 11 && extraterrestrialDaily(42.25, 172) < 12.5);
  const pv = estimatePv(42.25, { ghi }, 5, 35, 180);
  const specific = pv.annualKWh / 5;
  assert.ok(specific > 1100 && specific < 1450, `${specific.toFixed(0)} kWh/kWp/yr`); // PVWatts gives ≈1250–1300 for Albany
  const north = estimatePv(42.25, { ghi }, 5, 35, 0);
  assert.ok(north.annualKWh < pv.annualKWh * 0.75);
  assert.ok(objectType('solar-array'));
});

test('existing buildings use their traced polygon footprint', () => {
  const b = newObject('building', { lat: 42.2530, lon: -73.9860 }, 'b1');
  b.polygon = [[-73.9861, 42.2529], [-73.9859, 42.2529], [-73.9859, 42.2531], [-73.9861, 42.2531]];
  const frame = localFrame({ lat: 42.253, lon: -73.986 });
  const ring = footprintUtm(b, frame);
  assert.equal(ring.length, 5, 'ring is closed');
  const area = footprintAreaM2(b, frame);
  assert.ok(area > 350 && area < 400, `area ${area}`); // ≈16.5 m × 22.2 m
});
