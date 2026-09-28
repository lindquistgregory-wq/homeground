import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { fromUtm, makeGrid, toUtm } from '@plotwright/core';
import { fromBase64, MemoryCache, toBase64 } from './http';
import { fetchCanopy, fetchDem, lidarAvailability, parcelTerrain, quadkey, solarClimatology, utmBoxFor } from './rasters';
import { testClient } from './testing';

const here = dirname(fileURLToPath(import.meta.url));
const coreFixture = (n: string) => new Uint8Array(readFileSync(join(here, '..', '..', 'core', 'src', 'raster', '__fixtures__', n)));
const fixtureBytes = (n: string) => new Uint8Array(readFileSync(join(here, '__fixtures__', n)));
const inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b));
const ZONE = { zone: 18, hemisphere: 'N' as const };

test('base64 round trip', () => {
  const b = new Uint8Array(Array.from({ length: 1000 }, (_, i) => (i * 37) % 256));
  for (const n of [0, 1, 2, 3, 999, 1000]) assert.deepEqual(fromBase64(toBase64(b.subarray(0, n))), b.subarray(0, n));
});

test('3DEP exportImage DEM is requested in the parcel UTM zone and decoded to a grid', async () => {
  // The 90×70 fixture stands in for the service's TIFF response.
  const { http, calls } = testClient([{ match: /3DEPElevation\/ImageServer\/exportImage/, body: coreFixture('dem_strips_none.tif') }]);
  const box = { zone: ZONE, xmin: 580000, ymin: 4679860, xmax: 580180, ymax: 4680000 };
  const g = await fetchDem(http, box, 2);
  assert.equal(g.width, 90);
  assert.equal(g.height, 70);
  assert.equal(g.cell, 2);
  assert.equal(g.y0, 4680000);
  assert.ok(Number.isNaN(g.data[5 * 90 + 7]!), 'noData → NaN');
  assert.ok(Math.abs(g.data[0]! - 100) < 1e-4);
  const url = decodeURIComponent(calls[0]!.url);
  assert.match(url, /bboxSR=32618&imageSR=32618/);
  assert.match(url, /size=90,70/);
  assert.match(url, /pixelType=F32/);
  // Wrong-size responses are rejected rather than mis-registered.
  await assert.rejects(fetchDem(http, { ...box, xmax: 580200 }, 2), /expected 100×70/);
});

test('lidar availability from TNM Access', async () => {
  const { http } = testClient([{ match: /tnmaccess/, body: { total: 1, items: [{ title: 'USGS 1 Meter 18 x58y468 NY_FEMAR2_Central_2018_D19', publicationDate: '2024-01-04' }] } }]);
  const r = await lidarAvailability(http, { lat: 42.253, lon: -73.9855 });
  assert.equal(r.has1m, true);
  assert.match(r.project!, /NY_FEMAR2/);
  const { http: none } = testClient([{ match: /tnmaccess/, body: { total: 0, items: [] } }]);
  assert.equal((await lidarAvailability(none, { lat: 30, lon: -100 })).has1m, false);
});

test('parcel terrain fetches a fine near grid and a coarse far grid', async () => {
  const sizes: string[] = [];
  const { http } = testClient([
    { match: /tnmaccess/, body: { items: [{ title: 'lidar' }] } },
    {
      match: /exportImage/,
      body: (u: string) => {
        sizes.push(/size=([^&]+)/.exec(decodeURIComponent(u))![1]!);
        return coreFixture('dem_strips_none.tif');
      },
    },
  ]);
  const layer = await parcelTerrain(http, utmBoxFor([-73.987, 42.252, -73.984, 42.254]));
  // The fixture is 90×70, so both requests fail the size check → explicit unavailable, never wrong data.
  assert.equal(layer.status, 'unavailable');
  assert.equal(sizes.length, 2);
  const [nearW] = sizes[0]!.split(',').map(Number);
  assert.ok(nearW! > 400, `near grid is ~1 m (${sizes[0]})`);
  assert.equal(sizes[1], '333,333', 'far grid: 10 km at ~30 m');
});

test('quadkeys match the Bing tile scheme', () => {
  assert.equal(quadkey(-73.9855, 42.253), '0302323123');
  assert.equal(quadkey(0.1, 0.1, 1), '1');
  assert.equal(quadkey(-0.1, -0.1, 1), '2');
});

test('canopy COG: Range reads only, warped onto the parcel UTM grid', async () => {
  const tile = fixtureBytes('chm_tile.tif');
  const meta = JSON.parse(readFileSync(join(here, '__fixtures__', 'chm_tile.json'), 'utf8'));
  const ranges: string[] = [];
  const { http, calls } = testClient([
    { match: new RegExp(`chm/${meta.quadkey}\\.tif$`), body: (_u: string, _b?: string, h?: Record<string, string>) => (ranges.push(h?.Range ?? 'none'), tile) },
  ]);
  const c = toUtm(42.253, -73.9855);
  const target = makeGrid({ width: 40, height: 40, cell: 5, x0: c.easting - 100, y0: c.northing + 100, zone: ZONE }, 0);
  const g = await fetchCanopy(http, target, inflate);
  assert.ok(ranges.every((r) => r.startsWith('bytes=')), 'every request is a byte range');
  assert.ok(calls.length >= 1);
  // Check a cell against the synthetic pattern: value = (7·col + 3·row) mod 40 in tile pixels.
  const ll = fromUtm(target.x0 + 20.5 * 5, target.y0 - 20.5 * 5, ZONE);
  const R = 6378137;
  const mx = (R * ll.lon * Math.PI) / 180, my = R * Math.log(Math.tan(Math.PI / 4 + (ll.lat * Math.PI) / 360));
  const col = Math.floor((mx - meta.x0) / meta.scale), row = Math.floor((meta.y0 - my) / meta.scale);
  assert.equal(g.data[20 * 40 + 20], (col * 7 + row * 3) % 40);
  assert.ok(g.data.every((v) => !Number.isNaN(v)));
});

test('NASA POWER climatology: snaps to the 0.5° grid; rejects missing values', async () => {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const vals = [1.9, 2.8, 3.8, 4.7, 5.4, 5.9, 6.0, 5.2, 4.2, 2.9, 1.8, 1.5];
  const param = Object.fromEntries([...months.map((m, i) => [m, vals[i]!]), ['ANN', 3.84]]);
  const { http, calls } = testClient([{ match: /power\.larc\.nasa\.gov/, body: { properties: { parameter: { ALLSKY_SFC_SW_DWN: param } } } }]);
  const r = await solarClimatology(http, { lat: 42.253, lon: -73.9855 });
  assert.equal(r.status === 'ok' && r.value.ghi[5], 5.9);
  assert.match(calls[0]!.url, /latitude=42\.5&longitude=-74/);
  const { http: bad } = testClient([{ match: /power/, body: { properties: { parameter: { ALLSKY_SFC_SW_DWN: { ...param, JUN: -999 } } } } }]);
  assert.equal((await solarClimatology(bad, { lat: 42.2, lon: -74 })).status, 'unavailable');
  void MemoryCache;
});
