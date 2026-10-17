/**
 * Which plants in the library are listed as toxic to people, pets or livestock, and by whom
 * (Safety & Liability Review). Only what a cited source lists is recorded:
 *  - ASPCA Animal Poison Control plant lists for dogs, cats and horses (retrieved 2026-10-16);
 *  - ASPCA "people foods to avoid feeding your pets" (grapes, the onion family, citrus, nuts, avocado);
 *  - this app's plant notes, checked against each plant's extension guide, for people and for
 *    grazing risks (prussic acid, bloat).
 * A plant that isn't listed here is "not listed in the cited sources" — never "safe".
 * Note the ASPCA lists cover the plant (leaves, stems, seeds); the ripe produce people eat can differ.
 */
import type { SafetySource } from './notes';

export type Eater = 'people' | 'dogs' | 'cats' | 'horses' | 'ruminants' | 'poultry' | 'rabbits';
export type ToxicitySourceId = 'aspca-dogs' | 'aspca-cats' | 'aspca-horses' | 'aspca-foods' | 'extension-guide';

export const TOXICITY_SOURCES: Record<ToxicitySourceId, SafetySource> = {
  'aspca-dogs': { title: 'ASPCA: plants toxic to dogs', url: 'https://www.aspca.org/pet-care/animal-poison-control/dogs-plant-list' },
  'aspca-cats': { title: 'ASPCA: plants toxic to cats', url: 'https://www.aspca.org/pet-care/animal-poison-control/cats-plant-list' },
  'aspca-horses': { title: 'ASPCA: plants toxic to horses', url: 'https://www.aspca.org/pet-care/animal-poison-control/horse-plant-list' },
  'aspca-foods': { title: 'ASPCA: people foods to avoid feeding your pets', url: 'https://www.aspca.org/pet-care/aspca-poison-control/people-foods-avoid-feeding-your-pets' },
  // Resolved by the app to the plant's own extension guide (crop-guides.json).
  'extension-guide': { title: 'This plant’s extension guide', url: '' },
};

export interface ToxicityEntry {
  to: Eater[];
  /** Which parts, where the source says (e.g. "leaves"). */
  part?: string;
  /** What it can do, in plain words, where the source says. */
  effect?: string;
  source: ToxicitySourceId;
}

const PETS_HORSES = (part?: string): ToxicityEntry[] => [
  { to: ['dogs'], part, source: 'aspca-dogs' },
  { to: ['cats'], part, source: 'aspca-cats' },
  { to: ['horses'], part, source: 'aspca-horses' },
];
const ALLIUM: ToxicityEntry[] = [
  ...PETS_HORSES(),
  { to: ['dogs', 'cats'], effect: 'can damage red blood cells', source: 'aspca-foods' },
];
const PRUNUS = PETS_HORSES('leaves, stems and seeds or pits');
const CITRUS: ToxicityEntry[] = [{ to: ['dogs', 'cats'], part: 'stems, leaves, peel and seeds in quantity', effect: 'irritation or stomach upset', source: 'aspca-foods' }];
const NUTS: ToxicityEntry[] = [{ to: ['dogs', 'cats'], part: 'nuts', effect: 'vomiting and diarrhoea, possibly pancreatitis', source: 'aspca-foods' }];

export const TOXICITY: Record<string, ToxicityEntry[]> = {
  tomato: PETS_HORSES('leaves, stems and green fruit'),
  onion: ALLIUM,
  garlic: ALLIUM,
  leek: ALLIUM,
  chives: ALLIUM,
  shallot: ALLIUM,
  scallion: [{ to: ['dogs', 'cats'], effect: 'can damage red blood cells', source: 'aspca-foods' }],
  parsley: PETS_HORSES(),
  oregano: PETS_HORSES(),
  mint: PETS_HORSES(),
  lavender: PETS_HORSES(),
  tarragon: PETS_HORSES(),
  rhubarb: [...PETS_HORSES(), { to: ['people'], part: 'leaves', source: 'extension-guide' }],
  sorrel: [...PETS_HORSES(), { to: ['people'], effect: 'high in oxalic acid: eat in moderation', source: 'extension-guide' }],
  apple: PRUNUS,
  apricot: PRUNUS,
  peach: PRUNUS,
  plum: PRUNUS,
  'cherry-sour': PRUNUS,
  'cherry-sweet': PRUNUS,
  almond: NUTS,
  pecan: NUTS,
  'walnut-english': NUTS,
  'walnut-black': [{ to: ['dogs'], source: 'aspca-dogs' }, { to: ['horses'], source: 'aspca-horses' }, ...NUTS],
  orange: [{ to: ['dogs'], source: 'aspca-dogs' }, { to: ['cats'], source: 'aspca-cats' }, { to: ['horses'], source: 'aspca-horses' }, ...CITRUS],
  lemon: [{ to: ['dogs'], source: 'aspca-dogs' }, { to: ['cats'], source: 'aspca-cats' }, { to: ['horses'], source: 'aspca-horses' }, ...CITRUS],
  satsuma: CITRUS,
  buckwheat: PETS_HORSES(),
  grape: [{ to: ['dogs'], part: 'grapes and raisins', effect: 'kidney damage', source: 'aspca-foods' }],
  muscadine: [{ to: ['dogs'], part: 'grapes and raisins', effect: 'kidney damage', source: 'aspca-foods' }],
  avocado: [
    { to: ['horses'], source: 'aspca-horses' },
    { to: ['poultry', 'rabbits', 'horses', 'ruminants'], source: 'aspca-foods' },
  ],
  'sorghum-sudangrass': [
    { to: ['horses'], source: 'aspca-horses' },
    { to: ['ruminants'], effect: 'prussic acid poisoning when grazed young, stressed or after frost', source: 'extension-guide' },
  ],
  alfalfa: [{ to: ['ruminants'], effect: 'can cause bloat when grazed lush', source: 'extension-guide' }],
  'red-clover': [{ to: ['ruminants'], effect: 'can cause bloat when grazed lush', source: 'extension-guide' }],
  elderberry: [{ to: ['people'], part: 'raw or unripe berries, leaves, stems and roots', source: 'extension-guide' }],
  'ground-cherry': [{ to: ['people'], part: 'leaves and green fruit', source: 'extension-guide' }],
};

export interface ToxicityLine {
  to: Eater;
  part?: string;
  effect?: string;
  sources: ToxicitySourceId[];
}

/** One line per animal or group, merging the sources that list it. */
export function toxicityFor(plantId: string): ToxicityLine[] {
  const by = new Map<Eater, ToxicityLine>();
  for (const e of TOXICITY[plantId] ?? [])
    for (const to of e.to) {
      const line = by.get(to) ?? { to, sources: [] };
      line.part ??= e.part;
      line.effect ??= e.effect;
      if (!line.sources.includes(e.source)) line.sources.push(e.source);
      by.set(to, line);
    }
  const order: Eater[] = ['people', 'dogs', 'cats', 'horses', 'ruminants', 'poultry', 'rabbits'];
  return [...by.values()].sort((a, b) => order.indexOf(a.to) - order.indexOf(b.to));
}

export const EATER_LABEL: Record<Eater, string> = {
  people: 'People', dogs: 'Dogs', cats: 'Cats', horses: 'Horses', ruminants: 'Cattle, sheep and goats', poultry: 'Birds and poultry', rabbits: 'Rabbits',
};
