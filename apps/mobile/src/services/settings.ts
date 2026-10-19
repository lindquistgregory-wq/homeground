import { create } from 'zustand';
import type { UnitSystem } from '@plotwright/core';
import { kvGet, kvSet } from '../db/database';

/** Whether animal features are shown: asked once on Home (owner decision 2); null until answered. */
export type AnimalsChoice = 'yes' | 'no' | null;

interface SettingsState {
  units: UnitSystem;
  animals: AnimalsChoice;
  /** "Show harvest and processing details" (owner decision 5): off by default. */
  showProcessing: boolean;
  loaded: boolean;
  load(): Promise<void>;
  setUnits(u: UnitSystem): void;
  setAnimals(v: 'yes' | 'no'): void;
  setShowProcessing(v: boolean): void;
}

export const useSettings = create<SettingsState>((set) => ({
  units: 'imperial',
  animals: null,
  showProcessing: false,
  loaded: false,
  async load() {
    const [units, animals, processing] = await Promise.all([kvGet('units'), kvGet('animals.enabled'), kvGet('animals.showProcessing')]);
    set({
      units: (units as UnitSystem | undefined) ?? 'imperial',
      animals: animals === 'yes' || animals === 'no' ? animals : null,
      showProcessing: processing === '1',
      loaded: true,
    });
  },
  setUnits(units) {
    set({ units });
    void kvSet('units', units);
  },
  setAnimals(animals) {
    set({ animals });
    void kvSet('animals.enabled', animals);
  },
  setShowProcessing(v) {
    set({ showProcessing: v });
    void kvSet('animals.showProcessing', v ? '1' : '0');
  },
}));
