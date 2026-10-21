import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simplifyPath, tidyStroke } from './draw';
import { objectType } from './library';

test('a wobbly straight stroke simplifies to its ends', () => {
  const pts: Array<[number, number]> = Array.from({ length: 50 }, (_, i) => [i * 4, 100 + (i % 2 ? 1 : -1)]);
  assert.deepEqual(simplifyPath(pts, 3), [pts[0], pts[49]]);
  const t = tidyStroke(pts)!;
  assert.equal(t.closed, false);
  assert.equal(t.points.length, 2);
});

test('a loop that ends near its start becomes a closed area; a tap is ignored', () => {
  const circle: Array<[number, number]> = Array.from({ length: 80 }, (_, i) => [200 + 100 * Math.cos((i / 79) * 2 * Math.PI), 300 + 100 * Math.sin((i / 79) * 2 * Math.PI)]);
  const t = tidyStroke(circle)!;
  assert.equal(t.closed, true);
  assert.ok(t.points.length >= 6 && t.points.length <= 60, String(t.points.length));
  assert.equal(tidyStroke([[10, 10], [12, 11]]), null);
  // An L-shaped fence stays open.
  const l: Array<[number, number]> = [...Array.from({ length: 20 }, (_, i) => [i * 10, 0] as [number, number]), ...Array.from({ length: 20 }, (_, i) => [190, i * 10] as [number, number])];
  const lt = tidyStroke(l)!;
  assert.equal(lt.closed, false);
  assert.equal(lt.points.length, 3);
});

test('drawn objects exist in the library', () => {
  assert.equal(objectType('custom-line')?.shape, 'line');
  assert.ok(objectType('custom-area'));
});

test('vineyard row starts at 30 × 6 ft and the orchard is a plantable block; both get the dig-safe note', async () => {
  const { safetyNotesFor } = await import('../safety/notes');
  const row = objectType('vineyard-row')!;
  assert.equal(Math.round(row.length / 0.3048), 30);
  assert.equal(Math.round(row.width / 0.3048), 6);
  assert.equal(row.category, 'growing');
  const orchard = objectType('orchard')!;
  assert.equal(orchard.category, 'trees');
  assert.equal(Math.round(orchard.length / 0.3048), 60);
  for (const k of ['vineyard-row', 'orchard']) assert.ok(safetyNotesFor(k).some((n) => n.id === 'dig811'), k);
});
