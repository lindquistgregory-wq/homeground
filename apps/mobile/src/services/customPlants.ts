/**
 * The user's own plants. Loaded from SQLite at start-up and registered with core (so plantById,
 * searchPlants and allPlants include them everywhere) and with the art map (so they draw with the
 * icon the user picked). `version` bumps on every change so screens can re-read the lists.
 */
import { create } from 'zustand';
import { CUSTOM_PREFIX, setCustomPlants, type PlantSpec } from '@plotwright/core';
import { deleteCustomPlant, listCustomPlants, saveCustomPlant, type CustomPlant } from '../db/customPlants';
import { setCustomArt, type ArtSpec } from '../components/plantArtMap';
import { newId } from './identity';

interface CustomPlantsState {
  list: CustomPlant[];
  version: number;
  load(): Promise<void>;
  save(spec: PlantSpec, art: ArtSpec): Promise<PlantSpec>;
  remove(id: string): Promise<void>;
}

function register(list: CustomPlant[]) {
  setCustomPlants(list.map((c) => c.spec));
  setCustomArt(Object.fromEntries(list.map((c) => [c.spec.id, c.art])));
}

export const newCustomPlantId = () => `${CUSTOM_PREFIX}${newId()}`;

export const useCustomPlants = create<CustomPlantsState>((set, get) => ({
  list: [],
  version: 0,
  async load() {
    const list = await listCustomPlants();
    register(list);
    set({ list, version: get().version + 1 });
  },
  async save(spec, art) {
    const prev = get().list.find((c) => c.spec.id === spec.id);
    const rec = await saveCustomPlant({ spec, art, createdAt: prev?.createdAt });
    const list = prev ? get().list.map((c) => (c.spec.id === spec.id ? rec : c)) : [...get().list, rec];
    register(list);
    set({ list, version: get().version + 1 });
    return rec.spec;
  },
  async remove(id) {
    await deleteCustomPlant(id);
    const list = get().list.filter((c) => c.spec.id !== id);
    register(list);
    set({ list, version: get().version + 1 });
  },
}));
