/** "Suggest a setup" for a bed: companions, poor neighbours, feeders, the plan, rotation, and checking AI picks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS, feederOf, plantById, suggestBedSetup, validateAiSetup, type BedSetupInput, type Suitability } from '@plotwright/core';

// Every vegetable and herb fits equally well, so the choices come from the setup rules alone.
const ranked: Suitability[] = PLANTS.filter((p) => p.kind === 'vegetable' || p.kind === 'herb')
  .map((p) => ({ plantId: p.id, score: 70, verdict: 'good' as const, factors: [], hardFails: [], summary: '' }));
const base: BedSetupInput = { ranked, plant: plantById, existing: [], history: [], year: 2027, areaSqFt: 32 };

test('feeder groups follow the plant family', () => {
  assert.equal(feederOf(plantById('tomato')!), 'heavy');
  assert.equal(feederOf(plantById('bean-bush')!), 'fixer');
  assert.equal(feederOf(plantById('carrot')!), 'light');
});

test('fills the free part of the bed with a few plants that go together', () => {
  const s = suggestBedSetup({ ...base, existing: [{ plantId: 'tomato', share: 0.5 }] });
  assert.equal(s.freeShare, 0.5);
  assert.ok(s.picks.length >= 1 && s.picks.length <= 3);
  assert.ok(s.picks.reduce((a, p) => a + p.share, 0) <= 0.5 + 1e-9);
  // Tomato's traditional companions win; its poor neighbours never appear.
  const ids = s.picks.map((p) => p.plantId);
  assert.ok(ids.some((id) => ['basil', 'carrot', 'onion'].includes(id)), ids.join(','));
  for (const bad of plantById('tomato')!.avoidNear ?? []) assert.ok(!ids.includes(bad));
  assert.ok(s.picks.every((p) => p.reasons.length > 0));
});

test('the homestead plan and last year’s family steer the picks', () => {
  const withPlan = suggestBedSetup({ ...base, planCrops: ['kale'] });
  assert.equal(withPlan.picks[0]!.plantId, 'kale');
  assert.ok(withPlan.picks[0]!.reasons.includes('In your homestead plan'));
  const afterKale = suggestBedSetup({ ...base, planCrops: ['kale'], history: [{ plantId: 'kale', family: 'Brassicaceae', year: 2026 }] });
  assert.notEqual(afterKale.picks[0]!.plantId, 'kale');
});

test('a full bed gets no picks', () => {
  assert.equal(suggestBedSetup({ ...base, existing: [{ plantId: 'tomato', share: 1 }] }).picks.length, 0);
});

test('AI picks are checked against the candidates, the bed and poor neighbours', () => {
  const input = { ...base, existing: [{ plantId: 'tomato', share: 0.5 }] };
  const bad = (plantById('tomato')!.avoidNear ?? [])[0]!;
  const picks = validateAiSetup({ picks: [{ plantId: 'basil', why: 'Pairs with tomato' }, { plantId: 'made-up' }, { plantId: 'tomato' }, { plantId: bad }] }, input)!;
  assert.deepEqual(picks.map((p) => p.plantId), ['basil']);
  assert.equal(picks[0]!.share, 0.5);
  assert.equal(validateAiSetup('nonsense', input), null);
});
