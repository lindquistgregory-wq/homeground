import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blendSoilCurve, calibratedSunHours, checkThresholds, classifyLux, clearSkyGhi, compareSun, counterIncrements, dailyAggregates, dewPointC,
  et0Hargreaves, et0PenmanMonteith, extraterrestrialRadiation, forecastOffsetC, freshness, gddFromDailyC, importCsv, leafWetHours, localDate,
  mapColumns, parseTimestamp, rollingMean, toReadings, vpdKpa, waterBalance, windAt2m, LUX_PER_WM2, type Reading,
} from './index';
import { solarPosition } from '../sun/spa';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≠ ${b} ± ${tol}`);

test('dew point and VPD', () => {
  near(dewPointC(25, 60), 16.7, 0.15);
  near(dewPointC(10, 100), 10, 0.01);
  near(vpdKpa(25, 60), 1.267, 0.005);
  near(vpdKpa(20, 100), 0, 1e-9);
});

test('FAO-56 worked examples: Ra (Ex. 8), wind height (Ex. 14), Penman–Monteith (Ex. 18), Hargreaves (Ex. 20)', () => {
  // Ex. 8: 20°S on 3 September → Ra = 32.2 MJ/m²/day.
  near(extraterrestrialRadiation(-20, 246), 32.2, 0.1, 'Ra');
  // Ex. 14: 3.2 m/s at 10 m → 2.4 m/s at 2 m.
  near(windAt2m(3.2, 10), 2.4, 0.02, 'u2');
  // Ex. 18: Brussels (50°48'N, 100 m), 6 July: ET0 ≈ 3.9 mm/day.
  const bx = et0PenmanMonteith({ latDeg: 50.8, elevationM: 100, doy: 187, tmaxC: 21.5, tminC: 12.3, rhMaxPct: 84, rhMinPct: 63, windMs: 10 / 3.6, windHeightM: 10, solarMJ: 22.07 });
  near(bx.et0Mm, 3.9, 0.1, 'PM');
  assert.deepEqual(bx.estimated, []);
  // Ex. 20: Lyon (45°43'N), 15 July, 26.6/14.8 °C → 5.0 mm/day.
  near(et0Hargreaves(45.72, 196, 26.6, 14.8), 5.0, 0.1, 'Hargreaves');
  // Temperature-only PM (FAO-56 missing-data procedure) lands in the same neighbourhood and says what it estimated.
  const est = et0PenmanMonteith({ latDeg: 45.72, elevationM: 200, doy: 196, tmaxC: 26.6, tminC: 14.8 });
  assert.deepEqual(est.estimated.sort(), ['humidity', 'radiation', 'wind']);
  near(est.et0Mm, 5.0, 1.0, 'PM estimated');
});

test('water balance and soil-moisture override', () => {
  const week = Array.from({ length: 7 }, (_, i) => ({ et0Mm: 5, rainMm: i === 3 ? 10 : 1 }));
  const w = waterBalance(week, 1.0);
  near(w.cropUseMm, 35, 1e-9);
  near(w.effectiveRainMm, 8, 1e-9);
  near(w.needMm, 27, 1e-9);
  assert.match(w.message, /water about 27 mm/);
  assert.equal(waterBalance(week, 1.0, { vwcPct: 35, texture: 'loamy' }).needMm, 0);
  assert.match(waterBalance(week, 1.0, { vwcPct: 10, texture: 'sandy' }).message, /water now/);
});

test('leaf wetness hours and degree days', () => {
  const h = 3_600_000;
  near(leafWetHours([[0, 95], [h, 95], [2 * h, 80], [3 * h, 92], [4 * h, 70]]), 3, 1e-9);
  // 20/30 °C → 68/86 °F → (86+68)/2 − 50 = 27 GDD; a cold day contributes 0.
  near(gddFromDailyC([{ tminC: 20, tmaxC: 30 }, { tminC: 0, tmaxC: 8 }]), 27, 1e-9);
});

test('daily aggregates in local time, rolling mean, counter resets, freshness', () => {
  const t0 = Date.UTC(2026, 4, 1, 3, 0); // 23:00 on Apr 30 in EDT (−240)
  const rs: Reading[] = [
    ...toReadings('s', t0, { temperature: 10, humidity: 80 }),
    ...toReadings('s', t0 + 2 * 3_600_000, { temperature: 6 }), // 01:00 May 1 local
    ...toReadings('s', t0 + 14 * 3_600_000, { temperature: 20 }),
    ...toReadings('s', t0 + 15 * 3_600_000, { temperature: 999 }), // suspect: dropped
  ];
  const days = dailyAggregates(rs, -240);
  assert.deepEqual(days.map((d) => d.date), ['2026-04-30', '2026-05-01']);
  assert.equal(days[1]!.metrics.temperature!.min, 6);
  assert.equal(days[1]!.metrics.temperature!.max, 20);
  assert.equal(localDate(t0, -240).doy, 120);
  const sm = rollingMean([10, 20, 30].map((v, i) => ({ sensorId: 's', t: i * 60_000, metric: 'humidity' as const, value: v, quality: 'ok' as const })), 90_000);
  assert.deepEqual(sm.map((r) => r.value), [10, 15, 25]);
  const inc = counterIncrements([5, 7, 7.5, 0.5].map((v, i) => ({ sensorId: 's', t: i, metric: 'rainTotal' as const, value: v, quality: 'ok' as const })));
  assert.deepEqual(inc.map((r) => r.value), [2, 0.5, 0.5]);
  assert.equal(freshness(undefined, 0, 1), 'never');
  assert.equal(freshness(0, 2 * 60_000, 60_000), 'fresh');
  assert.equal(freshness(0, 10 * 60_000, 60_000), 'late');
  assert.equal(freshness(0, 60 * 60_000, 60_000), 'stale');
});

test('soil temperature blend: measured days, recent bias carried forward and faded', () => {
  const model = (d: number) => 40 + d * 0.2;
  const f = blendSoilCurve(model, [{ doy: 100, meanF: 64 }, { doy: 101, meanF: 64.2 }]); // model 60, 60.2 → bias +4
  assert.equal(f(100), 64);
  near(f(102), model(102) + 4 * (1 - 1 / 30), 1e-9);
  near(f(200), model(200), 1e-9);
  near(f(50), model(50) + 4, 1e-9);
  assert.equal(blendSoilCurve(model, [])(10), model(10));
});

test('frost offset at a low spot, and threshold alerts', () => {
  assert.equal(forecastOffsetC([{ forecastLowC: 2, observedMinC: 0 }]), null);
  const pairs = [0, -1, -2, -3, -2.5, 5].map((d) => ({ forecastLowC: 4, observedMinC: 4 + d }));
  near(forecastOffsetC(pairs)!, -1.5, 1e-9); // sorted −3, −2.5, −2, −1, 0, 5
  const b = checkThresholds({ temperature: 38, humidity: 95 }, { maxC: 35, maxRhPct: 90, minC: 2 });
  assert.deepEqual(b.map((x) => `${x.metric}:${x.kind}`), ['temperature:above', 'humidity:above']);
});

test('light sensor: clear-sky sun vs shade, and calibration against the model on clear days', () => {
  near(clearSkyGhi(90), 1037, 2);
  assert.equal(clearSkyGhi(-1), 0);
  assert.equal(classifyLux(100_000, 60), 'sun');
  assert.equal(classifyLux(12_000, 60), 'shade');
  assert.equal(classifyLux(50_000, 5), 'unsure');
  // A June day at 40°N 75°W. Model: sun all day. Reality: a tree shades the sensor from 18:00 UTC (2 pm EDT).
  const lat = 40, lon = -75;
  const samples: Array<[number, number]> = [];
  for (let t = Date.UTC(2026, 5, 21, 9); t <= Date.UTC(2026, 5, 22, 1); t += 10 * 60_000) {
    const el = solarPosition(new Date(t), lat, lon).elevation;
    const clear = clearSkyGhi(el) * LUX_PER_WM2;
    samples.push([t, t < Date.UTC(2026, 5, 21, 18) ? clear * 0.95 : clear * 0.15]);
  }
  const cal = compareSun(samples, lat, lon, () => true, () => true, (t) => localDate(t, -240).date);
  assert.equal(cal.clearDays, 1);
  assert.ok(cal.ratio! > 0.5 && cal.ratio! < 0.75, `ratio ${cal.ratio}`);
  assert.ok(cal.agreement! < 0.75);
  // Cloudy days are ignored.
  assert.equal(compareSun(samples, lat, lon, () => true, () => false, (t) => localDate(t, -240).date).ratio, null);
  // Calibration only applies with enough clear days.
  assert.equal(calibratedSunHours(8, cal).calibrated, false);
  const three = { ...cal, clearDays: 3 };
  near(calibratedSunHours(8, three).hours, 8 * cal.ratio!, 1e-9);
});

test('CSV import: headers, units, local timestamps, units row, junk rows', () => {
  const csv = [
    'Time,Outdoor Temperature(°F),Outdoor Humidity(%),Dew Point(°F),Wind Speed(mph),Wind Gust(mph),Rain Rate(in/hr),Daily Rain(in),Pressure(inHg),Solar Rad(W/m2),Indoor Temperature(°F),Soil Moisture CH1(%)',
    '2026-05-01 06:00,50,90,47.2,4.5,9,0,0.12,29.92,150,68,31',
    'not a date,1,2,3,4,5,6,7,8,9,10,11',
    '2026-05-01 06:05,--,91,,4.0,8,0.1,0.13,29.91,160,68,31',
  ].join('\n');
  const r = importCsv(csv, { sensorId: 'csv1', offsetMin: -240, defaultUnits: 'imperial' });
  assert.equal(r.rows, 3);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.columns.map((c) => c.metric).sort(), ['dewPoint', 'humidity', 'pressure', 'rainDaily', 'rainRate', 'soilMoisture', 'solarRadiation', 'temperature', 'windGust', 'windSpeed'].sort());
  const at = (metric: string, t: number) => r.readings.find((x) => x.metric === metric && x.t === t)!.value;
  const t1 = Date.UTC(2026, 4, 1, 10, 0);
  near(at('temperature', t1), 10, 1e-9);
  near(at('windSpeed', t1), 2.01168, 1e-6);
  near(at('pressure', t1), 1013.21, 0.01);
  near(at('rainDaily', t1), 3.048, 1e-9);
  assert.equal(r.readings.filter((x) => x.metric === 'temperature').length, 1, 'blank "--" skipped; indoor ignored');

  // Semicolon, decimal comma, a units row, day-first dates.
  const eu = 'Date;Time;Temp;Hum;Rain\n;;°C;%;mm\n31/12/2025;23:30;-2,5;88;0,4\n';
  const e = importCsv(eu, { sensorId: 'x', offsetMin: 60, defaultUnits: 'metric', dayFirst: true });
  near(e.readings.find((x) => x.metric === 'temperature')!.value, -2.5, 1e-9);
  assert.equal(e.readings[0]!.t, Date.UTC(2025, 11, 31, 22, 30));
  assert.equal(importCsv('a,b\n1,2', { sensorId: 'x', offsetMin: 0, defaultUnits: 'metric' }).warnings.at(-1), 'No date/time column found.');
});

test('timestamp formats and header mapping edge cases', () => {
  assert.equal(parseTimestamp(['1714557600'], 0), 1714557600000);
  assert.equal(parseTimestamp(['2026-05-01T10:00:00Z'], -240), Date.UTC(2026, 4, 1, 10));
  assert.equal(parseTimestamp(['2026-05-01T06:00:00-04:00'], 0), Date.UTC(2026, 4, 1, 10));
  assert.equal(parseTimestamp(['5/1/2026 6:00 PM'], -240), Date.UTC(2026, 4, 1, 22));
  assert.equal(parseTimestamp(['5/1/2026', '12:15 AM'], 0), Date.UTC(2026, 4, 1, 0, 15));
  assert.equal(parseTimestamp(['13/13/2026'], 0), null);
  const m = mapColumns(['Date', 'Temp', 'Feels Like', 'Heat Index', 'Soil Temp 1'], 'metric');
  assert.deepEqual(m.columns.map((c) => c.metric), ['temperature', 'soilTemperature']);
  assert.ok(m.warnings.some((w) => /assumed C/.test(w)));
});
