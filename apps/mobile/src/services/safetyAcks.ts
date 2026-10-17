/**
 * Which safety notes this person has read (Safety & Liability Review). The highest hazards are shown
 * open once; after "Got it" they collapse to one line for good. Stored with the date, so the app can
 * show which version of a note was acknowledged and when.
 */
import { create } from 'zustand';
import { kvGet, kvSet } from '../db/database';

const KEY = 'safety.acks';

interface AcksState {
  acks: Record<string, string>;
  loaded: boolean;
  load(): Promise<void>;
  ack(key: string): Promise<void>;
}

export const useSafetyAcks = create<AcksState>((set, get) => ({
  acks: {},
  loaded: false,
  async load() {
    try {
      set({ acks: JSON.parse((await kvGet(KEY)) ?? '{}') as Record<string, string>, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async ack(key) {
    const acks = { ...get().acks, [key]: new Date().toISOString() };
    set({ acks });
    await kvSet(KEY, JSON.stringify(acks));
  },
}));
