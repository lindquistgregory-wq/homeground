import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plantingYear } from './drafts';

test('draft crops are planned for their phase: set-up now, first season this year or next, later phases two years out', () => {
  const spring = new Date(2026, 3, 10), autumn = new Date(2026, 9, 28);
  assert.equal(plantingYear('year0', autumn), 2026);
  assert.equal(plantingYear(undefined, autumn), 2026);
  assert.equal(plantingYear('year1', spring), 2026);
  assert.equal(plantingYear('year1', autumn), 2027);
  assert.equal(plantingYear('years2to5', spring), 2028);
});
