import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMALS, animalById } from '../packages/core/src/livestock/index';
import { KNOWLEDGE_BASE, livestockGuide } from '../packages/data/src/index';

test('every species links to a care guide (https, with publisher and date)', () => {
  for (const a of ANIMALS) {
    const g = livestockGuide(a.id);
    assert.ok(g, `${a.id} has no guide`);
    assert.match(g!.url, /^https:\/\//, a.id);
    assert.ok(g!.publisher && g!.checked, a.id);
  }
});

test('the planner knowledge base and the animal library agree (prompt §9: no drift)', () => {
  const kb = KNOWLEDGE_BASE.homestead.livestock;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const [id, lp] of Object.entries(kb)) {
    const a = animalById(id);
    assert.ok(a, `planner species ${id} is in the library`);
    assert.ok(same(a!.spaceIndoorSqFt, lp.spaceIndoorSqFt), `${id}: indoor space`);
    assert.ok(same(a!.pastureAcresPerHead, lp.pastureAcresPerHead), `${id}: pasture`);
    assert.ok(same(a!.waterGalPerDay, lp.waterGalPerDay ?? null), `${id}: water`);
    assert.ok(same(a!.laborHoursPerWeek, lp.laborHoursPerWeek), `${id}: labour`);
    if (lp.feedLbPerYear !== undefined) assert.ok(same(a!.feedLbPerYear ?? null, lp.feedLbPerYear), `${id}: feed per year`);
    if (lp.feedLbPerGrowOut !== undefined) assert.ok(same(a!.feedLbPerGrowOut ?? null, lp.feedLbPerGrowOut), `${id}: feed per grow-out`);
    const eggs = (lp.production as { eggsPerYear?: unknown }).eggsPerYear;
    if (eggs !== undefined) assert.ok(same(a!.production.eggsPerYear, eggs), `${id}: eggs`);
  }
});

test('NWS forecast periods carry relative humidity when the forecast gives it (livestock heat stress)', async () => {
  const { parseNwsPeriods } = await import('../packages/providers/src/weather');
  const periods = parseNwsPeriods({ properties: { periods: [
    { startTime: '2027-07-12T06:00:00-04:00', endTime: '2027-07-12T18:00:00-04:00', isDaytime: true, temperature: 92, temperatureUnit: 'F', relativeHumidity: { value: 64 } },
    { startTime: '2027-07-12T18:00:00-04:00', endTime: '2027-07-13T06:00:00-04:00', isDaytime: false, temperature: 70, temperatureUnit: 'F' },
  ] } });
  assert.equal(periods[0]!.relativeHumidityPct, 64);
  assert.equal(periods[1]!.relativeHumidityPct, undefined, 'missing humidity stays undefined (alerts then assume humid air)');
});
