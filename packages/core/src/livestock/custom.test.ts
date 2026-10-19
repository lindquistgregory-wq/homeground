import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allAnimals, animalById, blankAnimalSpec, copyAnimalSpec, isCustomAnimalId, searchAnimals, setCustomAnimals, validateAnimalSpec } from './index';

test('custom animals: blank spec needs a name and purpose; then it validates without sources', () => {
  const b = blankAnimalSpec('custom-1', 'poultry');
  const errs = validateAnimalSpec(b, undefined, { custom: true });
  assert.ok(errs.some((e) => /name/.test(e)) && errs.some((e) => /purpose/.test(e)));
  assert.ok(!errs.some((e) => /source/.test(e)), 'no source required for the user’s own figures');
  const ok = { ...b, commonName: 'Silkie bantams', purposes: ['eggs' as const] };
  assert.deepEqual(validateAnimalSpec(ok, undefined, { custom: true }), []);
  assert.ok(validateAnimalSpec(ok).some((e) => /source/.test(e)), 'bundled species still need sources');
  assert.deepEqual(b.housingObjects, ['chicken-coop', 'chicken-run', 'barn']);
});

test('custom animals register alongside the library and can copy a species', () => {
  const copy = copyAnimalSpec(animalById('dairy_goats')!, 'custom-goat');
  assert.equal(copy.heat.thiOnset, animalById('dairy_goats')!.heat.thiOnset, 'safety figures carry over');
  assert.match(copy.commonName, /my version/);
  setCustomAnimals([copy, { ...blankAnimalSpec('not-custom'), commonName: 'Sneaky' }]);
  assert.equal(animalById('custom-goat')?.commonName, copy.commonName);
  assert.equal(animalById('not-custom'), undefined, 'ids without the prefix are ignored');
  assert.ok(allAnimals().some((a) => a.id === 'custom-goat'));
  assert.equal(searchAnimals('my version')[0]?.id, 'custom-goat');
  assert.ok(isCustomAnimalId('custom-goat'));
  setCustomAnimals([]);
  assert.equal(animalById('custom-goat'), undefined);
});
