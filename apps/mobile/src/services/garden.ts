/**
 * Planting guide glue (§7): turns a parcel's site profile and a bed's modeled sun, slope and soil into
 * the inputs the pure plant engine in @plotwright/core needs, and turns planted tall crops into shade
 * objects so the sun model sees corn and pole beans the way it sees a trellis.
 */
import {
  Material, footprintUtm, objectType, trueNorthGridDeg, plantById, plantCalendar, project, rasterizePolygon, shadeHeightM, unproject,
  type BedConditions, type CalendarContext, type DesignObject, type LocalFrame, type PlantCalendar, type PlantSpec, type PlantingRecord, type SiteConditions,
} from '@plotwright/core';
import type { SiteProfile } from '@plotwright/providers';
import type { Planting } from '../db/plantings';
import type { ParcelAnalysis, SunResult } from './analysis';

/** Design objects you can plant in: beds, rows, containers, orchard spots. */
const TREE_SPOTS = new Set(['fruit-tree-dwarf', 'fruit-tree-semi', 'fruit-tree-std', 'nut-tree']);
/** Beds filled with bought or amended soil: native drainage and texture matter much less. */
const RAISED = new Set(['raised-bed', 'raised-bed-l', 'round-bed', 'keyhole-bed', 'sfg-grid', 'container', 'vertical-tower', 'herb-spiral', 'hugel']);
/** Covered growing space: frost dates and rain don't apply in the usual way. */
export const COVERED = new Set(['cold-frame', 'low-tunnel', 'hoop-tunnel', 'greenhouse-leanto', 'greenhouse-hoop', 'greenhouse-gable', 'greenhouse-dome', 'high-tunnel']);

export function isPlantable(o: DesignObject): boolean {
  if (o.existing) return false;
  const t = objectType(o.kind);
  if (!t) return false;
  return t.category === 'growing' || TREE_SPOTS.has(o.kind) || COVERED.has(o.kind);
}

export function bedName(o: DesignObject, index?: number): string {
  return o.label ?? `${objectType(o.kind)?.name ?? o.kind}${index !== undefined ? ` ${index + 1}` : ''}`;
}

/** Which plants make sense for this kind of spot (trees in tree spots, not in a grow bag). */
export function plantsForSpot(o: DesignObject, plants: PlantSpec[]): PlantSpec[] {
  if (TREE_SPOTS.has(o.kind)) return plants.filter((p) => p.kind === 'fruit-tree' || p.kind === 'nut-tree');
  const small = o.kind === 'container' || o.kind === 'vertical-tower' || o.kind === 'sfg-grid' || o.kind === 'herb-spiral';
  return plants.filter((p) => p.kind !== 'fruit-tree' && p.kind !== 'nut-tree' && (!small || p.heightIn <= 72));
}

// ---------------- Site and bed conditions ----------------

export function siteConditions(profile: SiteProfile | undefined, summerRhPct?: number): SiteConditions {
  const c = profile?.climate.status === 'ok' ? profile.climate.value : undefined;
  return {
    zone: profile?.hardiness.status === 'ok' ? profile.hardiness.value.zone : undefined,
    frost: c?.frost.dates,
    curves: c?.curves,
    chillHours: c?.chillHours,
    peakSummerMaxF: c?.peakSummerMaxF,
    summerRhPct,
  };
}

/** Largest soil map unit on the parcel. SSURGO maps units at ~1:12,000, so a bed-sized spot can't be placed within one reliably. */
export function dominantSoil(profile: SiteProfile | undefined): (NonNullable<BedConditions['soil']> & { name?: string; percent?: number }) | undefined {
  if (profile?.soils.status !== 'ok') return undefined;
  const u = [...profile.soils.value.units].sort((a, b) => (b.percentOfParcel ?? 0) - (a.percentOfParcel ?? 0))[0];
  if (!u) return undefined;
  return {
    pH: u.surface?.pH, drainageClass: u.drainageClass, texture: u.surface?.texture, awsCm: u.awsCm0to150, hydricPct: u.hydricPercent,
    name: u.name ?? u.symbol, percent: u.percentOfParcel,
  };
}

/** Parcel-grid cells a design object covers (falls back to the cell under its centre when it's smaller than a cell). */
function cellsUnder(a: ParcelAnalysis, o: DesignObject): number[] {
  const m = rasterizePolygon(a.ground, [footprintUtm(o, a.frame)]);
  const out: number[] = [];
  for (let k = 0; k < m.data.length; k++) if (m.data[k] && a.mask[k]) out.push(k);
  if (!out.length) {
    const [x, y] = project(a.frame, o.center);
    const i = Math.floor((x - a.ground.x0) / a.ground.cell), j = Math.floor((a.ground.y0 - y) / a.ground.cell);
    if (i >= 0 && j >= 0 && i < a.ground.width && j < a.ground.height) out.push(j * a.ground.width + i);
  }
  return out;
}

const mean = (vals: number[]) => {
  const v = vals.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
};

/** Circular mean of aspect angles (degrees), ignoring flats. */
function meanAngle(vals: number[]): number | undefined {
  let sx = 0, sy = 0, n = 0;
  for (const d of vals) if (Number.isFinite(d)) (sx += Math.sin((d * Math.PI) / 180)), (sy += Math.cos((d * Math.PI) / 180)), n++;
  if (!n || Math.hypot(sx, sy) / n < 0.3) return undefined;
  return ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
}

export interface BedReport extends BedConditions {
  cells: number;
  soilName?: string;
  soilPercent?: number;
  covered: boolean;
}

/**
 * Conditions for one bed. `growingSun` should be the 'growing' period result computed with the bed's
 * own crops left out, so a bed's corn doesn't count as shading the bed.
 */
export function bedConditions(a: ParcelAnalysis, growingSun: SunResult | null, o: DesignObject, profile: SiteProfile | undefined): BedReport {
  const ks = cellsUnder(a, o);
  const soil = dominantSoil(profile);
  const raised = RAISED.has(o.kind);
  return {
    cells: ks.length,
    sunHours: growingSun && growingSun.period === 'growing' ? mean(ks.map((k) => growingSun.hours.data[k]!)) : undefined,
    soil: soil && { pH: soil.pH, drainageClass: soil.drainageClass, texture: soil.texture, awsCm: soil.awsCm, hydricPct: soil.hydricPct },
    soilName: soil?.name,
    soilPercent: soil?.percent,
    raised,
    slopeDeg: a.slope ? mean(ks.map((k) => a.slope!.data[k]!)) : undefined,
    aspectDeg: a.aspect ? meanAngle(ks.map((k) => a.aspect!.data[k]!)) : undefined,
    coldPoolingM: a.pooling ? mean(ks.map((k) => a.pooling!.data[k]!)) : undefined,
    covered: COVERED.has(o.kind),
  };
}

// ---------------- Tall crops as shade ----------------

/**
 * Plantings growing (or planned) this season: this year's, plus perennials from earlier years and
 * crops planted last fall to overwinter (garlic, fall-planted onions), until harvested or removed.
 */
export function activePlantings(plantings: Planting[], year: number): Planting[] {
  return plantings.filter((p) => {
    if (p.status !== 'planned' && p.status !== 'planted') return false;
    if (p.year === year) return true;
    if (p.year > year) return false;
    const plant = plantById(p.plantId);
    if (plant?.lifecycle === 'perennial' && plant.family !== 'Amaryllidaceae') return p.status === 'planted';
    return p.status === 'planted' && p.year === year - 1 && (plant?.frost === 'very-hardy' || plant?.frost === 'hardy');
  });
}

/**
 * When tall crops stand high enough to matter for shade: from about two months after the median last
 * frost (corn, pole beans and sunflowers are near full height by midsummer) to the first frost.
 */
export function cropShadeSeason(site: SiteConditions): { fromDoy: number; toDoy: number } {
  const lf = site.frost?.lastSpring[32][50], ff = site.frost?.firstFall[32][50];
  return { fromDoy: (lf ?? 120) + 60, toDoy: ff ?? 288 };
}

/**
 * Shade objects for tall crops (> 1 m at maturity) in the given plantings: the bed's footprint, cut to
 * the share of its length the crop fills, at the crop's mature height, shading like foliage.
 */
export function cropShadeObjects(objects: DesignObject[], plantings: Planting[], frame: LocalFrame, excludeBedId?: string): DesignObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out: DesignObject[] = [];
  for (const p of plantings) {
    if (p.bedObjectId === excludeBedId) continue;
    const bed = byId.get(p.bedObjectId);
    const plant = plantById(p.plantId);
    if (!bed || !plant || bed.shape === 'line' || COVERED.has(bed.kind)) continue;
    const h = shadeHeightM(plant);
    // Trees are already drawn as tree objects; only annual/berry crops are added.
    if (h === null || plant.kind === 'fruit-tree' || plant.kind === 'nut-tree') continue;
    out.push(cropObject(bed, p, h, frame));
  }
  return out;
}

function cropObject(bed: DesignObject, p: Planting, heightM: number, frame: LocalFrame): DesignObject {
  const share = Math.max(0.05, Math.min(1, p.share));
  let center = bed.center;
  let length = bed.length;
  if (bed.shape === 'rect' && share < 1 && !bed.polygon) {
    // The crop fills the first `share` of the bed along its length axis.
    const r = ((bed.rotationDeg + trueNorthGridDeg(frame, bed.center)) * Math.PI) / 180;
    const shift = ((share - 1) * bed.length) / 2;
    const [x, y] = project(frame, bed.center);
    center = unproject(frame, [x + Math.sin(r) * shift, y + Math.cos(r) * shift]) as [number, number];
    length = bed.length * share;
  }
  return {
    id: `crop-${p.id}`, kind: 'crop', label: p.plantId, shape: bed.shape, center, rotationDeg: bed.rotationDeg, width: bed.width, length,
    height: heightM + Math.max(0, bed.height), material: Material.deciduous, crownBase: 0, polygon: bed.polygon,
  };
}

// ---------------- Calendars and rotation ----------------

export function calendarFor(plant: PlantSpec, site: SiteConditions, opts: Omit<CalendarContext, 'frost' | 'curves'> = {}): PlantCalendar | null {
  if (!site.frost) return null;
  return plantCalendar(plant, { frost: site.frost, curves: site.curves, ...opts });
}

/** Rotation history of one bed, for `rotationAdvice`. */
export function bedHistory(plantings: Planting[]): PlantingRecord[] {
  return plantings
    .filter((p) => p.status !== 'removed' || p.plantedOn)
    .map((p) => ({ plantId: p.plantId, family: plantById(p.plantId)?.family ?? '', year: p.year }));
}
