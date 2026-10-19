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

const INDOOR = new Set(['chicken-coop', 'duck-house', 'rabbit-hutch', 'goat-shelter', 'barn', 'run-in-shed', 'stable', 'kennel', 'worm-bin']);
const OUTDOOR = new Set(['chicken-run']);
const GRAZING = new Set(['paddock', 'pasture']);

export interface Capacity {
  /** Animals that fit, or null when no sourced space figure applies to this housing. */
  fits: number | null;
  planned: number;
  limitingFactor: 'indoor space' | 'outdoor space' | 'pasture' | 'hives' | 'pond' | 'no sourced figure';
  /** Plain explanation with the figure used. */
  basis: string;
}

export function housingCapacity(a: AnimalSpec, o: DesignObject, frame: LocalFrame, planned: number): Capacity {
  const sqft = footprintAreaM2(o, frame) * SQFT_PER_M2;
  if (o.kind === 'beehive' && a.kind === 'pollinator') return { fits: 1, planned, limitingFactor: 'hives', basis: 'One colony per hive.' };
  if (o.kind === 'pond' && a.stockingPerAcre) {
    const area = sqft / SQFT_PER_ACRE, per = a.stockingPerAcre[0];
    return { fits: Math.floor(area * per), planned, limitingFactor: 'pond', basis: `${area.toFixed(2)} surface acres at ${per} per acre (the lower cited stocking rate).${area < 1 ? ' Stocking guides are written for ponds of 1 acre or more: ask your extension office about a smaller pond.' : ''}` };
  }
  const per = (where: 'indoor' | 'outdoor') => spacePerHeadSqFt(a, where);
  if (INDOOR.has(o.kind) && per('indoor')) {
    const each = per('indoor')!;
    return { fits: Math.floor(sqft / each), planned, limitingFactor: 'indoor space', basis: `${Math.round(sqft)} sq ft at ${each} sq ft each (the larger cited figure).` };
  }
  if (OUTDOOR.has(o.kind) && per('outdoor')) {
    const each = per('outdoor')!;
    return { fits: Math.floor(sqft / each), planned, limitingFactor: 'outdoor space', basis: `${Math.round(sqft)} sq ft at ${each} sq ft each (the larger cited figure).` };
  }
  if (GRAZING.has(o.kind)) {
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
