import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acresToM2, cToF, deltaCToF, fToC, formatAcres, formatArea, formatGallons, formatGdd, formatLength, formatPounds, formatRangeIn, formatSqFt,
  formatTemp, formatTempDeltaF, formatTempF, ftToM, m2ToAcres, mToFt,
} from './units';

test('round trips', () => {
  assert.equal(ftToM(1), 0.3048);
  assert.ok(Math.abs(mToFt(ftToM(123.4)) - 123.4) < 1e-12);
  assert.ok(Math.abs(m2ToAcres(acresToM2(2.5)) - 2.5) < 1e-12);
  assert.equal(cToF(0), 32);
  assert.equal(cToF(100), 212);
  assert.ok(Math.abs(fToC(28) - -2.2222222) < 1e-6);
  assert.equal(deltaCToF(5), 9);
});

test('formatting picks sensible units', () => {
  assert.equal(formatArea(acresToM2(5), 'imperial'), '5 ac');
  assert.equal(formatArea(100, 'imperial'), '1,076 ft²');
  assert.equal(formatArea(25_000, 'metric'), '2.5 ha');
  assert.equal(formatLength(1609.344, 'imperial'), '1 mi');
  assert.equal(formatLength(12.34, 'metric'), '12.3 m');
  assert.equal(formatTemp(-2.2222, 'imperial'), '28 °F');
});

test('US-sourced figures in either system', () => {
  assert.equal(formatTempF(85, 'imperial'), '85 °F');
  assert.equal(formatTempF(85, 'metric'), '29 °C');
  assert.equal(formatTempDeltaF(9, 'metric'), '5 °C');
  assert.equal(formatSqFt(12, 'metric'), '1.1 m²');
  assert.equal(formatAcres(0.17, 'imperial'), '0.17 acres');
  assert.equal(formatAcres(1, 'metric'), '0.4 ha');
  assert.equal(formatGallons(3, 'metric'), '11 L');
  assert.equal(formatPounds(65, 'metric'), '29 kg');
  assert.equal(formatRangeIn([600, 1200], (n) => formatPounds(n, 'imperial')), '600–1,200 lb');
  assert.equal(formatGdd(1800, 'metric'), '1,000 GDD (base 10 °C)');
});
