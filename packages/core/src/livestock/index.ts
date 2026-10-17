/**
 * Animal library (docs/prompts/LIVESTOCK_PROMPT.md): the counterpart of plants/index.ts. One
 * typed list, lookups and search with aliases, and a validator that the bundled species are
 * tested against (and that custom animals will be checked with).
 */
import { BEES, WORKING } from './working';
import { LARGE_STOCK } from './largeStock';
import { POULTRY } from './poultry';
import { SMALL_STOCK } from './smallStock';
import type { AnimalRange as Range, AnimalSpec } from './types';

export * from './types';
export { SRC as ANIMAL_SOURCES } from './sources';

export const ANIMALS: AnimalSpec[] = [...POULTRY, ...SMALL_STOCK, ...LARGE_STOCK, ...BEES, ...WORKING];

const byId = new Map(ANIMALS.map((a) => [a.id, a]));

export function animalById(id: string): AnimalSpec | undefined {
  return byId.get(id);
}

export function allAnimals(): AnimalSpec[] {
  return ANIMALS;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Name, alias or Latin-name search; best matches first. */
export function searchAnimals(query: string, list: AnimalSpec[] = allAnimals()): AnimalSpec[] {
  const q = norm(query);
  if (!q) return list;
  const scored = list.flatMap((a) => {
    const names = [a.commonName, ...(a.aliases ?? [])].map(norm);
    const score = names.some((n) => n === q) ? 3 : names.some((n) => n.startsWith(q)) ? 2 : names.some((n) => n.includes(q)) || norm(a.scientificName).includes(q) ? 1 : 0;
    return score ? [{ a, score }] : [];
  });
  return scored.sort((x, y) => y.score - x.score || x.a.commonName.localeCompare(y.a.commonName)).map((x) => x.a);
}

const ordered = (r: Range | null | undefined) => !r || (Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] <= r[1] && r[0] >= 0);

/** Problems that would make a spec misbehave; empty when usable. Bundled species must all pass. */
export function validateAnimalSpec(a: AnimalSpec, known: ReadonlySet<string> = new Set(ANIMALS.map((x) => x.id))): string[] {
  const e: string[] = [];
  if (!a.commonName.trim()) e.push('Give the animal a name.');
  if (!a.purposes.length) e.push('Choose at least one purpose.');
  if (!a.housingObjects.length) e.push('Choose where it can live on the map.');
  const ranges: Array<[string, Range | null | undefined]> = [
    ['indoor space', a.spaceIndoorSqFt], ['outdoor space', a.spaceOutdoorSqFt], ['pasture', a.pastureAcresPerHead], ['water', a.waterGalPerDay],
    ['feed', a.feedLbPerYear], ['feed per grow-out', a.feedLbPerGrowOut], ['lifespan', a.lifespanYears], ['labor', a.laborHoursPerWeek], ['starter group', a.starterGroupSize],
    ['eggs', a.production.eggsPerYear], ['milk', a.production.milkLbPerLactation], ['grow-out', a.production.growOutDays], ['fiber', a.production.fiberLbPerYear],
    ['gestation', a.reproduction.gestationDays], ['incubation', a.reproduction.incubationDays], ['litter size', a.reproduction.litterSize],
  ];
  for (const [label, r] of ranges) if (!ordered(r)) e.push(`${label[0]!.toUpperCase()}${label.slice(1)}: enter a range, lowest first.`);
  if (a.minGroupSize !== null && a.minGroupSize > 1 && a.livesAloneOk) e.push('A species with a minimum group size can’t be marked as fine alone.');
  if (a.heat.airOnsetF !== undefined && !(a.heat.airOnsetF > 32 && a.heat.airOnsetF < 120)) e.push('Heat: the onset temperature looks wrong.');
  if (a.heat.thiOnset !== undefined && !a.heat.thiScale) e.push('Heat: name the THI scale the threshold comes from.');
  for (const id of [...a.companions, ...a.keepApart.map((k) => k.id)]) if (!known.has(id)) e.push(`Unknown animal in companions or keep-apart: ${id}.`);
  for (const b of a.breeds) if (b.source !== undefined && !a.sources[b.source]) e.push(`Breed ${b.name}: its source is missing.`);
  for (const [trait, h] of Object.entries(a.reproduction.heritability ?? {})) {
    if (!a.sources[h.source]) e.push(`Heritability of ${trait}: its source is missing.`);
    if (!(h.value[0] >= 0 && h.value[1] <= 1 && h.value[0] <= h.value[1])) e.push(`Heritability of ${trait}: must be between 0 and 1.`);
  }
  if (!a.sources.length) e.push('Add at least one source.');
  return e;
}
