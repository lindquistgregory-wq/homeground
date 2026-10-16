import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PLANTS, allPlants, blankPlantSpec, plantById, plantCalendar, plantMarks, searchPlants, setCustomPlants, validatePlantSpec, type PlantSpec,
} from './index';

test('every bundled plant passes the custom-plant validator (same rules as the database test)', () => {
  for (const p of PLANTS) assert.deepEqual(validatePlantSpec(p), [], p.id);
});

test('a blank spec of each kind is valid once it has a name', () => {
  for (const kind of ['vegetable', 'herb', 'berry', 'fruit-tree', 'nut-tree', 'vine-fruit', 'cover-crop', 'flower', 'field-crop'] as const) {
    const p = blankPlantSpec(`custom-${kind}`, kind);
    assert.ok(validatePlantSpec(p).some((e) => /name/.test(e)), `${kind} needs a name`);
    assert.deepEqual(validatePlantSpec({ ...p, commonName: 'Test' }), [], kind);
  }
});

test('the validator catches the mistakes that would break calendars and layouts', () => {
  const ok: PlantSpec = { ...blankPlantSpec('custom-x'), commonName: 'X' };
  assert.ok(validatePlantSpec({ ...ok, sunHours: { min: 9, ideal: 6 } }).length);
  assert.ok(validatePlantSpec({ ...ok, soil: { ...ok.soil, pH: [7.5, 6] } }).length);
  assert.ok(validatePlantSpec({ ...ok, daysToMaturity: [90, 60] }).length);
  assert.ok(validatePlantSpec({ ...ok, sowing: { method: 'direct' } }).length);
  assert.ok(validatePlantSpec({ ...ok, spacingIn: { inRow: 24, betweenRows: 6 } }).length);
  assert.ok(validatePlantSpec({ ...ok, lifecycle: 'perennial', kind: 'berry', zones: undefined }).length);
});

test('registered custom plants are found, searched and laid out like bundled ones', () => {
  const mine: PlantSpec = { ...blankPlantSpec('custom-abc'), commonName: 'Purple hull pea', aliases: ['pinkeye'] };
  setCustomPlants([mine, { ...mine, id: 'not-custom' }]);
  try {
    assert.equal(plantById('custom-abc')?.commonName, 'Purple hull pea');
    assert.equal(plantById('not-custom'), undefined, 'only custom- ids are registered');
    assert.equal(allPlants().length, PLANTS.length + 1);
    assert.equal(searchPlants('pinkeye')[0]?.id, 'custom-abc');
    assert.ok(plantMarks(mine, [[0, 0]]).length > 0);
    const q = { 10: 100, 50: 110, 90: 120 }, f = { 10: 280, 50: 290, 90: 300 };
    const frost = { lastSpring: { 28: q, 32: q }, firstFall: { 28: f, 32: f } } as never;
    // A plain annual gets a sowing window from its frost-relative days.
    assert.ok(plantCalendar(mine, { frost }).events.some((e) => e.kind === 'direct-sow'));
  } finally {
    setCustomPlants([]);
  }
  assert.equal(plantById('custom-abc'), undefined);
});
