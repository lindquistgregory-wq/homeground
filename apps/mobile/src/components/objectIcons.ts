/**
 * Map-pin icon and badge colour for each design object kind (Material Community Icons names,
 * checked by the IconName type). Unknown kinds fall back to their category, then to a dot.
 */
import type { IconName } from './Icon';

const KIND_ICON: Record<string, IconName> = {
  'raised-bed': 'grid', 'raised-bed-l': 'grid', 'round-bed': 'circle-slice-8', 'keyhole-bed': 'key-variant', 'in-ground-row': 'reorder-horizontal',
  'sfg-grid': 'grid', container: 'pot-mix-outline', 'vertical-tower': 'layers-triple-outline', trellis: 'fence', arch: 'gate-arrow-right', hugel: 'terrain',
  guild: 'forest', 'berry-row': 'fruit-grapes', 'herb-spiral': 'spa-outline', 'three-sisters': 'corn', 'cold-frame': 'window-closed-variant',
  'low-tunnel': 'tunnel-outline', 'hoop-tunnel': 'tunnel-outline',
  'fruit-tree-dwarf': 'fruit-cherries', 'fruit-tree-semi': 'food-apple-outline', 'fruit-tree-std': 'tree', 'nut-tree': 'peanut-outline',
  'evergreen-tree': 'pine-tree', windbreak: 'forest',
  'greenhouse-leanto': 'greenhouse', 'greenhouse-hoop': 'greenhouse', 'greenhouse-gable': 'greenhouse', 'greenhouse-dome': 'greenhouse', 'high-tunnel': 'greenhouse',
  building: 'home-outline', 'potting-shed': 'shovel', 'tool-shed': 'tools', 'root-cellar': 'stairs-down', barn: 'barn',
  'chicken-coop': 'egg-outline', 'chicken-run': 'egg-outline', 'duck-house': 'duck', 'rabbit-hutch': 'rabbit', 'goat-shelter': 'sheep', paddock: 'fence',
  'run-in-shed': 'home-roof', stable: 'horse', kennel: 'dog-side', pasture: 'grass',
  beehive: 'bee', 'mushroom-logs': 'mushroom-outline',
  'rain-barrel': 'barrel-outline', 'ibc-tote': 'water-outline', cistern: 'water-well-outline', pond: 'waves', swale: 'wave', 'drip-line': 'water-pump',
  'hose-bib': 'water-pump', well: 'water-well-outline', 'compost-bays': 'recycle', 'worm-bin': 'bug-outline',
  'solar-array': 'solar-panel', 'wood-storage': 'axe', 'fence-deer': 'fence', 'fence-garden': 'fence', 'fence-electric': 'fence-electric', gate: 'gate',
  path: 'walk', driveway: 'car-outline', 'custom-line': 'draw', 'custom-area': 'vector-polygon',
};

const CATEGORY_ICON: Record<string, IconName> = {
  growing: 'sprout', trees: 'tree', structure: 'home-outline', animals: 'paw', 'water-soil': 'water-outline', 'energy-utility': 'flash-outline',
};

/** Badge colours by category; all carry white icons at ≥ 4.5:1 contrast. */
export const CATEGORY_COLOR: Record<string, string> = {
  growing: '#2f7d32', trees: '#1f6b3a', structure: '#795548', animals: '#a35c00', 'water-soil': '#1f6fa8', 'energy-utility': '#5a5a6e',
};

export function objectIcon(kind: string, category?: string): IconName {
  return KIND_ICON[kind] ?? (category ? CATEGORY_ICON[category] : undefined) ?? 'map-marker';
}
