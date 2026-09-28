import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid, rasterizePolygon, type Grid } from '../raster/grid';
import { daySunSamples, solarPosition, sunTimes } from './spa';
import {
  Material, affectedMask, burnCanopy, burnObstacle, emptySurface, horizonAt, horizonProfile, isLeafOn, prepareSamples, sunClass, sunHours,
} from './shade';

const ZONE = { zone: 18, hemisphere: 'N' as const };
const LAT = 42.25, LON = -73.98;

function flat(widthM: number, heightM: number, cell: number, z = 100): Grid {
  return makeGrid({ width: widthM / cell, height: heightM / cell, cell, x0: 580000, y0: 4680000, zone: ZONE }, z);
}

const rect = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

test('§5.7: a wall of height h casts a winter noon shadow of length h / tan(altitude)', () => {
  const g = flat(40, 40, 0.25);
  const s = emptySurface(g);
  const h = 3;
  // East–west wall 0.5 m thick whose north face is 20 m south of the grid's north edge.
  const wallNorthY = 4680000 - 20;
  burnObstacle(s, rasterizePolygon(g, [rect(580000, wallNorthY - 0.5, 580040, wallNorthY)]), h, Material.opaque);
  const noon = sunTimes(new Date(Date.UTC(2026, 11, 21, 12)), LAT, LON).solarNoon;
  const sun = solarPosition(noon, LAT, LON);
  const expected = h / Math.tan((sun.elevation * Math.PI) / 180); // ≈ 6.6 m at 42° N
  const out = sunHours(s, prepareSamples([{ ...sun, time: noon }], { sampleHours: 1 }), { sampleHours: 1, targetHeightM: 0 });
  // Walk north from the wall along the centre column and find where sun returns.
  const col = 80;
  let lit = -1;
  for (let j = Math.round(20 / 0.25) - 3; j >= 0; j--) {
    if (out.data[j * g.width + col]! > 0.5) {
      lit = j;
      break;
    }
  }
  const shadowLen = 4680000 - (lit + 0.5) * 0.25 - wallNorthY;
  assert.ok(Math.abs(shadowLen - expected) < 0.5, `shadow ${shadowLen.toFixed(2)} m, expected ${expected.toFixed(2)} m`);
});

test('open flat ground gets every daylight hour; a shed blocks the bed behind it', () => {
  const g = flat(30, 30, 0.5);
  const s = emptySurface(g);
  const day = new Date(Date.UTC(2026, 11, 21));
  const samples = prepareSamples(daySunSamples(day, LAT, LON, 15), { sampleHours: 0.25 });
  const open = sunHours(s, samples, { sampleHours: 0.25 });
  const daylight = samples.length * 0.25;
  assert.ok(daylight > 8.5 && daylight < 9.5, `Dec daylight ${daylight} h`);
  assert.ok(Math.abs(open.data[30 * 60 + 30]! - daylight) < 1e-6);
  // 10 ft (3 m) shed 2 m south of a bed: the bed's December sun drops sharply (acceptance criterion §14).
  burnObstacle(s, rasterizePolygon(g, [rect(580012, 4679980 - 2, 580018, 4679980 + 2)]), 3.05, Material.opaque);
  const shaded = sunHours(s, samples, { sampleHours: 0.25 });
  const bedK = Math.round((4680000 - (4679982 + 2.5)) / 0.5) * 60 + 30; // 2.5 m north of the shed
  assert.ok(shaded.data[bedK]! < daylight - 3, `bed gets ${shaded.data[bedK]} of ${daylight} h`);
  assert.equal(sunClass(shaded.data[bedK]!), 'shade');
});

test('deciduous canopy passes more light when leaves are off', () => {
  const g = flat(40, 40, 0.5);
  const s = emptySurface(g);
  const canopy = makeGrid({ width: g.width, height: g.height, cell: 0.5, x0: g.x0, y0: g.y0, zone: ZONE }, 0);
  rasterizePolygon(g, [rect(580015, 4679972, 580025, 4679978)], 12, canopy); // 12 m trees south of centre
  burnCanopy(s, canopy, Material.deciduous);
  const day = new Date(Date.UTC(2026, 11, 21));
  const samples = prepareSamples(daySunSamples(day, LAT, LON, 15), { sampleHours: 0.25 });
  const on = sunHours(s, samples, { sampleHours: 0.25, leafOn: true });
  const off = sunHours(s, samples, { sampleHours: 0.25, leafOn: false });
  const k = Math.round((4680000 - 4679988) / 0.5) * g.width + 40;
  assert.ok(off.data[k]! > on.data[k]!, `leaf-off ${off.data[k]} vs leaf-on ${on.data[k]}`);
  assert.equal(isLeafOn(200, 117, 288), true);
  assert.equal(isLeafOn(355, 117, 288), false);
});

test('a bed inside a greenhouse gets film-filtered light, not zero', () => {
  const g = flat(20, 20, 0.5);
  const s = emptySurface(g);
  burnObstacle(s, rasterizePolygon(g, [rect(580005, 4679985, 580015, 4679995)]), 2.5, Material.film);
  const day = new Date(Date.UTC(2026, 5, 21));
  const samples = prepareSamples(daySunSamples(day, LAT, LON, 30), { sampleHours: 0.5 });
  const out = sunHours(s, samples, { sampleHours: 0.5 });
  const inside = out.data[20 * g.width + 20]!;
  const daylight = samples.length * 0.5;
  assert.ok(Math.abs(inside - daylight * 0.8) < 0.01, `${inside} vs ${daylight * 0.8}`);
});

test('far-field horizon from a ridge, including Earth curvature', () => {
  // 20 km × 20 km coarse DEM (100 m cells), flat at 0 with a 300 m ridge 5 km to the south.
  const dem = makeGrid({ width: 200, height: 200, cell: 100, x0: 570000, y0: 4690000, zone: ZONE }, 0);
  for (let i = 0; i < 200; i++) for (let j = 150; j < 152; j++) dem.data[j * 200 + i] = 300;
  const hz = horizonProfile(dem, 580000, 4680000, { eyeHeight: 0 });
  const south = horizonAt(hz, 180);
  const dist = 4680000 - (4690000 - 150.5 * 100);
  const curvature = ((1 - 0.13) * dist * dist) / (2 * 6371000);
  const expected = (Math.atan2(300 - curvature, dist) * 180) / Math.PI;
  assert.ok(Math.abs(south - expected) < 0.35, `south horizon ${south} vs ${expected}`);
  assert.ok(horizonAt(hz, 0) < 0.5, 'north is open');
  // A low winter sun behind the ridge is removed from the samples.
  const kept = prepareSamples([{ ...solarPosition(new Date(), LAT, LON), azimuth: 180, elevation: 2, time: new Date() }], { sampleHours: 1, horizon: hz });
  assert.equal(kept.length, 0);
});

test('incremental recompute of the affected region matches a full recompute', () => {
  const g = flat(40, 40, 0.5);
  const s = emptySurface(g);
  const day = new Date(Date.UTC(2026, 2, 20));
  const samples = prepareSamples(daySunSamples(day, LAT, LON, 20), { sampleHours: 1 / 3 });
  const opts = { sampleHours: 1 / 3 };
  const before = sunHours(s, samples, opts);
  // Place a 4 m greenhouse-sized block; update only the affected cells.
  const bounds: [number, number, number, number] = [580010, 4679970, 580016, 4679976];
  burnObstacle(s, rasterizePolygon(g, [rect(...bounds.slice(0, 2) as [number, number], ...bounds.slice(2) as [number, number])]), 4, Material.opaque);
  const mask = affectedMask(g, bounds, 4, samples);
  const incremental = sunHours(s, samples, { ...opts, mask }, before);
  const full = sunHours(s, samples, opts);
  let maxDiff = 0, touched = 0;
  for (let k = 0; k < full.data.length; k++) {
    maxDiff = Math.max(maxDiff, Math.abs(full.data[k]! - incremental.data[k]!));
    touched += mask[k]!;
  }
  assert.equal(maxDiff, 0);
  assert.ok(touched < full.data.length * 0.5, `recomputed ${touched} of ${full.data.length} cells`);
});
