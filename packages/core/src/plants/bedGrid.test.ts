import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignCells, bedGrid, cellsInGrid, plantMarks, plantsInSquares, plantById, type Cell } from './index';

const ft = (n: number) => n * 0.3048;
const p = (id: string) => plantById(id)!;

test('a 4 × 8 ft bed is a 4 × 8 grid, whichever way it was drawn', () => {
  assert.deepEqual(bedGrid(ft(4), ft(8)), { cols: 4, rows: 8, cells: 32 });
  assert.deepEqual(bedGrid(ft(8), ft(4)), { cols: 4, rows: 8, cells: 32 });
  assert.deepEqual(bedGrid(0.1, 0.1), { cols: 1, rows: 1, cells: 1 });
  assert.equal(bedGrid(ft(3.4), ft(10.6)).cols, 3);
});

test('cells outside a resized bed and duplicates are dropped', () => {
  const g = bedGrid(ft(4), ft(4));
  assert.deepEqual(cellsInGrid([[0, 0], [0, 0], [3, 3], [4, 0], [0, 9], [-1, 0], [1.5, 1]], g), [[0, 0], [3, 3]]);
  assert.deepEqual(cellsInGrid(undefined, g), []);
});

test('plants per square follow square-foot spacing', () => {
  assert.deepEqual(plantsInSquares(p('carrot'), 2), { plants: 2 * p('carrot').perSquareFoot!, perSquare: p('carrot').perSquareFoot });
  const tomato = plantsInSquares(p('tomato'), 8);
  assert.equal(tomato.squaresPerPlant, Math.ceil(p('tomato').spacingIn.inRow / 12) ** 2);
  assert.equal(tomato.plants, Math.floor(8 / tomato.squaresPerPlant!));
  assert.deepEqual(plantsInSquares(p('tomato'), 0), { plants: 0 });
});

test('a square holds one crop: assigning moves it, re-tapping your own squares clears them', () => {
  let l = assignCells({}, 'a', [[0, 0], [1, 0]]);
  assert.deepEqual(l, { a: [[0, 0], [1, 0]] });
  l = assignCells(l, 'b', [[1, 0]]);
  assert.deepEqual(l, { a: [[0, 0]], b: [[1, 0]] });
  l = assignCells(l, 'b', [[1, 0]]);
  assert.deepEqual(l, { a: [[0, 0]], b: [] });
  l = assignCells(l, 'a', [[0, 0], [0, 1]]);
  assert.deepEqual(l.a, [[0, 0], [0, 1]]);
});

test('plant marks: small crops share squares, big crops get one plant per block', () => {
  const lettuce = p('lettuce'), tomato = p('tomato');
  const perLettuce = plantsInSquares(lettuce, 1).perSquare ?? 1;
  assert.equal(plantMarks(lettuce, [[0, 0], [1, 0]]).length, 2 * perLettuce);
  for (const m of plantMarks(lettuce, [[1, 2]])) assert.ok(m.x > 1 && m.x < 2 && m.y > 2 && m.y < 3);
  // Tomato: 4 squares each. A 2 × 2 block is one plant centred in the block.
  const block = plantMarks(tomato, [[0, 0], [1, 0], [0, 1], [1, 1]]);
  assert.deepEqual(block.map(({ x, y }) => [x, y]), [[1, 1]]);
  // Eight squares in a 1-wide strip still make two plants, matching plantsInSquares.
  const strip: Cell[] = Array.from({ length: 8 }, (_, r) => [0, r] as Cell);
  assert.equal(plantMarks(tomato, strip).length, plantsInSquares(tomato, 8).plants);
  assert.equal(plantMarks(tomato, [[0, 0]]).length, 0);
});
