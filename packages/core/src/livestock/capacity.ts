/**
 * How many animals a housing object holds (prompt §4), at the protective (larger) sourced space
 * per animal. Overcrowding is a welfare issue, so this check is free and always shown.
 */
import { footprintAreaM2, type DesignObject } from '../design/design';
import type { LocalFrame } from '../geo/measure';
import { pastureAcres, spacePerHeadSqFt } from './safetyDefaults';
import type { AnimalSpec } from './types';

const SQFT_PER_M2 = 10.7639;
const SQFT_PER_ACRE = 43560;

const INDOOR = new Set(['chicken-coop', 'duck-house', 'rabbit-hutch', 'goat-shelter', 'barn']);
const OUTDOOR = new Set(['chicken-run']);

export interface Capacity {
  /** Animals that fit, or null when no sourced space figure applies to this housing. */
  fits: number | null;
  planned: number;
  limitingFactor: 'indoor space' | 'outdoor space' | 'pasture' | 'hives' | 'no sourced figure';
  /** Plain explanation with the figure used. */
  basis: string;
}

export function housingCapacity(a: AnimalSpec, o: DesignObject, frame: LocalFrame, planned: number): Capacity {
  const sqft = footprintAreaM2(o, frame) * SQFT_PER_M2;
  if (o.kind === 'beehive') return { fits: 1, planned, limitingFactor: 'hives', basis: 'One colony per hive.' };
  const per = (where: 'indoor' | 'outdoor') => spacePerHeadSqFt(a, where);
  if (INDOOR.has(o.kind) && per('indoor')) {
    const each = per('indoor')!;
    return { fits: Math.floor(sqft / each), planned, limitingFactor: 'indoor space', basis: `${Math.round(sqft)} sq ft at ${each} sq ft each (the larger cited figure).` };
  }
  if (OUTDOOR.has(o.kind) && per('outdoor')) {
    const each = per('outdoor')!;
    return { fits: Math.floor(sqft / each), planned, limitingFactor: 'outdoor space', basis: `${Math.round(sqft)} sq ft at ${each} sq ft each (the larger cited figure).` };
  }
  if (o.kind === 'paddock') {
    const acres = pastureAcres(a);
    if (acres) {
      const area = sqft / SQFT_PER_ACRE;
      return { fits: Math.floor(area / acres), planned, limitingFactor: 'pasture', basis: `${area.toFixed(2)} acres at ${acres} acre each (the larger cited figure).` };
    }
    if (per('outdoor')) {
      const each = per('outdoor')!;
      return { fits: Math.floor(sqft / each), planned, limitingFactor: 'outdoor space', basis: `${Math.round(sqft)} sq ft at ${each} sq ft each.` };
    }
  }
  return { fits: null, planned, limitingFactor: 'no sourced figure', basis: `No sourced space figure for ${a.commonName.toLowerCase()} in this kind of housing; ask your extension office.` };
}
