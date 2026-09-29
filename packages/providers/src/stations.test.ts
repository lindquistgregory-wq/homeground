import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ambientDevices, ecowittDate, ecowittHistory, ecowittLocal, ecowittRealtime, isLocalAddress, parseEcowittLocal, parseTempestUdp,
  parseWeatherLinkCurrent, parseWeatherLinkLive, toCanonical, valUnit, weatherLinkCurrent, type StationObservation,
} from './stations';
import { nearestScan, parseScanHourly, regionalSoil, scanStations } from './scan';
import { testClient } from './testing';
import { MemoryCache } from './http';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => JSON.parse(readFileSync(join(here, '__fixtures__', name), 'utf8'));
const near = (a: number | undefined, b: number, tol = 0.01, msg = '') => assert.ok(a !== undefined && Math.abs(a - b) <= tol, `${msg} ${a} ≠ ${b}`);
const chan = (o: StationObservation, c: string) => o.channels.find((x) => x.channel === c)?.values ?? {};

test('value/unit parsing and canonical conversion', () => {
  assert.deepEqual(valUnit('3.2 m/s'), [3.2, 'm/s']);
  assert.deepEqual(valUnit('65%'), [65, '%']);
  assert.deepEqual(valUnit('79.2', 'F'), [79.2, 'F']);
  assert.equal(valUnit('None'), null);
  assert.equal(valUnit('--'), null);
  near(toCanonical('temperature', 79.2, 'F')[1], 26.22);
  near(toCanonical('temperature', 18.4, '℃')[1], 18.4);
  near(toCanonical('pressure', 29.4, 'inHg')[1], 995.6);
  near(toCanonical('windSpeed', 10, 'mph')[1], 4.4704, 1e-6);
  near(toCanonical('rainDaily', 0.5, 'in')[1], 12.7, 1e-9);
  assert.deepEqual(toCanonical('solarRadiation', 5000, 'lux'), ['illuminance', 5000]);
});

test('Ecowitt cloud: real-time in requested metric units, keys never cached, errors named', async () => {
  const cache = new MemoryCache();
  const { http, calls } = testClient([{ match: /device\/real_time/, body: fx('ecowitt-realtime.synthetic.json') }], { cache });
  const r = await ecowittRealtime(http, { applicationKey: 'APP', apiKey: 'KEY', mac: 'AA:BB' });
  assert.equal(cache.size, 0, 'requests carrying the user\'s keys are never written to the on-device cache');
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  const o = chan(r.value, 'outdoor');
  near(o.temperature, 18.4); near(o.humidity, 63); near(o.dewPoint, 11.2); near(o.pressure, 1016.2); near(o.windSpeed, 2.1);
  near(o.windGust, 3.9); near(o.windDirection, 214); near(o.rainDaily, 2.4); near(o.solarRadiation, 412.3); near(o.uvIndex, 3);
  near(chan(r.value, 'soil1').soilMoisture, 34);
  near(chan(r.value, 'th1').temperature, 19.0);
  near(chan(r.value, 'temp1').temperature, 16.8);
  near(chan(r.value, 'leaf1').leafWetness, 0);
  assert.ok(!r.value.channels.some((c) => /indoor/.test(c.channel)), 'indoor left out');
  assert.equal(r.value.t, 1759160390000);
  assert.match(calls[0]!.url, /temp_unitid=1&pressure_unitid=3&wind_speed_unitid=6&rainfall_unitid=12&solar_irradiance_unitid=16/);
  assert.equal(r.attribution.basis, 'measured');

  const bad = testClient([{ match: /real_time/, body: { code: 40010, msg: 'Illegal Application_Key Parameter' } }]);
  const e = await ecowittRealtime(bad.http, { applicationKey: 'x', apiKey: 'y', mac: 'z' });
  assert.equal(e.status, 'unavailable');
  if (e.status === 'unavailable') {
    assert.match(e.reason, /rejected the keys/);
    assert.ok(!/KEY|APP/.test(e.reason), 'no secrets in messages');
  }
});

test('Ecowitt cloud history: per-timestamp observations, missing values skipped, local-time window', async () => {
  const { http, calls } = testClient([{ match: /device\/history/, body: fx('ecowitt-history.synthetic.json') }]);
  const obs = await ecowittHistory(http, { applicationKey: 'a', apiKey: 'b', mac: 'c' }, Date.UTC(2026, 8, 29, 4), Date.UTC(2026, 8, 30, 4), -240);
  assert.deepEqual(obs.map((o) => o.t), [1759156800000, 1759157100000, 1759157400000].slice(0, obs.length));
  near(chan(obs[0]!, 'outdoor').temperature, 17.9);
  near(chan(obs[0]!, 'soil1').soilMoisture, 34);
  assert.equal(chan(obs[2] ?? { t: 0, channels: [] }, 'outdoor').temperature, undefined, '"-" is missing');
  assert.match(decodeURIComponent(calls[0]!.url), /start_date=2026-09-29 00:00:00&end_date=2026-09-30 00:00:00/);
  assert.equal(ecowittDate(Date.UTC(2026, 0, 1, 5, 7, 9), -300), '2026-01-01 00:07:09');
});

test('Ambient: imperial → canonical, both user keys sent, device time zone kept', async () => {
  const { http, calls } = testClient([{ match: /rt\.ambientweather\.net\/v1\/devices\?/, body: fx('ambient-devices.doc.json') }]);
  const r = await ambientDevices(http, { applicationKey: 'app', apiKey: 'key' });
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  const o = chan(r.value[0]!.last!, 'outdoor');
  near(o.temperature, 19.39); near(o.humidity, 30); near(o.pressure, 1017.61); near(o.windSpeed, 0.402); near(o.windGust, 1.788); near(o.dewPoint, 1.364);
  assert.equal(r.value[0]!.last!.t, 1515436500000);
  assert.match(calls[0]!.url, /applicationKey=app&apiKey=key/);
});

test('WeatherLink v2 current (doc sample): °F/mph → SI, rain in mm, secret in a header, health record ignored', async () => {
  const { http, calls } = testClient([{ match: /\/v2\/current\/374964\?api-key=k$/, body: fx('weatherlink-current.doc.json') }]);
  const r = await weatherLinkCurrent(http, { apiKey: 'k', apiSecret: 's', stationId: '374964' });
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(calls[0]!.headers['X-Api-Secret'], 's');
  assert.ok(!/s$|secret/.test(calls[0]!.url.replace('api-key=k', '')), 'secret not in the URL');
  const o = chan(r.value, 'outdoor');
  near(o.temperature, 22.94); near(o.humidity, 42.7); near(o.windSpeed, 3.37 * 0.44704, 1e-6); near(o.windGust, 5 * 0.44704, 1e-6); near(o.windDirection, 214);
  near(o.solarRadiation, 598); near(o.uvIndex, 2.3); near(o.rainDaily, 0);
  assert.equal(r.value.t, 1558741927000);
  assert.equal(parseWeatherLinkCurrent({ sensors: [] }).channels.length, 0);
});

test('WeatherLink Live local (doc sample): rain clicks × bucket size, soil tension in kPa, indoor skipped', () => {
  const o = parseWeatherLinkLive(fx('wll-current-conditions.doc.json'));
  const out = chan(o, 'outdoor');
  near(out.temperature, 17.06);
  near(out.rainDaily, 63 * 0.2, 1e-9); // rain_size 2 = 0.2 mm per click
  near(out.pressure, 30.008 * 33.8639);
  near(out.solarRadiation, 747);
  assert.equal(o.t, 1531754005000);
  assert.equal(o.channels.filter((c) => c.channel.startsWith('soil')).length, 0, 'null soil values are skipped');
  const soil = parseWeatherLinkLive({ data: { ts: 1, conditions: [{ data_structure_type: 2, temp_1: 60.8, moist_soil_1: 25 }] } });
  near(chan(soil, 'soil1').soilTemperature, 16); near(chan(soil, 'soil1').soilTension, 25);
});

test('Ecowitt gateway local (doc sample, imperial) and LAN-only guard', async () => {
  const o = parseEcowittLocal(fx('ecowitt-local-livedata.doc.json'), 1000);
  near(chan(o, 'outdoor').temperature, 26.22); near(chan(o, 'outdoor').humidity, 65); near(chan(o, 'outdoor').rainDaily ?? 0, 0);
  near(chan(o, 'outdoor').pressure, 29.4 * 33.8639);
  near(chan(o, 'temp1').temperature, 26.61);
  near(chan(o, 'soil1').soilMoisture, 0);
  assert.equal(chan(o, 'th1').humidity, undefined, '"None" skipped');
  assert.equal(isLocalAddress('192.168.1.20'), true);
  assert.equal(isLocalAddress('10.0.0.5:80'), true);
  assert.equal(isLocalAddress('172.20.1.1'), true);
  assert.equal(isLocalAddress('gw1100.local'), true);
  assert.equal(isLocalAddress('172.32.0.1'), false);
  assert.equal(isLocalAddress('8.8.8.8'), false);
  assert.equal(isLocalAddress('example.com'), false);
  const { http, calls } = testClient([]);
  const r = await ecowittLocal(http, 'api.example.com');
  assert.equal(r.status, 'unavailable');
  assert.equal(calls.length, 0, 'never contacts a non-local host');
  const ok = testClient([{ match: /^http:\/\/192\.168\.1\.20\/get_livedata_info$/, body: fx('ecowitt-local-livedata.doc.json') }]);
  assert.equal((await ecowittLocal(ok.http, '192.168.1.20')).status, 'ok');
});

test('Tempest UDP broadcast messages (UDP v171 doc samples)', () => {
  const st = parseTempestUdp('{"serial_number":"ST-00000512","type":"obs_st","hub_sn":"HB-00013030","obs":[[1588948614,0.18,0.22,0.27,144,6,1017.57,22.37,50.26,328,0.03,3,0.000000,0,0,0,2.410,1]],"firmware_revision":129}')!;
  assert.equal(st.serial, 'ST-00000512');
  const o = chan(st.obs, 'outdoor');
  near(o.temperature, 22.37); near(o.humidity, 50.26); near(o.pressure, 1017.57); near(o.windSpeed, 0.22); near(o.windGust, 0.27);
  near(o.illuminance, 328); near(o.solarRadiation, 3); near(o.rain, 0); near(o.dewPoint, 11.6, 0.1);
  assert.equal(st.obs.t, 1588948614000);
  const wind = parseTempestUdp('{"serial_number":"SK-00008453","type":"rapid_wind","hub_sn":"HB-00000001","ob":[1493322445,2.3,128]}')!;
  near(chan(wind.obs, 'outdoor').windSpeed, 2.3);
  const air = parseTempestUdp('{"serial_number":"AR-00004049","type":"obs_air","hub_sn":"HB-00000001","obs":[[1493164835,835.0,10.0,45,0,0,3.46,1]],"firmware_revision":17}')!;
  near(chan(air.obs, 'outdoor').temperature, 10);
  assert.equal(parseTempestUdp('{"serial_number":"HB-00000001","type":"hub_status","uptime":1}'), null);
  assert.equal(parseTempestUdp('not json'), null);
});

test('SCAN: nearest station, hourly → daily means in station time, regional attribution', async () => {
  const stations = fx('scan-station.live.json');
  const list = [...stations, { stationTriplet: '9999:TN:SCAN', name: 'Far', latitude: 36.5, longitude: -86.5, elevation: 700, dataTimeZone: -6 }];
  const { http } = testClient([
    { match: /\/stations\?/, body: list },
    { match: /\/data\?/, body: [{ stationTriplet: '2057:AL:SCAN', data: [
      { stationElement: { elementCode: 'STO', heightDepth: -2, storedUnitCode: 'degF' }, values: Array.from({ length: 24 }, (_, h) => ({ date: `2026-09-27 ${String(h).padStart(2, '0')}:00`, value: 60 + (h % 2) * 2 })) },
      { stationElement: { elementCode: 'SMS', heightDepth: -2, storedUnitCode: 'pct' }, values: Array.from({ length: 24 }, (_, h) => ({ date: `2026-09-27 ${String(h).padStart(2, '0')}:00`, value: h === 5 ? null : 10.5 })) },
    ] }] },
  ]);
  const st = await scanStations(http);
  const n = nearestScan(st, { lat: 34.7, lon: -86.6 })!;
  assert.equal(n.name, 'AAMU-JTG');
  near(n.elevationM, 243.84, 0.01); // AWDB elevations are feet
  assert.equal(nearestScan(st, { lat: 45, lon: -120 }), null);
  const r = await regionalSoil(http, { lat: 34.7, lon: -86.6, elevationM: 250 }, 7, Date.UTC(2026, 8, 29, 12));
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.value.days.length, 1);
  near(r.value.days[0]!.soil2inF, 61); near(r.value.days[0]!.moisture2inPct, 10.5);
  assert.equal(r.value.days[0]!.doy, 270);
  assert.equal(r.attribution.basis, 'measured');
  assert.match(r.attribution.notes![0]!, /Regional reading from AAMU-JTG/);
  // The real 4-hour sample is too short to call a daily mean.
  assert.deepEqual(parseScanHourly(fx('scan-hourly.live.json')), []);
});

test('WeatherLink: an indoor AirLink or a second ISS never overwrites the outdoor channel', () => {
  const o = parseWeatherLinkCurrent({ sensors: [
    { lsid: 1, sensor_type: 45, data_structure_type: 10, data: [{ ts: 100, temp: 50, hum: 80 }] },
    { lsid: 2, sensor_type: 323, data_structure_type: 16, data: [{ ts: 100, temp: 72, hum: 35 }] }, // AirLink indoors
    { lsid: 3, sensor_type: 45, data_structure_type: 10, data: [{ ts: 100, temp: 40, hum: 90 }] }, // second ISS
    { lsid: 4, sensor_type: 242, data_structure_type: 19, data: [{ ts: 100, bar_sea_level: 30 }] },
  ] });
  near(chan(o, 'outdoor').temperature, 10); near(chan(o, 'outdoor').humidity, 80); near(chan(o, 'outdoor').pressure, 30 * 33.8639);
  near(chan(o, 'iss2').temperature, 4.44);
  assert.equal(o.channels.length, 2);
});
