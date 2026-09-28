import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaM2, type Polygon } from '@homeground/core';
import { bundledParcelRegistry, type ParcelEndpoint } from '@homeground/data';
import { geocode, geocodeCensus, reverseCensus } from './geocode';
import {
  endpointsFor, esriRingsToGeoJson, findParcel, mergeRegistries, normalizeLayerUrl, sanitizeAttributes, validateUserEndpoint,
} from './parcel/arcgis';
import { parcelElevation, pointElevation } from './elevation';
import { hardinessZone, zoneRangeF } from './hardiness';
import { parseStationSearch, parcelClimate } from './climate';
import { buildSoilUnits, parcelSoils, parseSdaTable, toWkt } from './soils';
import { parcelFlood, parcelWater, summarizeFlood } from './hazards';
import { fixture, testClient } from './testing';

const LOT: Polygon = {
  type: 'Polygon',
  coordinates: [[[-73.987, 42.252], [-73.984, 42.252], [-73.984, 42.254], [-73.987, 42.254], [-73.987, 42.252]]],
};

// ---------- geocoding ----------

test('Census address geocode (recorded response)', async () => {
  const { http, calls } = testClient([{ match: /onelineaddress/, body: fixture('census-address.json') }]);
  const [r] = await geocodeCensus(http, '4600 Silver Hill Rd, Washington, DC 20233');
  assert.equal(r!.countyFips, '24033');
  assert.equal(r!.zip, '20233');
  assert.ok(Math.abs(r!.lat - 38.845053) < 1e-5);
  assert.match(calls[0]!.url, /benchmark=Public_AR_Current/);
});

test('Census reverse lookup finds county FIPS and ZCTA (recorded response)', async () => {
  const { http } = testClient([{ match: /geographies\/coordinates/, body: fixture('census-coordinates-catskill.json') }]);
  const p = await reverseCensus(http, 42.2528, -73.9857);
  assert.deepEqual(p, { countyFips: '36039', countyName: 'Greene County', stateFips: '36', zcta: '12413' });
});

test('geocode falls back to Nominatim when Census finds nothing', async () => {
  const { http, calls } = testClient([
    { match: /onelineaddress/, body: { result: { addressMatches: [] } } },
    { match: /nominatim/, body: [{ lat: '51.5', lon: '-0.12', display_name: 'London', addresstype: 'city' }] },
  ]);
  const r = await geocode(http, 'London');
  assert.equal(r[0]!.source, 'nominatim');
  assert.equal(r[0]!.accuracy, 'place');
  assert.equal(calls.length, 2);
  assert.deepEqual(await geocode(http, 'ab'), [], 'too short: no request');
});

// ---------- parcels ----------

const esriParcel = (attrs: Record<string, unknown>) => ({
  features: [{
    attributes: attrs,
    geometry: {
      // Outer ring clockwise (Esri convention) + counter-clockwise hole.
      rings: [
        [[-73.987, 42.252], [-73.987, 42.254], [-73.984, 42.254], [-73.984, 42.252], [-73.987, 42.252]],
        [[-73.986, 42.2525], [-73.985, 42.2525], [-73.985, 42.2530], [-73.986, 42.2530], [-73.986, 42.2525]],
      ],
    },
  }],
});

test('Esri rings → GeoJSON with holes; CCW-only shells tolerated', () => {
  const g = esriRingsToGeoJson(esriParcel({}).features[0]!.geometry.rings) as Polygon;
  assert.equal(g.type, 'Polygon');
  assert.equal(g.coordinates.length, 2);
  const ccwOnly = esriRingsToGeoJson([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);
  assert.equal(ccwOnly?.type, 'Polygon');
});

test('parcel lookup requests only id/acres fields and strips anything else', async () => {
  const { http, calls } = testClient([
    { match: /NYS_Tax_Parcels_Public\/MapServer\/1\/query/, body: esriParcel({ PRINT_KEY: '123.-4-5', ACRES: 11.2, PRIMARY_OWNER: 'Jane Doe', MAIL_ADDR: '1 Main' }) },
  ]);
  const r = await findParcel(http, bundledParcelRegistry, '36039', { lat: 42.253, lon: -73.9865 });
  const c = r.candidates[0]!;
  assert.equal(c.parcelId, '123.-4-5');
  assert.equal(c.publishedAcres, 11.2);
  assert.equal(c.containsPoint, true);
  assert.equal(c.displayOnly, true);
  assert.ok(!JSON.stringify(c).includes('Jane'), 'owner name must never be stored');
  const outFields = decodeURIComponent(/outFields=([^&]+)/.exec(calls[0]!.url)![1]!);
  assert.equal(outFields, 'PRINT_KEY,ACRES');
});

test('sanitizeAttributes drops PII-looking fields even when allow-listed', () => {
  assert.deepEqual(sanitizeAttributes({ OWNER_NAME: 'x', PIN: '1', SITEADRESS: 'y' }, ['OWNER_NAME', 'PIN', 'SITEADRESS']), { PIN: '1' });
});

test('no endpoint for the county → empty result, user draws instead', async () => {
  const { http } = testClient([]);
  const r = await findParcel(http, bundledParcelRegistry, '48201', { lat: 29.7, lon: -95.4 });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.tried.length, 0);
});

test('a failing endpoint is recorded and the next one is tried', async () => {
  const county: ParcelEndpoint = { ...bundledParcelRegistry.endpoints[0]!, id: 'county-first', url: 'https://county.gov/arcgis/rest/services/P/MapServer/0', coverage: { stateFips: '36', countyFips: ['36039'] } };
  const { http } = testClient([
    { match: /county\.gov/, status: 500, body: '' },
    { match: /NYS_Tax_Parcels_Public/, body: esriParcel({ PRINT_KEY: 'A' }) },
  ]);
  const r = await findParcel(http, bundledParcelRegistry, '36039', { lat: 42.253, lon: -73.9865 }, [county]);
  assert.equal(r.tried[0]!.endpointId, 'county-first');
  assert.equal(r.tried[0]!.ok, false);
  assert.equal(r.candidates[0]!.endpointId, 'ny-statewide-public');
});

test('registry: county-specific before statewide; remote entries override by date', () => {
  const county: ParcelEndpoint = { ...bundledParcelRegistry.endpoints[0]!, id: 'greene', coverage: { stateFips: '36', countyFips: ['36039'] } };
  assert.deepEqual(endpointsFor(bundledParcelRegistry, '36039', [county]).map((e) => e.id), ['greene', 'ny-statewide-public']);
  const merged = mergeRegistries(bundledParcelRegistry, {
    version: 2, updatedAt: '2027-01-01',
    endpoints: [{ ...bundledParcelRegistry.endpoints[0]!, url: 'https://new.example/MapServer/1', verifiedAt: '2027-01-01' }],
  });
  assert.equal(merged.endpoints.find((e) => e.id === 'ny-statewide-public')!.url, 'https://new.example/MapServer/1');
});

test('user-contributed endpoint is validated on-device', async () => {
  assert.equal(normalizeLayerUrl('https://gis.county.gov/arcgis/rest/services/Parcels/FeatureServer/0/query?where=1=1'), 'https://gis.county.gov/arcgis/rest/services/Parcels/FeatureServer/0');
  assert.equal(normalizeLayerUrl('http://insecure/MapServer/0'), null);

  const { http } = testClient([
    { match: /FeatureServer\/0\?f=json/, body: { name: 'Parcels', geometryType: 'esriGeometryPolygon', capabilities: 'Query', fields: [{ name: 'OWNER_NAME' }, { name: 'PARCEL_ID' }, { name: 'GIS_ACRES' }] } },
    { match: /FeatureServer\/0\/query/, body: esriParcel({ PARCEL_ID: 'X9', GIS_ACRES: 2 }) },
  ]);
  const v = await validateUserEndpoint(http, 'https://gis.county.gov/arcgis/rest/services/Parcels/FeatureServer/0', '36039', { lat: 42.253, lon: -73.9865 });
  assert.equal(v.ok, true);
  assert.equal(v.suggested!.idField, 'PARCEL_ID');
  assert.equal(v.suggested!.acresField, 'GIS_ACRES');
  assert.equal(v.suggested!.origin, 'user');
  assert.equal(v.sample!.parcelId, 'X9');

  const { http: http2 } = testClient([{ match: /\?f=json/, body: { geometryType: 'esriGeometryPoint', capabilities: 'Query' } }]);
  const bad = await validateUserEndpoint(http2, 'https://x.gov/a/MapServer/3', '36039', { lat: 42, lon: -74 });
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0]!, /polygons/);
});

// ---------- elevation ----------

test('EPQS point elevation (recorded) and no-data handling', async () => {
  const { http } = testClient([{ match: /epqs/, body: fixture('epqs-catskill.json') }]);
  const e = await pointElevation(http, { lat: 42.2528, lon: -73.9857 });
  assert.ok(Math.abs(e!.elevationM - 208.3556) < 1e-3);
  assert.equal(e!.resolutionM, 1);
  const { http: sea } = testClient([{ match: /epqs/, body: { value: '-1000000' } }]);
  assert.equal(await pointElevation(sea, { lat: 40, lon: -70 }), null);
  const layer = await parcelElevation(sea, LOT);
  assert.equal(layer.status, 'unavailable');
});

test('parcel elevation summarises 5 samples with attribution', async () => {
  let i = 0;
  const { http } = testClient([{ match: /epqs/, body: '' }]);
  // Replace body per call to vary elevation.
  const { http: varied } = testClient([{ match: (u) => /epqs/.test(u) && (i++, true), body: { value: '200', resolution: 1 } }]);
  const layer = await parcelElevation(varied, LOT);
  assert.equal(layer.status, 'ok');
  if (layer.status === 'ok') {
    assert.equal(layer.value.samples, 5);
    assert.equal(layer.attribution.confidence, 'high');
    assert.match(layer.attribution.source, /3DEP/);
  }
  void http;
});

// ---------- hardiness ----------

test('hardiness: bundled table first, then phzmapi, then unavailable', async () => {
  assert.deepEqual(zoneRangeF('6b'), [-5, 0]);
  assert.deepEqual(zoneRangeF('1a'), [-60, -55]);
  assert.deepEqual(zoneRangeF('13b'), [65, 70]);
  const { http, calls } = testClient([{ match: /phzmapi\.org\/12413\.json/, body: fixture('phzmapi-12413.json') }]);
  const bundled = await hardinessZone(http, '12601', { '12601': '6b' });
  assert.equal(bundled.status === 'ok' && bundled.value.zone, '6b');
  assert.equal(calls.length, 0);
  const remote = await hardinessZone(http, '12413');
  assert.equal(remote.status === 'ok' && remote.value.zone, '6a');
  assert.equal((await hardinessZone(http, undefined)).status, 'unavailable');
});

// ---------- climate ----------

const NCEI_SEARCH = {
  count: 2,
  results: [
    { filePath: '/data/normals-annualseasonal/1991-2020/access/USC00304025.csv', boundingPoints: [{ coordinates: [-73.7922, 42.2475], type: 'point' }], stations: [{ dataTypes: [] }] },
    { filePath: '/data/normals-annualseasonal/1991-2020/access/US1NYGR0001.csv', stations: [{ id: 'US1NYGR0001', coordinates: [-74.0, 42.3] }] },
  ],
};

test('parses NCEI search results from filePath/boundingPoints or station objects', () => {
  assert.deepEqual(parseStationSearch(NCEI_SEARCH), [
    { id: 'USC00304025', lon: -73.7922, lat: 42.2475 },
    { id: 'US1NYGR0001', lon: -74.0, lat: 42.3 },
  ]);
});

test('parcel climate: search → data → elevation-adjusted frost dates', async () => {
  const { http, calls } = testClient([
    { match: /search\/v1\/data/, body: NCEI_SEARCH },
    {
      match: /services\/data\/v1/,
      body: [
        { STATION: 'USC00304025', NAME: 'HUDSON CORRECTIONAL FACILITY, NY US', LATITUDE: ' 42.2475', LONGITUDE: ' -73.7922', ELEVATION: '   9.1',
          'ANN-TMIN-PRBLST-T32FP50': '   04/25', 'ANN-TMIN-PRBFST-T32FP50': '   10/18', 'DJF-TMIN-NORMAL': '17.5', 'MAM-TMIN-NORMAL': '37.4', 'JJA-TMIN-NORMAL': '59.9', 'SON-TMIN-NORMAL': '41.5', 'ANN-TMIN-NORMAL': '39.1' },
        { STATION: 'US1NYGR0001', LATITUDE: '42.3', LONGITUDE: '-74.0', ELEVATION: '100' }, // precip-only station
      ],
    },
  ]);
  const layer = await parcelClimate(http, { lat: 42.2528, lon: -73.9857, elevationM: 208.4 });
  assert.equal(layer.status, 'ok');
  if (layer.status !== 'ok') return;
  const f = layer.value.frost;
  assert.equal(f.stations.length, 1);
  assert.ok(f.dates.lastSpring[32][50]! > 115, 'higher than station → later than Apr 25');
  assert.equal(layer.attribution.basis, 'modeled');
  assert.ok(layer.attribution.notes!.some((n) => /199 m higher/.test(n)));
  assert.match(calls[1]!.url, /includeStationLocation=1/);
  assert.match(calls[1]!.url, /stations=US1NYGR0001%2CUSC00304025/);
  const noElev = await parcelClimate(http, { lat: 42, lon: -74, elevationM: null });
  assert.equal(noElev.status, 'unavailable');
});

// ---------- soils ----------

const SDA_AREAS = { Table: [['mukey', 'area_m2'], ['289001', '60000'], ['289002', '20000']] };
const SDA_PROPS = {
  Table: [
    ['mukey', 'musym', 'muname', 'farmlndcl', 'drclassdcd', 'hydgrpdcd', 'aws0150wta', 'hydclprs', 'compname', 'comppct_r', 'hzdept_r', 'ph1to1h2o_r', 'om_r', 'texdesc'],
    ['289001', 'HoB', 'Hoosic gravelly loam, 3 to 8 percent slopes', 'All areas are prime farmland', 'Somewhat excessively drained', 'A', '9.1', '0', 'Hoosic', '85', '0', '5.6', '3', 'Gravelly loam'],
    ['289002', 'Wy', 'Wayland silt loam', 'Not prime farmland', 'Very poorly drained', 'C/D', '26.4', '95', 'Wayland', '90', '0', '6.4', '8', 'Silt loam'],
  ],
};

test('WKT and SDA table parsing', () => {
  assert.match(toWkt(LOT), /^POLYGON \(\(-73\.9870000 42\.2520000, /);
  assert.deepEqual(parseSdaTable({ Table: [['A', 'b'], ['1', null]] }), [{ a: '1', b: null }]);
  const units = buildSoilUnits([{ mukey: '289001', areaM2: 60000 }, { mukey: '289002', areaM2: 20000 }], parseSdaTable(SDA_PROPS));
  assert.equal(units[0]!.percentOfParcel, 75);
  assert.equal(units[1]!.hydricPercent, 95);
  assert.equal(units[0]!.surface?.pH, 5.6);
});

test('soils: macro query with areas, falls back to mukey list on SDA error', async () => {
  const isMacro = (_u: string, b?: string) => !!b && b.includes('GetClippedMapunits');
  const isFallback = (_u: string, b?: string) => !!b && b.includes('SDA_Get_Mukey_from_intersection');
  const isProps = (_u: string, b?: string) => !!b && b.includes('FROM mapunit');

  const ok = testClient([{ match: isMacro, body: SDA_AREAS }, { match: isProps, body: SDA_PROPS }]);
  const layer = await parcelSoils(ok.http, LOT);
  assert.equal(layer.status === 'ok' && layer.value.areasComputed, true);
  assert.equal(ok.calls[0]!.method, 'POST');
  assert.equal(JSON.parse(ok.calls[0]!.body!).format, 'JSON+COLUMNNAME');

  const fb = testClient([
    { match: isMacro, status: 400, body: 'Invalid query' },
    { match: isFallback, body: { Table: [['mukey'], ['289001']] } },
    { match: isProps, body: SDA_PROPS },
  ]);
  const layer2 = await parcelSoils(fb.http, LOT);
  assert.equal(layer2.status, 'ok');
  if (layer2.status === 'ok') {
    assert.equal(layer2.value.areasComputed, false);
    assert.equal(layer2.value.units[0]!.percentOfParcel, undefined);
  }
});

// ---------- flood & water ----------

test('flood zones summarised; SFHA detected', async () => {
  const s = summarizeFlood([{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T', STATIC_BFE: 112 } }, { attributes: { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999 } }]);
  assert.equal(s.inSpecialFloodHazardArea, true);
  assert.equal(s.zones[1]!.staticBfeFt, undefined);
  assert.match(s.headline, /high-risk.*AE/);
  const none = summarizeFlood([]);
  assert.match(none.headline, /unmapped/);

  const { http, calls } = testClient([{ match: /NFHL\/MapServer\/28\/query/, body: { features: [{ attributes: { FLD_ZONE: 'X', SFHA_TF: 'F' } }] } }]);
  const layer = await parcelFlood(http, LOT);
  assert.equal(layer.status === 'ok' && layer.value.inSpecialFloodHazardArea, false);
  assert.equal(calls[0]!.method, 'POST');
  assert.match(calls[0]!.body!, /geometryType=esriGeometryPolygon/);
});

test('water features sorted by distance', async () => {
  const { http } = testClient([
    { match: /nhd\/MapServer\/6\/query/, body: { features: [{ attributes: { GNIS_NAME: 'Catskill Creek', FTYPE: 558 }, geometry: { paths: [[[-73.990, 42.250], [-73.990, 42.256]]] } }] } },
    { match: /nhd\/MapServer\/12\/query/, body: { features: [{ attributes: { gnis_name: null }, geometry: { rings: [[[-73.9856, 42.2531], [-73.9854, 42.2531], [-73.9854, 42.2529], [-73.9856, 42.2529], [-73.9856, 42.2531]]] } }] } },
  ]);
  const layer = await parcelWater(http, LOT);
  assert.equal(layer.status, 'ok');
  if (layer.status !== 'ok') return;
  assert.equal(layer.value.features.length, 2);
  assert.equal(layer.value.nearest!.kind, 'waterbody');
  assert.equal(layer.value.features[1]!.name, 'Catskill Creek');
  assert.ok(Math.abs(layer.value.features[1]!.distanceM - 372) < 5, `creek distance ${layer.value.features[1]!.distanceM}`);
  assert.ok(areaM2(LOT) > 0);
});
