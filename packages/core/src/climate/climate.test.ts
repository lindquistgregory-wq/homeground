import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doyToMonthDay, formatDoy, mmddToDoy, parseNormalsRow, type StationNormals } from './normals';
import { elevationShiftDays, estimateFrostDates } from './frost';

/**
 * Real NCEI Access Data Service values for Albany Intl AP (USW00014735), retrieved 2026-09-28, subset.
 * Values are space-padded exactly as the service returns them. Station location fields were not in
 * that response and are taken from the station's published coordinates (approximate).
 */
const ALBANY_ROW = {
  STATION: 'USW00014735',
  NAME: 'ALBANY INTERNATIONAL AIRPORT, NY US',
  LATITUDE: ' 42.7431',
  LONGITUDE: ' -73.8092',
  ELEVATION: '  85.6',
  'ANN-TMIN-PRBLST-T32FP10': '   05/11',
  'ANN-TMIN-PRBLST-T32FP50': '   04/27',
  'ANN-TMIN-PRBLST-T32FP90': '   04/16',
  'ANN-TMIN-PRBFST-T32FP10': '   10/03',
  'ANN-TMIN-PRBFST-T32FP50': '   10/15',
  'ANN-TMIN-PRBFST-T32FP90': '   11/01',
  'ANN-TMIN-PRBLST-T28FP10': '   04/28',
  'ANN-TMIN-PRBLST-T28FP50': '   04/16',
  'ANN-TMIN-PRBLST-T28FP90': '   04/03',
  'ANN-TMIN-PRBFST-T28FP10': '   10/11',
  'ANN-TMIN-PRBFST-T28FP50': '   10/28',
  'ANN-TMIN-PRBFST-T28FP90': '   11/10',
  'ANN-TMIN-PRBGSL-T32FP50': '   169.0',
  'DJF-TMIN-NORMAL': '18.7',
  'MAM-TMIN-NORMAL': '37.0',
  'JJA-TMIN-NORMAL': '60.1',
  'SON-TMIN-NORMAL': '41.8',
  'ANN-TMIN-NORMAL': '39.4',
  'DJF-TMAX-NORMAL': '35.7',
  'MAM-TMAX-NORMAL': '58.6',
  'JJA-TMAX-NORMAL': '81.8',
  'SON-TMAX-NORMAL': '61.8',
  'ANN-TMAX-NORMAL': '59.4',
  'ANN-GRDD-BASE50': '2886.3',
  'ANN-PRCP-NORMAL': '40.68',
  'ANN-SNOW-NORMAL': '59.20',
};

/** Real row (Hudson Correctional Facility, NY) including location, as returned with includeStationLocation=1. */
const HUDSON_ROW = {
  STATION: 'USC00304025',
  LONGITUDE: ' -73.7922',
  ELEVATION: '   9.1',
  LATITUDE: ' 42.2475',
  'ANN-TMIN-PRBLST-T32FP50': '   04/25',
  NAME: 'HUDSON CORRECTIONAL FACILITY, NY US',
  'ANN-TMIN-PRBFST-T32FP50': '   10/18',
};

test('MM/DD ⇄ day-of-year', () => {
  assert.equal(mmddToDoy('01/01'), 1);
  assert.equal(mmddToDoy('   04/27'), 117);
  assert.equal(mmddToDoy('12/31'), 365);
  assert.equal(mmddToDoy('13/01'), undefined);
  assert.deepEqual(doyToMonthDay(117), { month: 4, day: 27 });
  assert.equal(formatDoy(288), 'Oct 15');
  assert.equal(formatDoy(59), 'Feb 28');
  assert.equal(formatDoy(60), 'Mar 1');
});

test('parses a padded NCEI normals row', () => {
  const s = parseNormalsRow(ALBANY_ROW)!;
  assert.equal(s.stationId, 'USW00014735');
  assert.equal(s.lat, 42.7431);
  assert.equal(s.elevationM, 85.6);
  assert.equal(s.lastSpring[32]?.[50], mmddToDoy('04/27'));
  assert.equal(s.lastSpring[32]?.[10], mmddToDoy('05/11'));
  assert.equal(s.firstFall[28]?.[90], mmddToDoy('11/10'));
  assert.equal(s.growingSeasonDays[32]?.[50], 169);
  assert.deepEqual(s.tminF, { DJF: 18.7, MAM: 37, JJA: 60.1, SON: 41.8, ANN: 39.4 });
  assert.deepEqual(s.tmaxF, { DJF: 35.7, MAM: 58.6, JJA: 81.8, SON: 61.8, ANN: 59.4 });
  assert.equal(s.gddBase50F, 2886.3);
});

test('sentinel values are treated as missing', () => {
  const s = parseNormalsRow({ ...ALBANY_ROW, 'ANN-TMIN-PRBLST-T32FP50': '-4444', 'MAM-TMIN-NORMAL': ' -9999' })!;
  assert.equal(s.lastSpring[32]?.[50], undefined);
  assert.equal(s.tminF.MAM, undefined);
});

test('rows without a location are rejected', () => {
  assert.equal(parseNormalsRow({ STATION: 'X', 'ANN-TMIN-PRBLST-T32FP50': '04/01' }), undefined);
});

test('parcel at station elevation reproduces station dates', () => {
  const s = parseNormalsRow(ALBANY_ROW)!;
  const est = estimateFrostDates({ lat: 42.75, lon: -73.8, elevationM: 85.6 }, [s])!;
  assert.equal(est.dates.lastSpring[32][50], mmddToDoy('04/27'));
  assert.equal(est.dates.firstFall[32][50], mmddToDoy('10/15'));
  assert.equal(est.dates.freezeFreeDays, 288 - 117);
  assert.equal(est.confidence, 'high');
  assert.equal(est.dates.freezeRare, false);
});

test('a higher parcel gets a later spring and earlier fall freeze', () => {
  const s = parseNormalsRow(ALBANY_ROW)!;
  const shift = elevationShiftDays(s, 300); // 300 m higher → ~1.95 °C ≈ 3.5 °F colder
  assert.ok(Math.abs(shift.dTempF - -3.51) < 0.01);
  // spring gradient (37.0-18.7)/90 = 0.2033 °F/day → ≈ +17 days
  assert.ok(shift.spring > 16 && shift.spring < 18, `spring shift ${shift.spring}`);
  // fall gradient (60.1-41.8)/92 = 0.1989 °F/day → ≈ −18 days
  assert.ok(shift.fall < -17 && shift.fall > -19, `fall shift ${shift.fall}`);

  const est = estimateFrostDates({ lat: 42.75, lon: -73.8, elevationM: 385.6 }, [s])!;
  assert.ok(est.dates.lastSpring[32][50]! > mmddToDoy('04/27')! + 15);
  assert.ok(est.dates.firstFall[32][50]! < mmddToDoy('10/15')! - 15);
  assert.notEqual(est.confidence, 'high');
  assert.ok(est.notes.some((n) => n.includes('300 m higher')));
});

test('shift is clamped for extreme elevation differences', () => {
  const s = parseNormalsRow(ALBANY_ROW)!;
  assert.equal(elevationShiftDays(s, 3000).spring, 30);
});

test('inverse-distance blending favours the nearer station', () => {
  const albany = parseNormalsRow(ALBANY_ROW)!;
  const hudson = parseNormalsRow(HUDSON_ROW)!;
  // Parcel right next to Hudson at Hudson's elevation.
  const est = estimateFrostDates({ lat: 42.25, lon: -73.79, elevationM: 9.1 }, [albany, hudson])!;
  assert.equal(est.stations[0]!.stationId, 'USC00304025');
  assert.ok(est.stations[0]!.weight > 0.95);
  const hudsonSpring = mmddToDoy('04/25')!;
  assert.ok(Math.abs(est.dates.lastSpring[32][50]! - hudsonSpring) <= 1);
  // Hudson has no 10 %/90 % values, so those come from Albany alone (elevation-adjusted).
  assert.ok(est.dates.lastSpring[32][10] !== null);
});

test('no stations within range → null; frost-free stations → freezeRare', () => {
  const albany = parseNormalsRow(ALBANY_ROW)!;
  assert.equal(estimateFrostDates({ lat: 30, lon: -90, elevationM: 0 }, [albany]), null);
  const keyWest: StationNormals = {
    stationId: 'USW00012836', lat: 24.5557, lon: -81.7552, elevationM: 1.2,
    lastSpring: {}, firstFall: {}, growingSeasonDays: {}, tminF: { ANN: 73.9 }, tmaxF: {},
  };
  const est = estimateFrostDates({ lat: 24.56, lon: -81.78, elevationM: 2 }, [keyWest])!;
  assert.equal(est.dates.freezeRare, true);
  assert.equal(est.dates.lastSpring[32][50], null);
});

test('a station without published elevation is still used (unadjusted), never read as "frost rare"', () => {
  const s = parseNormalsRow({ ...ALBANY_ROW, ELEVATION: undefined })!;
  assert.ok(Number.isNaN(s.elevationM));
  const est = estimateFrostDates({ lat: 42.75, lon: -73.8, elevationM: 300 }, [s])!;
  assert.equal(est.dates.freezeRare, false);
  assert.equal(est.dates.lastSpring[32][50], mmddToDoy('04/27'));
  assert.equal(est.confidence, 'medium');
  assert.ok(est.notes.some((n) => /No published elevation/.test(n)));
});

test('precipitation-only stations alone give no estimate rather than "frost rare"', () => {
  const precipOnly: StationNormals = { stationId: 'US1NYAL0001', lat: 42.7, lon: -73.8, elevationM: 50, lastSpring: {}, firstFall: {}, growingSeasonDays: {}, tminF: {}, tmaxF: {} };
  assert.equal(estimateFrostDates({ lat: 42.7, lon: -73.8, elevationM: 50 }, [precipOnly]), null);
});
