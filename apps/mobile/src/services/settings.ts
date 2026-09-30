import { create } from 'zustand';
import type { UnitSystem } from '@plotwright/core';
import { kvGet, kvSet } from '../db/database';

interface SettingsState {
  units: UnitSystem;
  loaded: boolean;
  load(): Promise<void>;
  setUnits(u: UnitSystem): void;
}

export const useSettings = create<SettingsState>((set) => ({
  units: 'imperial',
  loaded: false,
  async load() {
    const units = (await kvGet('units')) as UnitSystem | undefined;
    set({ units: units ?? 'imperial', loaded: true });
  },
  setUnits(units) {
    set({ units });
    void kvSet('units', units);
  },
}));
