import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMALS } from '../packages/core/src/livestock/index';
import { ANIMAL_ART } from '../apps/mobile/src/components/animalArtMap';

test('every species (and household pets) has its own drawing', () => {
  for (const a of ANIMALS) assert.ok(ANIMAL_ART[a.id], `${a.id} has no drawing`);
  assert.ok(ANIMAL_ART['household:dog'] && ANIMAL_ART['household:cat']);
  for (const [id, art] of Object.entries(ANIMAL_ART)) assert.match(art.main, /^#[0-9a-f]{6}$/i, id);
});
