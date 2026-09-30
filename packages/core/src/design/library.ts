/**
 * Design-mode object library (§6): real default dimensions, heights for shading, and how each
 * object interacts with light. Dimensions in metres. Costs are user-editable estimates (USD) and
 * start empty rather than invented.
 */
import type { MaterialCode } from '../sun/shade';
import { Material } from '../sun/shade';

export type ObjectCategory = 'growing' | 'structure' | 'animals' | 'water-soil' | 'energy-utility' | 'trees';
export type Shape = 'rect' | 'circle' | 'line';

export interface ObjectType {
  kind: string;
  name: string;
  category: ObjectCategory;
  shape: Shape;
  /** Width × length (rect), diameter (circle), or length (line), metres. */
  width: number;
  length: number;
  /** Height above ground for shading, metres. */
  height: number;
  material: MaterialCode;
  /** Structures warn when placed on steep slopes. */
  isStructure?: boolean;
  /** Snaps to the contour through its centre (swales, keyline). */
  followsContour?: boolean;
  /** Mature canopy for trees: crown base as fraction of height. */
  crownBase?: number;
  /** Tier gate: 'free' objects are always available. */
  tier: 'free' | 'grower';
  notes?: string;
}

const T = (o: ObjectType) => o;

export const OBJECT_LIBRARY: ObjectType[] = [
  // Growing
  T({ kind: 'raised-bed', name: 'Raised bed', category: 'growing', shape: 'rect', width: 1.2, length: 2.4, height: 0.3, material: Material.none, tier: 'free' }),
  T({ kind: 'raised-bed-l', name: 'L-shaped raised bed', category: 'growing', shape: 'rect', width: 2.4, length: 2.4, height: 0.3, material: Material.none, tier: 'grower' }),
  T({ kind: 'round-bed', name: 'Round bed', category: 'growing', shape: 'circle', width: 1.8, length: 1.8, height: 0.3, material: Material.none, tier: 'grower' }),
  T({ kind: 'keyhole-bed', name: 'Keyhole bed', category: 'growing', shape: 'circle', width: 1.8, length: 1.8, height: 0.6, material: Material.none, tier: 'grower' }),
  T({ kind: 'in-ground-row', name: 'In-ground row', category: 'growing', shape: 'rect', width: 0.75, length: 10, height: 0, material: Material.none, tier: 'free' }),
  T({ kind: 'sfg-grid', name: 'Square-foot grid', category: 'growing', shape: 'rect', width: 1.22, length: 1.22, height: 0.15, material: Material.none, tier: 'free' }),
  T({ kind: 'container', name: 'Container / grow bag', category: 'growing', shape: 'circle', width: 0.5, length: 0.5, height: 0.4, material: Material.none, tier: 'free' }),
  T({ kind: 'vertical-tower', name: 'Vertical tower', category: 'growing', shape: 'circle', width: 0.6, length: 0.6, height: 1.8, material: Material.opaque, tier: 'grower' }),
  T({ kind: 'trellis', name: 'Trellis', category: 'growing', shape: 'line', width: 0.2, length: 2.4, height: 1.8, material: Material.deciduous, tier: 'free', notes: 'Shades like foliage once covered' }),
  T({ kind: 'arch', name: 'Arch trellis', category: 'growing', shape: 'rect', width: 1.2, length: 1.5, height: 2.1, material: Material.deciduous, tier: 'grower' }),
  T({ kind: 'hugel', name: 'Hügelkultur mound', category: 'growing', shape: 'rect', width: 1.8, length: 6, height: 1.2, material: Material.opaque, tier: 'grower' }),
  T({ kind: 'guild', name: 'Food-forest guild', category: 'growing', shape: 'circle', width: 6, length: 6, height: 5, material: Material.deciduous, crownBase: 0.3, tier: 'grower' }),
  T({ kind: 'berry-row', name: 'Berry row', category: 'growing', shape: 'rect', width: 1, length: 8, height: 1.5, material: Material.deciduous, crownBase: 0.1, tier: 'free' }),
  T({ kind: 'herb-spiral', name: 'Herb spiral', category: 'growing', shape: 'circle', width: 2, length: 2, height: 0.9, material: Material.opaque, tier: 'grower' }),
  T({ kind: 'three-sisters', name: 'Three-sisters block', category: 'growing', shape: 'rect', width: 3, length: 3, height: 2, material: Material.deciduous, crownBase: 0.1, tier: 'grower', notes: 'Corn height in midsummer' }),
  T({ kind: 'cold-frame', name: 'Cold frame', category: 'growing', shape: 'rect', width: 0.9, length: 1.8, height: 0.5, material: Material.film, tier: 'free' }),
  T({ kind: 'low-tunnel', name: 'Low tunnel', category: 'growing', shape: 'rect', width: 1.2, length: 6, height: 0.9, material: Material.film, tier: 'free' }),
  T({ kind: 'hoop-tunnel', name: 'Hoop tunnel', category: 'growing', shape: 'rect', width: 3, length: 6, height: 2, material: Material.film, tier: 'grower' }),
  // Trees
  T({ kind: 'fruit-tree-dwarf', name: 'Fruit tree (dwarf, mature)', category: 'trees', shape: 'circle', width: 3, length: 3, height: 3, material: Material.deciduous, crownBase: 0.3, tier: 'free' }),
  T({ kind: 'fruit-tree-semi', name: 'Fruit tree (semi-dwarf, mature)', category: 'trees', shape: 'circle', width: 4.5, length: 4.5, height: 4.5, material: Material.deciduous, crownBase: 0.3, tier: 'free' }),
  T({ kind: 'fruit-tree-std', name: 'Fruit tree (standard, mature)', category: 'trees', shape: 'circle', width: 7, length: 7, height: 7, material: Material.deciduous, crownBase: 0.3, tier: 'grower' }),
  T({ kind: 'nut-tree', name: 'Nut tree (mature)', category: 'trees', shape: 'circle', width: 12, length: 12, height: 15, material: Material.deciduous, crownBase: 0.3, tier: 'grower' }),
  T({ kind: 'evergreen-tree', name: 'Evergreen tree', category: 'trees', shape: 'circle', width: 5, length: 5, height: 12, material: Material.evergreen, crownBase: 0.1, tier: 'free' }),
  T({ kind: 'windbreak', name: 'Windbreak row', category: 'trees', shape: 'rect', width: 3, length: 20, height: 8, material: Material.evergreen, crownBase: 0.05, tier: 'grower' }),
  // Structures
  T({ kind: 'greenhouse-leanto', name: 'Greenhouse (lean-to)', category: 'structure', shape: 'rect', width: 2.4, length: 4.8, height: 2.7, material: Material.film, isStructure: true, tier: 'free' }),
  T({ kind: 'greenhouse-hoop', name: 'Greenhouse (hoop)', category: 'structure', shape: 'rect', width: 3.7, length: 7.3, height: 2.7, material: Material.film, isStructure: true, tier: 'free' }),
  T({ kind: 'greenhouse-gable', name: 'Greenhouse (gable)', category: 'structure', shape: 'rect', width: 3, length: 4.3, height: 2.9, material: Material.film, isStructure: true, tier: 'grower' }),
  T({ kind: 'greenhouse-dome', name: 'Greenhouse (geodesic dome)', category: 'structure', shape: 'circle', width: 6, length: 6, height: 3, material: Material.film, isStructure: true, tier: 'grower' }),
  T({ kind: 'high-tunnel', name: 'High tunnel', category: 'structure', shape: 'rect', width: 9, length: 18, height: 4, material: Material.film, isStructure: true, tier: 'grower' }),
  T({ kind: 'building', name: 'Existing building', category: 'structure', shape: 'rect', width: 8, length: 12, height: 6, material: Material.opaque, isStructure: true, tier: 'free', notes: 'House, garage or neighbour building. Heights from map data are estimates; edit to match.' }),
  T({ kind: 'potting-shed', name: 'Potting shed', category: 'structure', shape: 'rect', width: 2.4, length: 3, height: 2.7, material: Material.opaque, isStructure: true, tier: 'free' }),
  T({ kind: 'tool-shed', name: 'Tool shed', category: 'structure', shape: 'rect', width: 2.4, length: 3, height: 3.05, material: Material.opaque, isStructure: true, tier: 'free' }),
  T({ kind: 'root-cellar', name: 'Root cellar', category: 'structure', shape: 'rect', width: 2.4, length: 3.6, height: 1, material: Material.opaque, isStructure: true, tier: 'grower' }),
  T({ kind: 'barn', name: 'Barn', category: 'structure', shape: 'rect', width: 9, length: 12, height: 7, material: Material.opaque, isStructure: true, tier: 'grower' }),
  // Animals
  T({ kind: 'chicken-coop', name: 'Chicken coop', category: 'animals', shape: 'rect', width: 1.8, length: 2.4, height: 2, material: Material.opaque, isStructure: true, tier: 'free' }),
  T({ kind: 'chicken-run', name: 'Chicken run', category: 'animals', shape: 'rect', width: 3, length: 6, height: 1.8, material: Material.none, tier: 'free', notes: 'Wire mesh: negligible shade' }),
  T({ kind: 'duck-house', name: 'Duck house', category: 'animals', shape: 'rect', width: 1.2, length: 1.8, height: 1.2, material: Material.opaque, isStructure: true, tier: 'grower' }),
  T({ kind: 'rabbit-hutch', name: 'Rabbit hutches', category: 'animals', shape: 'rect', width: 0.9, length: 2.4, height: 1.5, material: Material.opaque, isStructure: true, tier: 'grower' }),
  T({ kind: 'goat-shelter', name: 'Goat/sheep shelter', category: 'animals', shape: 'rect', width: 3, length: 3.6, height: 2.4, material: Material.opaque, isStructure: true, tier: 'grower' }),
  T({ kind: 'paddock', name: 'Paddock', category: 'animals', shape: 'rect', width: 15, length: 20, height: 0, material: Material.none, tier: 'grower' }),
  T({ kind: 'beehive', name: 'Beehive', category: 'animals', shape: 'rect', width: 0.5, length: 0.5, height: 1, material: Material.opaque, tier: 'free', notes: 'Face the entrance away from paths; morning sun helps' }),
  T({ kind: 'mushroom-logs', name: 'Mushroom-log area', category: 'animals', shape: 'rect', width: 2, length: 3, height: 1, material: Material.none, tier: 'grower', notes: 'Wants shade' }),
  // Water & soil
  T({ kind: 'rain-barrel', name: 'Rain barrel', category: 'water-soil', shape: 'circle', width: 0.6, length: 0.6, height: 0.9, material: Material.opaque, tier: 'free' }),
  T({ kind: 'ibc-tote', name: 'IBC tote', category: 'water-soil', shape: 'rect', width: 1, length: 1.2, height: 1.15, material: Material.opaque, tier: 'free' }),
  T({ kind: 'cistern', name: 'Cistern', category: 'water-soil', shape: 'circle', width: 2.5, length: 2.5, height: 2.4, material: Material.opaque, isStructure: true, tier: 'grower' }),
  T({ kind: 'pond', name: 'Pond', category: 'water-soil', shape: 'circle', width: 6, length: 6, height: 0, material: Material.none, tier: 'grower' }),
  T({ kind: 'swale', name: 'Swale (on contour)', category: 'water-soil', shape: 'line', width: 1, length: 20, height: 0, material: Material.none, followsContour: true, tier: 'grower' }),
  T({ kind: 'drip-line', name: 'Drip line', category: 'water-soil', shape: 'line', width: 0.05, length: 10, height: 0, material: Material.none, tier: 'free' }),
  T({ kind: 'hose-bib', name: 'Hose bib', category: 'water-soil', shape: 'circle', width: 0.2, length: 0.2, height: 0.5, material: Material.none, tier: 'free' }),
  T({ kind: 'compost-bays', name: 'Compost bays (3)', category: 'water-soil', shape: 'rect', width: 1.2, length: 3.6, height: 1.1, material: Material.opaque, tier: 'free' }),
  T({ kind: 'worm-bin', name: 'Worm bin', category: 'water-soil', shape: 'rect', width: 0.6, length: 0.9, height: 0.7, material: Material.opaque, tier: 'free' }),
  T({ kind: 'biochar-pit', name: 'Biochar pit', category: 'water-soil', shape: 'circle', width: 1.5, length: 1.5, height: 0, material: Material.none, tier: 'grower' }),
  // Energy & utility
  T({ kind: 'solar-array', name: 'Solar array (ground mount)', category: 'energy-utility', shape: 'rect', width: 2, length: 6, height: 2, material: Material.opaque, isStructure: true, tier: 'grower' }),
  T({ kind: 'wood-storage', name: 'Wood storage', category: 'energy-utility', shape: 'rect', width: 1.2, length: 4, height: 1.8, material: Material.opaque, tier: 'free' }),
  T({ kind: 'fence-deer', name: 'Deer fence', category: 'energy-utility', shape: 'line', width: 0.1, length: 20, height: 2.4, material: Material.none, tier: 'free', notes: 'Mesh: negligible shade' }),
  T({ kind: 'fence-garden', name: 'Garden fence (solid)', category: 'energy-utility', shape: 'line', width: 0.1, length: 10, height: 1.2, material: Material.opaque, tier: 'free' }),
  T({ kind: 'fence-electric', name: 'Electric fence', category: 'energy-utility', shape: 'line', width: 0.05, length: 30, height: 1.2, material: Material.none, tier: 'grower' }),
  T({ kind: 'gate', name: 'Gate', category: 'energy-utility', shape: 'line', width: 0.1, length: 1.2, height: 1.2, material: Material.none, tier: 'free' }),
  T({ kind: 'path', name: 'Path', category: 'energy-utility', shape: 'line', width: 0.9, length: 10, height: 0, material: Material.none, tier: 'free' }),
  T({ kind: 'driveway', name: 'Driveway', category: 'energy-utility', shape: 'line', width: 3.6, length: 20, height: 0, material: Material.none, tier: 'grower' }),
];

export function objectType(kind: string): ObjectType | undefined {
  return OBJECT_LIBRARY.find((o) => o.kind === kind);
}
