/** Shared helpers for the animal screens. */
import type { AnimalSite } from '@plotwright/core';
import type { GardenState } from './useGarden';

const ACRE_M2 = 4046.86;

/** The property facts the animal fit score uses, from the loaded garden state. */
export function siteForAnimals(state: GardenState): AnimalSite {
  return { zone: state.site.zone, peakSummerMaxF: state.site.peakSummerMaxF, summerRhPct: state.site.summerRhPct, parcelAcres: state.parcel.areaM2 / ACRE_M2 };
}
