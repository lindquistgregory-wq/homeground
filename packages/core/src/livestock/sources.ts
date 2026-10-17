/**
 * Shared citations for the livestock data (retrieved 2026-10-16 unless an entry says otherwise).
 * Kept as JSON beside the data: they're links people open in the browser, not services the app calls.
 */
import SOURCES from './sources.json';
import type { AnimalSource } from './types';

export const SRC = SOURCES as Record<keyof typeof SOURCES, AnimalSource>;
