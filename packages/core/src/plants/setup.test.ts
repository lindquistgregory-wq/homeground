import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plantById } from './index';
import { suggestBedSetup } from './setup';
import { scorePlant, type Suitability } from './suitability';

const rank = (ids: string[], sunHours: number): Suitability[] =>
  ids.map((id) => scorePlant(plantById(id)!, {}, { sunHours, soil: { pH: 6.5, drainageClass: 'Well drained' } }))
    .sort((a, b) => b.score - a.score);
const setup = (ranked: Suitability[]) => suggestBedSetup({ ranked, plant: plantById, existing: [], history: [], year: 2026, areaSqFt: 32 });

test('a shady bed gets no full-sun suggestions', () => {
  const s = setup(rank(['blackberry', 'blueberry', 'tomato'], 1.9));
  assert.equal(s.picks.length, 0);
  assert.match(s.notes[0]!, /No plant suits this bed/);
  assert.ok(setup(rank(['blackberry', 'blueberry', 'tomato'], 9)).picks.length > 0, 'the same plants in full sun are suggested');
});

test('the heavy-feeder note only when every plant is a heavy feeder', () => {
  const notes = (s: ReturnType<typeof setup>) => s.notes.some((n) => /All heavy feeders/.test(n));
  const heavy = setup(rank(['tomato', 'squash-summer'], 9));
  assert.equal(heavy.picks.length, 2);
  assert.ok(notes(heavy));
  const mixed = setup(rank(['blackberry', 'collards'], 9));
  assert.ok(mixed.picks.some((p) => p.plantId === 'blackberry'));
  assert.ok(!notes(mixed), 'blackberry is a moderate feeder');
});
