import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humidityClimatology, nwsForecast, parseWindMph } from './weather';
import { testClient } from './testing';

// Synthetic, in the documented api.weather.gov shape (the authoring environment could not reach NWS).
const POINTS = { properties: { forecast: 'https://api.weather.gov/gridpoints/ALY/53,48/forecast', timeZone: 'America/New_York', relativeLocation: { properties: { city: 'Catskill', state: 'NY' } } } };
const FORECAST = {
  properties: {
    updated: '2027-05-09T19:00:00+00:00',
    periods: [
      { number: 1, name: 'Tonight', startTime: '2027-05-09T20:00:00-04:00', endTime: '2027-05-10T06:00:00-04:00', isDaytime: false, temperature: 33, temperatureUnit: 'F', windSpeed: '0 to 5 mph', shortForecast: 'Clear' },
      { number: 2, name: 'Monday', startTime: '2027-05-10T06:00:00-04:00', endTime: '2027-05-10T18:00:00-04:00', isDaytime: true, temperature: 64, temperatureUnit: 'F', windSpeed: '10 to 20 mph', shortForecast: 'Sunny' },
    ],
  },
};

test('NWS forecast: points lookup, then 12-hour periods with lows at night', async () => {
  const { http, calls } = testClient([
    { match: /\/points\/42\.2528,-73\.9857$/, body: POINTS },
    { match: /gridpoints\/ALY\/53,48\/forecast$/, body: FORECAST },
  ]);
  const f = await nwsForecast(http, { lat: 42.2528, lon: -73.9857 });
  assert.equal(f.status, 'ok');
  if (f.status !== 'ok') return;
  assert.equal(f.value.place, 'Catskill, NY');
  assert.deepEqual(f.value.periods.map((p) => [p.isNight, p.temperatureF, p.windMph]), [[true, 33, 5], [false, 64, 20]]);
  assert.match(calls[0]!.headers['User-Agent']!, /Plotwright/);
  assert.equal(calls[0]!.headers.Accept, 'application/geo+json');
});

test('NWS: outside coverage or unreachable is an explicit unavailable', async () => {
  const { http } = testClient([{ match: /\/points\//, status: 404, body: { title: 'Data Unavailable For Requested Point' } }]);
  const f = await nwsForecast(http, { lat: 51.5, lon: -0.12 });
  assert.equal(f.status, 'unavailable');
  assert.equal(parseWindMph('15 km/h')! < 10, true);
  assert.equal(parseWindMph(undefined), undefined);
});

test('NASA POWER humidity climatology', async () => {
  const RH = { JAN: 70, FEB: 68, MAR: 65, APR: 63, MAY: 68, JUN: 72, JUL: 74, AUG: 77, SEP: 78, OCT: 75, NOV: 73, DEC: 72, ANN: 71 };
  const { http, calls } = testClient([{ match: /power\.larc\.nasa\.gov/, body: { properties: { parameter: { RH2M: RH } } } }]);
  const h = await humidityClimatology(http, { lat: 42.25, lon: -73.98 });
  assert.equal(h.status === 'ok' && Math.round(h.value.summer), 74);
  assert.match(calls[0]!.url, /parameters=RH2M/);
});
