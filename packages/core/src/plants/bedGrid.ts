/**
 * Square-foot grid for a bed (§7.2): which 1 × 1 ft squares each planting occupies, so people can
 * see and plan where every crop sits. Cells are [col, row] with col across the bed's short side and
 * row along its long side; cells outside the grid (after the bed is resized) are ignored, not lost.
 */
import type { PlantSpec } from './types';

export const SQ_FT_M = 0.3048;
/** Beyond this many squares the grid is too dense to tap on a phone; the row layout is used instead. */
export const MAX_GRID_CELLS = 800;

export type Cell = [number, number];
export interface BedGrid { cols: number; rows: number; cells: number }

/** Whole-foot grid for a bed of width × length metres (sides rounded to the nearest foot, at least 1). */
export function bedGrid(widthM: number, lengthM: number): BedGrid {
  const short = Math.min(widthM, lengthM), long = Math.max(widthM, lengthM);
  const cols = Math.max(1, Math.round(short / SQ_FT_M)), rows = Math.max(1, Math.round(long / SQ_FT_M));
  return { cols, rows, cells: cols * rows };
}

export const cellKey = ([c, r]: Cell): string => `${c},${r}`;

/** Keep the cells that fall inside the grid, without duplicates. */
export function cellsInGrid(cells: readonly Cell[] | undefined, grid: BedGrid): Cell[] {
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (const cell of cells ?? []) {
    const [c, r] = cell;
    if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
    const k = cellKey(cell);
    if (!seen.has(k)) { seen.add(k); out.push([c, r]); }
  }
  return out;
}

/**
 * How many plants fit in `squares` square feet at square-foot spacing: the plant's per-square
 * count where published, else its in-row spacing used both ways (e.g. 4 per square at 6 in,
 * 1 per 4 squares at 24 in).
 */
export function plantsInSquares(plant: PlantSpec, squares: number): { plants: number; perSquare?: number; squaresPerPlant?: number } {
  if (squares <= 0) return { plants: 0 };
  if (plant.perSquareFoot) return { plants: squares * plant.perSquareFoot, perSquare: plant.perSquareFoot };
  const s = plant.spacingIn.inRow;
  if (s <= 12) {
    const perSquare = Math.max(1, Math.floor(12 / s) ** 2);
    return { plants: squares * perSquare, perSquare };
  }
  const squaresPerPlant = Math.ceil(s / 12) ** 2;
  return { plants: Math.floor(squares / squaresPerPlant), squaresPerPlant };
}

/**
 * Give `cells` to one planting: they are added to it (or, if every one is already its own, taken
 * away from it) and removed from every other planting, since a square holds one crop.
 */
export function assignCells(layout: Record<string, Cell[]>, plantingId: string, cells: readonly Cell[]): Record<string, Cell[]> {
  const keys = new Set(cells.map(cellKey));
  const mine = new Set((layout[plantingId] ?? []).map(cellKey));
  const remove = cells.length > 0 && cells.every((c) => mine.has(cellKey(c)));
  const out: Record<string, Cell[]> = {};
  for (const [id, cs] of Object.entries(layout)) out[id] = cs.filter((c) => !keys.has(cellKey(c)));
  if (!remove) out[plantingId] = [...(out[plantingId] ?? []), ...cells.map((c) => [c[0], c[1]] as Cell)];
  return out;
}
