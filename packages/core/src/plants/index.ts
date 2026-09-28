import type { PlantSpec } from './types';
import { VEGETABLES } from './vegetables';
import { COVER_CROPS, FRUIT, HERBS } from './fruitHerbs';

export * from './types';
export * from './seasonModel';
export * from './calendar';
export * from './suitability';
export * from './garden';

/** Every bundled plant. */
export const PLANTS: PlantSpec[] = [...VEGETABLES, ...HERBS, ...FRUIT, ...COVER_CROPS];

const byId = new Map(PLANTS.map((p) => [p.id, p]));
export function plantById(id: string): PlantSpec | undefined {
  return byId.get(id);
}

export function searchPlants(query: string, list: PlantSpec[] = PLANTS): PlantSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) => p.commonName.toLowerCase().includes(q) || p.scientificName.toLowerCase().includes(q) || p.family.toLowerCase().includes(q));
}
