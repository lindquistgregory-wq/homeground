import { create } from 'zustand';
import type { Areal } from '@plotwright/core';

export interface LocatedPlace {
  lat: number;
  lon: number;
  label: string;
  source: 'census' | 'nominatim' | 'gps' | 'map';
  accuracyM?: number;
  countyFips?: string;
  zip?: string;
}

interface OnboardingState {
  place: LocatedPlace | null;
  setPlace(p: LocatedPlace | null): void;
  /** Boundary picked or drawn, before it's saved. */
  boundary: Areal | null;
  setBoundary(b: Areal | null): void;
}

export const useOnboarding = create<OnboardingState>((set) => ({
  place: null,
  setPlace: (place) => set({ place, boundary: null }),
  boundary: null,
  setBoundary: (boundary) => set({ boundary }),
}));
