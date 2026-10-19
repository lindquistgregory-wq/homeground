/** Which drawing and colours each animal gets in AnimalArt. Pure data so scripts can check it. */
export type AnimalShape =
  | 'hen' | 'turkey' | 'duck' | 'goose' | 'guinea' | 'quail' | 'rabbit' | 'goat' | 'sheep' | 'pig' | 'cow'
  | 'bee' | 'donkey' | 'llama' | 'dog' | 'cat';

export interface AnimalArtSpec { shape: AnimalShape; main: string; alt?: string }

const DARK = '#3b3027';

export const ANIMAL_ART: Record<string, AnimalArtSpec> = {
  laying_hens: { shape: 'hen', main: '#b5652b' },
  dual_purpose_chickens: { shape: 'hen', main: '#3a3a3a', alt: '#e8e3d6' },
  meat_chickens: { shape: 'hen', main: '#f4f0e6' },
  turkeys: { shape: 'turkey', main: '#5a3d2b', alt: '#a8784e' },
  ducks_layers: { shape: 'duck', main: '#c9a96e', alt: '#2f6b3a' },
  geese: { shape: 'goose', main: '#ece8e0', alt: '#9aa0a6' },
  guinea_fowl: { shape: 'guinea', main: '#4b4f57' },
  coturnix_quail: { shape: 'quail', main: '#a07446' },
  meat_rabbits: { shape: 'rabbit', main: '#f1ece4', alt: '#e9b8b0' },
  dairy_goats: { shape: 'goat', main: '#e9e1d2', alt: '#8a6a4a' },
  meat_goats: { shape: 'goat', main: '#f2ede4', alt: '#8b3a2a' },
  fiber_goats: { shape: 'goat', main: '#f5f1e8', alt: '#c9c0b0' },
  sheep: { shape: 'sheep', main: '#efe9dc', alt: DARK },
  feeder_pigs: { shape: 'pig', main: '#f0a8a6' },
  beef_cattle: { shape: 'cow', main: '#6b3f2a', alt: '#f2ede4' },
  milk_cow: { shape: 'cow', main: '#c8925a', alt: '#f2ede4' },
  honeybees: { shape: 'bee', main: '#f2c12e', alt: DARK },
  guardian_dog: { shape: 'dog', main: '#f3efe6', alt: '#d9cfbd' },
  guardian_donkey: { shape: 'donkey', main: '#8f8a84', alt: '#e6e1da' },
  guardian_llama: { shape: 'llama', main: '#e9dcc3', alt: '#8a6a4a' },
  alpacas: { shape: 'llama', main: '#c9a27a', alt: '#8a6a4a' },
  'household:dog': { shape: 'dog', main: '#c08a4f', alt: '#7a5532' },
  'household:cat': { shape: 'cat', main: '#8f8a84', alt: '#f2ede4' },
};

export const artForAnimal = (id: string): AnimalArtSpec => ANIMAL_ART[id] ?? { shape: 'hen', main: '#b5652b' };
