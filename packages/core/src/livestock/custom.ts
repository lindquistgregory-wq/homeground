/**
 * Animals the user adds themselves (prompt §4/§5, phase 7; free), mirroring plants/custom.ts. They
 * use the same AnimalSpec, so fit, capacity, the care calendar, alerts and records all work. The app
 * registers them at start-up and after each edit. Ids start with "custom-" so they never collide with
 * a bundled species. Figures are the user's own, so the app labels them as such.
 */
import type { AnimalKind, AnimalSpec } from './types';

export const CUSTOM_ANIMAL_PREFIX = 'custom-';
export const isCustomAnimalId = (id: string): boolean => id.startsWith(CUSTOM_ANIMAL_PREFIX);

let custom: AnimalSpec[] = [];
let byId = new Map<string, AnimalSpec>();

/** Replace the registered custom animals (the app's store calls this after loading or editing). */
export function setCustomAnimals(list: AnimalSpec[]): void {
  custom = list.filter((a) => isCustomAnimalId(a.id));
  byId = new Map(custom.map((a) => [a.id, a]));
}

export function customAnimals(): AnimalSpec[] {
  return custom;
}

export function customAnimalById(id: string): AnimalSpec | undefined {
  return byId.get(id);
}

const HOUSING: Record<AnimalKind, string[]> = {
  poultry: ['chicken-coop', 'chicken-run', 'barn'],
  waterfowl: ['duck-house', 'chicken-run', 'barn'],
  'small-stock': ['rabbit-hutch', 'barn'],
  ruminant: ['goat-shelter', 'paddock', 'barn'],
  pig: ['paddock', 'barn'],
  cattle: ['paddock', 'barn'],
  pollinator: ['beehive'],
  working: ['paddock', 'barn', 'goat-shelter'],
};

/**
 * A starting point for a new animal of this kind. Unknown figures stay null (unsourced) rather than
 * guessed; the user fills in what they know, or copies a library species instead.
 */
export function blankAnimalSpec(id: string, kind: AnimalKind = 'poultry'): AnimalSpec {
  return {
    id, commonName: '', scientificName: '', kind, purposes: [], unit: 'per animal',
    minGroupSize: kind === 'pollinator' ? 1 : 2, starterGroupSize: null, maleNeeded: null, livesAloneOk: kind === 'pollinator',
    heat: { tolerance: null }, cold: { tolerance: null }, shadeNeeded: true,
    spaceIndoorSqFt: null, spaceOutdoorSqFt: null, pastureAcresPerHead: null, housingObjects: HOUSING[kind],
    waterGalPerDay: null, production: {}, reproduction: {},
    lifespanYears: null, laborHoursPerWeek: null, noise: null,
    predators: [], diseasesToKnow: [], companions: [], keepApart: [],
    regulatory: ['Check local code: zoning often limits animals, numbers and setbacks.'],
    breeds: [], notes: ['Added by you: the figures are your own, not from a source.'], sources: [],
  };
}

/** A copy of a library species to adjust, under a new custom id. */
export function copyAnimalSpec(from: AnimalSpec, id: string): AnimalSpec {
  const c = JSON.parse(JSON.stringify(from)) as AnimalSpec;
  return { ...c, id, commonName: `${from.commonName} (my version)`, notes: [...c.notes, `Copied from ${from.commonName}; edited by you.`] };
}
