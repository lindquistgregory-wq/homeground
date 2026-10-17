import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectType } from '../design/library';
import { ANIMALS, animalById, searchAnimals, validateAnimalSpec } from './index';

test('animal database integrity: every species passes the validator', () => {
  const ids = new Set<string>();
  for (const a of ANIMALS) {
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
    assert.deepEqual(validateAnimalSpec(a), [], a.id);
  }
  assert.equal(ANIMALS.length, 21, 'the version-1 species list (prompt §2)');
});

test('every species lives in real map objects and cites real https sources', () => {
  for (const a of ANIMALS) {
    for (const k of a.housingObjects) assert.ok(objectType(k), `${a.id}: unknown housing object ${k}`);
    for (const s of a.sources) assert.match(s.url, /^https:\/\//, `${a.id}: ${s.title}`);
  }
});

test('breeding data: gestation or incubation wherever animals are bred; heritability is sourced', () => {
  for (const a of ANIMALS) {
    if (a.kind === 'pollinator') continue;
    const r = a.reproduction;
    assert.ok(r.gestationDays || r.incubationDays, `${a.id} needs a gestation or incubation period`);
  }
  assert.deepEqual(animalById('coturnix_quail')!.reproduction.incubationDays, [16, 17]);
  assert.deepEqual(animalById('dairy_goats')!.reproduction.heritability!['milk yield']!.value, [0.18, 0.32]);
});

test('social species are never marked fine alone, and safety facts are present where the review requires them', () => {
  for (const a of ANIMALS) if ((a.minGroupSize ?? 0) > 1) assert.equal(a.livesAloneOk, false, a.id);
  for (const a of ANIMALS.filter((x) => x.kind === 'poultry' || x.kind === 'waterfowl')) assert.match(a.biosecurity ?? '', /CDC|children under 5/i, `${a.id}: CDC Salmonella guidance`);
  for (const id of ['dairy_goats', 'meat_goats', 'fiber_goats', 'sheep']) assert.ok(animalById(id)!.regulatory.some((r) => /Scrapie/.test(r)), `${id}: scrapie ID`);
  const sheep = animalById('sheep')!;
  assert.ok(sheep.keepApart.some((k) => /copper/i.test(k.reason)), 'sheep must warn about goat/cattle mineral copper');
  assert.ok(animalById('guardian_llama')!.socialNote!.includes('only one llama'));
  // Never dosing or treatment in the data (prompt §8).
  for (const a of ANIMALS) for (const d of a.diseasesToKnow) assert.ok(!/\d+\s*(mg|ml|cc)\b|\bdos(e|age)\b/i.test(d), `${a.id}: ${d}`);
});

test('search finds species by name, alias and Latin name', () => {
  assert.equal(searchAnimals('chickens')[0]!.id, 'laying_hens');
  assert.ok(searchAnimals('Great Pyrenees').some((a) => a.id === 'guardian_dog'));
  assert.ok(searchAnimals('capra').length >= 3);
  assert.equal(searchAnimals('').length, ANIMALS.length);
});
