/** The planner quotes these numbers, so the bundled knowledge base must be complete and well-formed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '@plotwright/core';
import { HOMESTEAD_KB, NUTRITION_KB } from '@plotwright/data';

const isRange = (r: unknown) => Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number') && (r as number[])[0]! <= (r as number[])[1]!;

/** Walk an object and check every [low, high] numeric pair is ordered. */
function checkRanges(o: unknown, path: string) {
  if (Array.isArray(o)) {
    if (o.length === 2 && o.every((x) => typeof x === 'number')) assert.ok(isRange(o), `${path} range out of order: ${JSON.stringify(o)}`);
    else o.forEach((x, i) => checkRanges(x, `${path}[${i}]`));
  } else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) checkRanges(v, `${path}.${k}`);
}

test('every plant has a nutrition entry; food entries have sane values and a USDA id', () => {
  for (const p of PLANTS) {
    const f = NUTRITION_KB.foods[p.id];
    assert.ok(f, `${p.id} missing from nutrition.json`);
    if (!f.food || !f.per100g) continue;
    for (const [k, v] of Object.entries(f.per100g)) assert.ok(v === null || (typeof v === 'number' && v >= 0), `${p.id}.${k}`);
    assert.ok(f.ediblePortion === null || f.ediblePortion === undefined || (f.ediblePortion > 0 && f.ediblePortion <= 1), `${p.id} edible portion`);
    if (f.per100g.kcal !== null) assert.ok(f.fdcId, `${p.id} has values but no FDC id`);
  }
  for (const id of ['eggs-chicken', 'eggs-duck', 'chicken-meat', 'pork', 'goat-milk', 'honey']) assert.ok(NUTRITION_KB.foods[id]?.per100g?.kcal, id);
});

test('household needs tables cover every age band for both sexes', () => {
  const bands = ['1-3', '4-8', '9-13', '14-18', '19-30', '31-50', '51-70', '71+'] as const;
  for (const b of bands) for (const s of ['male', 'female'] as const) {
    const t = NUTRITION_KB.dri.rda.byBand[b][s];
    for (const v of Object.values(t)) assert.ok(typeof v === 'number' && v > 0, `${b} ${s}`);
  }
  assert.ok(NUTRITION_KB.dri.energy.byAge.length >= 25);
});

test('every livestock, enterprise, infrastructure and preservation entry is sourced and its ranges are ordered', () => {
  for (const sec of ['livestock', 'enterprises', 'infrastructure'] as const) {
    for (const [id, e] of Object.entries(HOMESTEAD_KB[sec])) {
      const src = (e as { sources?: Array<{ url: string }> }).sources ?? [];
      // An entry with no figures (all null, e.g. nothing reliable found) needs no source; any number does.
      const hasNumbers = JSON.stringify({ ...(e as object), sources: undefined }).match(/:\s*\[?-?\d/);
      if (hasNumbers) assert.ok(src.length > 0, `${sec}.${id} has figures but no source`);
      assert.ok(src.every((s) => /^https:\/\//.test(s.url)), `${sec}.${id} sources must be https`);
      checkRanges(e, `${sec}.${id}`);
    }
  }
  for (const [id, e] of Object.entries(HOMESTEAD_KB.preservation)) if (typeof e === 'object') assert.ok(e.sources.length > 0, `preservation.${id}`);
  assert.match(HOMESTEAD_KB.preservation.safetyNote, /tested/i);
});
