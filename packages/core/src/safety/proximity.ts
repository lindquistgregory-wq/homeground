/**
 * Safety checks between objects on the design map (Safety & Liability Review): animals, manure and
 * compost near a well; fences and buildings close to a GIS boundary; trees that will outgrow their
 * spot next to a building; a pond on a parcel in a mapped flood zone. Distances use the strictest
 * common rule the review found (200 ft from a drinking-water well: South Carolina, for barns and pens).
 */
import { project, type LocalFrame } from '../geo/measure';
import { toPolygons, type Areal } from '../geo/types';
import { footprintUtm, type DesignObject } from '../design/design';
import { objectType } from '../design/library';
import type { SafetyLevel } from './notes';
import { toxicityFor, type Eater } from './toxicity';
import type { AnimalSpec } from '../livestock/types';

export const WELL_BUFFER_M = 200 * 0.3048;
export const BOUNDARY_SURVEY_M = 10 * 0.3048;

export type ProximityKind = 'near-well' | 'boundary-survey' | 'tree-reach' | 'pond-flood' | 'toxic-near-animals';

/** Plants within this distance of housing or a paddock count as within reach (browsing over fences, dropped leaves and fruit). */
export const TOXIC_REACH_M = 10;

/** Which toxicity groups (safety/toxicity.ts) an animal belongs to; camelids are treated as grazers, the cautious reading. */
export function eatersFor(a: Pick<AnimalSpec, 'id' | 'kind'>): Eater[] {
  if (a.id === 'guardian_dog') return ['dogs'];
  if (a.id === 'barn_cats') return ['cats'];
  if (a.id === 'guardian_donkey') return ['horses'];
  if (a.id === 'guardian_llama' || a.id === 'alpacas') return ['ruminants'];
  switch (a.kind) {
    case 'poultry': case 'waterfowl': return ['poultry'];
    case 'ruminant': case 'cattle': return ['ruminants'];
    case 'equine': return ['horses'];
    case 'small-stock': return ['rabbits'];
    default: return [];
  }
}

export interface SafetyWarning {
  objectId: string;
  kind: ProximityKind;
  level: SafetyLevel;
  message: string;
}

export interface ProximityContext {
  boundary?: Areal;
  units?: 'imperial' | 'metric';
  /** The parcel intersects a FEMA Special Flood Hazard Area. */
  parcelInFloodZone?: boolean;
  /** Plant ids growing in each bed, row or tree object this year (by object id). */
  plantsByObject?: Record<string, string[]>;
  /** Animals living in each housing object (by object id). */
  animalsByObject?: Record<string, Array<Pick<AnimalSpec, 'id' | 'kind' | 'commonName'>>>;
  /** Plant names for messages. */
  plantName?: (plantId: string) => string;
}

type Pt = [number, number];

function distPointSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

function inRing(p: Pt, ring: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const edges = (ring: Pt[]): Array<[Pt, Pt]> => ring.slice(1).map((b, k) => [ring[k]!, b]);

/** Shortest distance between two footprints (0 when they touch or overlap). */
export function footprintDistanceM(a: Pt[], b: Pt[]): number {
  if (a.some((p) => b.length > 2 && inRing(p, b)) || b.some((p) => a.length > 2 && inRing(p, a))) return 0;
  const ea = edges(a), eb = edges(b);
  let d = Infinity;
  for (const p of a) for (const [s, t] of eb) d = Math.min(d, distPointSeg(p, s, t));
  for (const p of b) for (const [s, t] of ea) d = Math.min(d, distPointSeg(p, s, t));
  return d;
}

const MANURE_KINDS = new Set(['compost-bays', 'worm-bin']);
const NOT_LIVESTOCK = new Set(['beehive', 'mushroom-logs']);
const FENCES = new Set(['fence-deer', 'fence-garden', 'fence-electric', 'gate']);

export function safetyProximity(objects: DesignObject[], frame: LocalFrame, ctx: ProximityContext = {}): SafetyWarning[] {
  const out: SafetyWarning[] = [];
  const dist = (m: number) => (ctx.units === 'metric' ? `${Math.round(m)} m` : `${Math.round(m / 0.3048)} ft`);
  const items = objects.map((o) => ({ o, type: objectType(o.kind), ring: footprintUtm(o, frame) as Pt[] }));
  const name = (x: (typeof items)[number]) => x.o.label ?? x.type?.name ?? x.o.kind;

  const wells = items.filter((x) => x.o.kind === 'well');
  for (const x of items) {
    const animal = x.type?.category === 'animals' && !NOT_LIVESTOCK.has(x.o.kind);
    if (!animal && !MANURE_KINDS.has(x.o.kind)) continue;
    const near = wells.map((w) => footprintDistanceM(x.ring, w.ring)).filter((d) => d < WELL_BUFFER_M);
    if (near.length)
      out.push({
        objectId: x.o.id, kind: 'near-well', level: 'caution',
        message: `${name(x)} is about ${dist(Math.min(...near))} from a well. Keep animals, manure and compost at least ${dist(WELL_BUFFER_M)} away; your state’s well code may differ.`,
      });
  }

  if (ctx.boundary) {
    const lines = toPolygons(ctx.boundary).flatMap((poly) => edges(poly[0]!.map((q) => project(frame, q)) as Pt[]));
    for (const x of items) {
      if (x.o.existing || !(x.type?.isStructure || FENCES.has(x.o.kind))) continue;
      const d = Math.min(...x.ring.flatMap((p) => lines.map(([a, b]) => distPointSeg(p, a, b))));
      if (d < BOUNDARY_SURVEY_M)
        out.push({
          objectId: x.o.id, kind: 'boundary-survey', level: 'note',
          message: `${name(x)} is within ${dist(BOUNDARY_SURVEY_M)} of the property line. GIS parcel lines are approximate, so have the line surveyed before building or fencing here.`,
        });
    }
  }

  const buildings = items.filter((x) => x.o.kind === 'building' || x.type?.isStructure);
  for (const x of items) {
    if (x.type?.category !== 'trees' || x.o.shape !== 'circle') continue;
    const reach = x.o.width / 2;
    const c = project(frame, x.o.center) as Pt;
    const hit = buildings.find((b) => b.o.id !== x.o.id && footprintDistanceM([c, c], b.ring) < reach);
    if (hit)
      out.push({
        objectId: x.o.id, kind: 'tree-reach', level: 'note',
        message: `At full size this tree’s canopy reaches ${name(hit)}. Leave room from buildings and overhead lines; your utility sets clearances for lines.`,
      });
  }

  if (ctx.parcelInFloodZone)
    for (const x of items)
      if (x.o.kind === 'pond')
        out.push({ objectId: x.o.id, kind: 'pond-flood', level: 'note', message: 'This parcel is in a mapped flood zone: digging a pond here can need a floodplain permit from your county.' });

  // Toxic plantings within reach of the animals housed nearby (Safety & Liability Review: point of use).
  if (ctx.plantsByObject && ctx.animalsByObject) {
    const plantName = ctx.plantName ?? ((id: string) => id);
    const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
    const housing = items.filter((x) => ctx.animalsByObject![x.o.id]?.length);
    const growing = items.filter((x) => ctx.plantsByObject![x.o.id]?.length);
    const pairs = new Map<string, Array<{ plant: string; animal: string; bed: string }>>();
    const add = (objectId: string, v: { plant: string; animal: string; bed: string }) => {
      const list = pairs.get(objectId) ?? [];
      if (!list.some((p) => p.plant === v.plant && p.animal === v.animal)) list.push(v);
      pairs.set(objectId, list);
    };
    for (const h of housing) {
      for (const g of growing) {
        if (g.o.id !== h.o.id && footprintDistanceM(h.ring, g.ring) > TOXIC_REACH_M) continue;
        for (const animal of ctx.animalsByObject[h.o.id]!) {
          const eaters = eatersFor(animal);
          for (const plantId of ctx.plantsByObject[g.o.id]!) {
            if (!toxicityFor(plantId).some((l) => eaters.includes(l.to))) continue;
            const v = { plant: plantName(plantId), animal: lower(animal.commonName), bed: name(g) };
            add(h.o.id, v);
            add(g.o.id, v);
          }
        }
      }
    }
    for (const [objectId, list] of pairs) {
      const text = list.slice(0, 3).map((p) => `${p.plant} (${p.bed}) for ${p.animal}`).join('; ');
      out.push({
        objectId, kind: 'toxic-near-animals', level: 'caution',
        message: `Within reach of animals and listed as toxic to them: ${text}${list.length > 3 ? ` and ${list.length - 3} more` : ''}. Fence it off or plant it farther away; see the plant’s page for which parts and sources.`,
      });
    }
  }

  return out;
}
