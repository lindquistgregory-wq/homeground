import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaMembers, inDrawnArea, linkToArea, newObject, type DesignObject } from './design';

const garden: DesignObject = { ...newObject('custom-area', { lon: 0.0005, lat: 0.0005 }, 'garden'), polygon: [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]] };
const at = (kind: string, lon: number, lat: number, id: string) => newObject(kind, { lon, lat }, id);
const bed = at('raised-bed', 0.0002, 0.0002, 'bed'), coop = at('chicken-coop', 0.0008, 0.0006, 'coop'), shed = at('tool-shed', 0.002, 0.002, 'shed');

test('objects inside a hand-drawn area belong to it automatically; others can be added and removed by hand', () => {
  const all = [garden, bed, coop, shed];
  assert.deepEqual(areaMembers(garden, all).map((m) => `${m.object.id}:${m.how}`), ['bed:inside', 'coop:inside']);
  const withShed = linkToArea(garden, 'shed', true, all);
  assert.deepEqual(withShed.linkedIds, ['shed']);
  assert.deepEqual(areaMembers(withShed, all).map((m) => `${m.object.id}:${m.how}`), ['bed:inside', 'coop:inside', 'shed:linked']);
  const noCoop = linkToArea(withShed, 'coop', false, all);
  assert.deepEqual(noCoop.unlinkedIds, ['coop'], 'an inside object taken off is remembered');
  assert.deepEqual(areaMembers(noCoop, all).map((m) => m.object.id), ['bed', 'shed']);
  const back = linkToArea(linkToArea(noCoop, 'coop', true, all), 'shed', false, all);
  assert.equal(back.linkedIds, undefined);
  assert.equal(back.unlinkedIds, undefined);
  assert.ok(inDrawnArea(garden, [0.0005, 0.0005]) && !inDrawnArea(garden, [0.002, 0.002]));
  assert.deepEqual(areaMembers(bed, all), [], 'only drawn areas hold members');
});
