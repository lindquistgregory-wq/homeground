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

/** A plant drawn in the bed: centre (x, y) and diameter in square-foot units from the bed's top-left. */
export interface PlantMark { x: number; y: number; size: number }

/**
 * Where to draw each plant in a planting's squares. Small crops sit several to a square on an even
 * sub-grid (4 lettuces, 16 carrots). A crop needing k × k squares gets one plant per full k × k
 * block of its squares, then one per leftover group of k² squares, so the count always equals
 * plantsInSquares(plant, squares).plants.
 */
export function plantMarks(plant: PlantSpec, cells: readonly Cell[]): PlantMark[] {
  const fit = plantsInSquares(plant, 1);
  const sorted = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (!fit.squaresPerPlant) {
    const n = fit.perSquare ?? 1, side = Math.ceil(Math.sqrt(n));
    const out: PlantMark[] = [];
    for (const [c, r] of sorted)
      for (let i = 0; i < n; i++) out.push({ x: c + ((i % side) + 0.5) / side, y: r + (Math.floor(i / side) + 0.5) / side, size: 0.9 / side });
    return out;
  }
  const spp = fit.squaresPerPlant, k = Math.round(Math.sqrt(spp));
  const mine = new Set(sorted.map(cellKey));
  const claimed = new Set<string>();
  const out: PlantMark[] = [];
  for (const [c, r] of sorted) {
    if (claimed.has(cellKey([c, r]))) continue;
    const block: Cell[] = [];
    for (let dr = 0; dr < k; dr++) for (let dc = 0; dc < k; dc++) block.push([c + dc, r + dr]);
    if (block.every((b) => mine.has(cellKey(b)) && !claimed.has(cellKey(b)))) {
      block.forEach((b) => claimed.add(cellKey(b)));
      out.push({ x: c + k / 2, y: r + k / 2, size: k * 0.9 });
    }
  }
  const rest = sorted.filter((cell) => !claimed.has(cellKey(cell)));
  for (let i = 0; i + spp <= rest.length; i += spp) {
    const group = rest.slice(i, i + spp);
    out.push({ x: group.reduce((s, g) => s + g[0] + 0.5, 0) / spp, y: group.reduce((s, g) => s + g[1] + 0.5, 0) / spp, size: k * 0.9 });
  }
  return out;
}
