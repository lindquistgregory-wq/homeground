/**
 * The user's own animals. Loaded from SQLite at start-up and registered with core (so animalById,
 * searchAnimals and allAnimals include them everywhere) and with the art map (so they draw with the
 * picture the user picked). `version` bumps on every change so screens can re-read the lists.
 */
import { create } from 'zustand';
import { CUSTOM_ANIMAL_PREFIX, setCustomAnimals, type AnimalSpec } from '@plotwright/core';
import { deleteCustomAnimal, listCustomAnimals, saveCustomAnimal, type CustomAnimal } from '../db/customAnimals';
import { setCustomAnimalArt, type AnimalArtSpec } from '../components/animalArtMap';
import { newId } from './identity';

interface CustomAnimalsState {
  list: CustomAnimal[];
  version: number;
  load(): Promise<void>;
  save(spec: AnimalSpec, art: AnimalArtSpec): Promise<AnimalSpec>;
  remove(id: string): Promise<void>;
}

function register(list: CustomAnimal[]) {
  setCustomAnimals(list.map((c) => c.spec));
  setCustomAnimalArt(Object.fromEntries(list.map((c) => [c.spec.id, c.art])));
}

export const newCustomAnimalId = () => `${CUSTOM_ANIMAL_PREFIX}${newId()}`;

export const useCustomAnimals = create<CustomAnimalsState>((set, get) => ({
  list: [],
  version: 0,
  async load() {
    const list = await listCustomAnimals();
    register(list);
    set({ list, version: get().version + 1 });
  },
  async save(spec, art) {
    const prev = get().list.find((c) => c.spec.id === spec.id);
    const rec = await saveCustomAnimal({ spec, art, createdAt: prev?.createdAt });
    const list = prev ? get().list.map((c) => (c.spec.id === spec.id ? rec : c)) : [...get().list, rec];
    register(list);
    set({ list, version: get().version + 1 });
    return rec.spec;
  },
  async remove(id) {
    await deleteCustomAnimal(id);
    const list = get().list.filter((c) => c.spec.id !== id);
    register(list);
    set({ list, version: get().version + 1 });
  },
}));
