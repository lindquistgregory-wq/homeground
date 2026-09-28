import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Polygon } from '@plotwright/core';
import { MemoryCache } from './http';
import { buildSiteProfile } from './siteProfile';
import { fixture, testClient, type Route } from './testing';

const LOT: Polygon = {
  type: 'Polygon',
  coordinates: [[[-73.987, 42.252], [-73.984, 42.252], [-73.984, 42.254], [-73.987, 42.254], [-73.987, 42.252]]],
};

function allServices(overrides: Partial<Record<string, Route>> = {}): Route[] {
  const base: Record<string, Route> = {
    census: { match: /geographies\/coordinates/, body: fixture('census-coordinates-catskill.json') },
    epqs: { match: /epqs/, body: fixture('epqs-catskill.json') },
    phzm: { match: /phzmapi/, body: fixture('phzmapi-12413.json') },
    search: {
      match: /search\/v1\/data/,
      body: { results: [{ filePath: '/x/USC00304025.csv', boundingPoints: [{ coordinates: [-73.7922, 42.2475] }] }] },
    },
    normals: {
      match: /services\/data\/v1/,
      body: [{ STATION: 'USC00304025', LATITUDE: '42.2475', LONGITUDE: '-73.7922', ELEVATION: '9.1', 'ANN-TMIN-PRBLST-T32FP50': '04/25', 'ANN-TMIN-PRBFST-T32FP50': '10/18', 'ANN-TMIN-NORMAL': '39' }],
    },
    sdaMacro: { match: (_u, b) => !!b?.includes('GetClippedMapunits'), body: { Table: [['mukey', 'area_m2'], ['1', '100']] } },
    sdaProps: { match: (_u, b) => !!b?.includes('FROM mapunit'), body: { Table: [['mukey', 'muname'], ['1', 'Test loam']] } },
    nfhl: { match: /NFHL/, body: { features: [{ attributes: { FLD_ZONE: 'X', SFHA_TF: 'F' } }] } },
    nhd: { match: /nhd\/MapServer/, body: { features: [] } },
  };
  return Object.values({ ...base, ...overrides }).filter((r): r is Route => !!r);
}

test('builds a complete Site Profile from all Phase 1 layers', async () => {
  const { http } = testClient(allServices());
  const progress: string[] = [];
  const p = await buildSiteProfile({ http }, LOT, {}, (layer, status) => status === 'done' && progress.push(layer));
  assert.equal(p.place.countyFips, '36039');
  for (const k of ['elevation', 'hardiness', 'climate', 'soils', 'flood', 'water'] as const) assert.equal(p[k].status, 'ok', k);
  assert.ok(p.areaM2 > 40_000 && p.areaM2 < 60_000);
  assert.equal(p.hardiness.status === 'ok' && p.hardiness.value.zip, '12413');
  assert.ok(progress.includes('climate') && progress.includes('soils'));
  assert.match(p.imagery.attribution, /USGS/);
});

test('one failing service yields an explicit unavailable layer, not a failed profile', async () => {
  const { http } = testClient(allServices({ nfhl: { match: /NFHL/, status: 503, body: '' } }));
  const p = await buildSiteProfile({ http }, LOT);
  assert.equal(p.flood.status, 'unavailable');
  if (p.flood.status === 'unavailable') {
    assert.equal(p.flood.retryable, true);
    assert.match(p.flood.reason, /unreachable/);
  }
  assert.equal(p.soils.status, 'ok');
});

test('elevation outage cascades into an explained climate outage', async () => {
  const { http } = testClient(allServices({ epqs: { match: /epqs/, body: { value: '-1000000' } } }));
  const p = await buildSiteProfile({ http }, LOT);
  assert.equal(p.elevation.status, 'unavailable');
  assert.equal(p.climate.status, 'unavailable');
  if (p.climate.status === 'unavailable') assert.match(p.climate.reason, /elevation/);
});

test('second build is served entirely from the on-device cache', async () => {
  const cache = new MemoryCache();
  const { http, calls } = testClient(allServices(), { cache });
  await buildSiteProfile({ http }, LOT);
  const n = calls.length;
  const again = await buildSiteProfile({ http }, LOT);
  assert.equal(calls.length, n, 'no network calls on the cached run');
  assert.equal(again.soils.status, 'ok');
});

test('known county/ZIP from address geocoding skip the reverse lookup', async () => {
  const { http, calls } = testClient(allServices());
  await buildSiteProfile({ http }, LOT, { countyFips: '36039', zip: '12413' });
  assert.ok(!calls.some((c) => /geographies\/coordinates/.test(c.url)));
});
