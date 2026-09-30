/**
 * Siting assistant (§6): a 0–1 suitability surface for placing a chosen object, with the reasons
 * behind each score so the UI can explain the heatmap.
 */
import { like, type Grid } from '../raster/grid';

export interface SitingInputs {
  /** Direct-sun hours on the winter solstice. */
  winterSun?: Grid;
  /** Direct-sun hours at midsummer. */
  summerSun?: Grid;
  slope?: Grid;
  /** Cold-air pooling index (metres below surroundings). */
  pooling?: Grid;
  /** 1 inside the parcel. */
  parcelMask: Grid;
}

export type SitingTarget = 'greenhouse' | 'coop' | 'garden' | 'orchard' | 'solar';

export interface SitingResult {
  score: Grid;
  factors: string[];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function siteSuitability(target: SitingTarget, inp: SitingInputs): SitingResult {
  const out = like(inp.parcelMask, NaN);
  const v = (g: Grid | undefined, k: number) => (g ? g.data[k]! : NaN);
  const factors: string[] = [];
  const add = (f: string, used: boolean) => used && factors.push(f);
  add('Winter sun (more is better)', !!inp.winterSun && (target === 'greenhouse' || target === 'solar'));
  add('Summer sun', !!inp.summerSun && target === 'solar');
  add('Some summer shade (4–9 h of sun suits birds)', !!inp.summerSun && target === 'coop');
  add('Summer sun (6 h+ for vegetables)', !!inp.summerSun && (target === 'garden' || target === 'orchard'));
  add('Gentle slope', !!inp.slope);
  add('Not in a frost pocket', !!inp.pooling && target !== 'coop' && target !== 'solar');
  add('Not in a wet low spot', !!inp.pooling && target === 'coop');

  for (let k = 0; k < out.data.length; k++) {
    if (!inp.parcelMask.data[k]) continue;
    const slope = v(inp.slope, k), pool = v(inp.pooling, k), win = v(inp.winterSun, k), sum = v(inp.summerSun, k);
    let s = 1, w = 0, acc = 0;
    const term = (value: number, weight: number) => {
      if (Number.isNaN(value)) return;
      acc += value * weight;
      w += weight;
    };
    const slopeOk = Number.isNaN(slope) ? NaN : clamp01(1 - slope / 15);
    const poolOk = Number.isNaN(pool) ? NaN : clamp01(1 - Math.max(0, pool) / 3);
    switch (target) {
      case 'greenhouse':
        term(Number.isNaN(win) ? NaN : clamp01(win / 6), 3);
        term(slopeOk, 1.5);
        term(poolOk, 1.5);
        break;
      case 'solar':
        term(Number.isNaN(win) ? NaN : clamp01(win / 6), 2);
        term(Number.isNaN(sum) ? NaN : clamp01(sum / 12), 2);
        term(slopeOk, 1);
        break;
      case 'coop':
        // Some summer shade is good for birds (4–9 h of direct sun), plus drainage.
        term(Number.isNaN(sum) ? NaN : clamp01(1 - Math.abs(sum - 6.5) / 6.5), 2);
        term(slopeOk, 1);
        term(Number.isNaN(pool) ? NaN : clamp01(1 - Math.max(0, pool) / 2), 1); // wet low spots
        break;
      case 'garden':
      case 'orchard':
        term(Number.isNaN(sum) ? NaN : clamp01(sum / 8), 3);
        term(slopeOk, target === 'garden' ? 1.5 : 0.5);
        term(poolOk, target === 'orchard' ? 2.5 : 1); // blossom frost matters most for fruit trees
        break;
    }
    s = w > 0 ? acc / w : NaN;
    out.data[k] = s;
  }
  return { score: out, factors };
}
