import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../packages/core/src/plants/index';
import { KIND_ART, PLANT_ART, artFor } from '../apps/mobile/src/components/plantArtMap';

const HEX = /^#[0-9a-f]{6}$/i;

test('every plant has its own picture, and every picture belongs to a real plant', () => {
  const ids = new Set(PLANTS.map((p) => p.id));
  for (const id of Object.keys(PLANT_ART)) assert.ok(ids.has(id), `art for unknown plant ${id}`);
  for (const p of PLANTS) assert.ok(PLANT_ART[p.id], `${p.id} falls back to its kind's generic picture; give it its own`);
});

test('every kind has a fallback picture and every colour is a 6-digit hex', () => {
  for (const kind of new Set(PLANTS.map((p) => p.kind))) assert.ok(KIND_ART[kind], `no fallback picture for kind ${kind}`);
  for (const a of [...Object.values(PLANT_ART), ...Object.values(KIND_ART)]) {
    assert.match(a.main, HEX);
    if (a.alt) assert.match(a.alt, HEX);
  }
  assert.equal(artFor('not-a-plant', 'herb').shape, 'herb');
});
