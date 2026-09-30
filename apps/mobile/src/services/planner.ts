/**
 * App side of the AI planner (§9): builds the local context the planner's tools read (site profile,
 * design, climate fit, sensors, drafts), and applies a draft to the design only when the user approves it.
 * Nothing here touches the network except what the site profile already cached.
 */
import {
  OBJECT_LIBRARY, PLANTS, footprintAreaM2, footprintUtm, formatDoy, frameForBoundary, newObject, objectType, pointInAreal, project, scorePlant, unproject,
  type DesignDraft, type DesignObject, type HomesteadGoals, type PlannerContext, type SitePlanInput, type TaskDraft,
} from '@plotwright/core';
import { KNOWLEDGE_BASE } from '@plotwright/data';
import { humidityClimatology, type SiteProfile } from '@plotwright/providers';
import { useEntitlements } from '../billing/entitlements';
import { getOrCreateDesign, saveDesign } from '../db/designs';
import { getParcel, getSiteProfile, type ParcelRecord } from '../db/parcels';
import { draftStatus, getGoals, saveDraft, saveGoals, saveTask, setDraftStatus } from '../db/planner';
import { savePlanting } from '../db/plantings';
import { listSensors } from '../db/sensors';
import { dominantSoil, siteConditions } from './garden';
import { http } from './http';
import { newId } from './identity';
import { frostOffset, soilSourceFor, waterAdvice } from './sensorInsights';

const SQFT = 10.7639;
const ACRE_M2 = 4046.86;

export interface PlannerTier {
  full: boolean;
  income: boolean;
  multiYear: boolean;
}

export function currentTier(): PlannerTier {
  const e = useEntitlements.getState().entitlements;
  return { full: e.has('planner.full'), income: e.has('planner.income'), multiYear: e.has('planner.multiYear') };
}

/** Climate-level fit (0–100) for every plant on this parcel; bed-level sun and soil are in the bed planner. */
async function climateFit(profile: SiteProfile | undefined): Promise<Record<string, number> | undefined> {
  if (!profile) return undefined;
  let rh: number | undefined;
  try {
    const h = await humidityClimatology(http, profile.centroid);
    if (h.status === 'ok') rh = h.value.summer;
  } catch {
    // humidity is optional
  }
  const site = siteConditions(profile, rh);
  return Object.fromEntries(PLANTS.map((p) => [p.id, scorePlant(p, site, {}).score]));
}

export function sitePlanInputFrom(parcel: ParcelRecord, profile: SiteProfile | undefined, suitability?: Record<string, number>): SitePlanInput {
  const c = profile?.climate.status === 'ok' ? profile.climate.value : undefined;
  const sources = [
    'Parcel boundary and area: your property',
    ...(profile?.hardiness.status === 'ok' ? [`Hardiness zone: ${profile.hardiness.attribution.source}`] : []),
    ...(profile?.climate.status === 'ok' ? [`Frost dates: ${profile.climate.attribution.source}`] : []),
  ];
  return {
    parcelAcres: parcel.areaM2 / ACRE_M2,
    zone: profile?.hardiness.status === 'ok' ? profile.hardiness.value.zone : undefined,
    freezeFreeDays: c?.frost.dates.freezeFreeDays ?? null,
    frostRare: c?.frost.dates.freezeRare,
    suitability,
    sources,
  };
}

/** Short, sourced facts about the parcel for the model. */
function siteFactLines(parcel: ParcelRecord, profile: SiteProfile | undefined): { lines: string[]; missing: string[] } {
  const lines = [`Parcel “${parcel.name}”: ${(parcel.areaM2 / ACRE_M2).toFixed(2)} acres (boundary: ${parcel.boundarySource}).`];
  const missing: string[] = [];
  if (!profile) return { lines, missing: ['site profile (not built yet)'] };
  const conf = (a: { confidence: string; source: string }) => `${a.source}, ${a.confidence} confidence`;
  if (profile.place.countyName) lines.push(`County: ${profile.place.countyName}.`);
  if (profile.hardiness.status === 'ok') lines.push(`Hardiness zone ${profile.hardiness.value.zone} (${conf(profile.hardiness.attribution)}).`);
  else missing.push('hardiness zone');
  if (profile.climate.status === 'ok') {
    const f = profile.climate.value.frost.dates;
    if (f.freezeRare) lines.push('Freezes are rare here.');
    else {
      const ls = f.lastSpring[32][50], ff = f.firstFall[32][50];
      lines.push(`Median last spring frost ${ls ? formatDoy(ls) : 'unknown'}, first fall frost ${ff ? formatDoy(ff) : 'unknown'}; about ${f.freezeFreeDays ?? '?'} frost-free days (${conf(profile.climate.attribution)}).`);
    }
  } else missing.push('frost dates');
  const soil = dominantSoil(profile);
  if (soil && profile.soils.status === 'ok') lines.push(`Main soil: ${soil.name ?? 'unnamed'}${soil.percent !== undefined ? ` (${Math.round(soil.percent)}% of parcel)` : ''}, ${[soil.texture, soil.drainageClass, soil.pH !== undefined ? `pH ${soil.pH}` : null].filter(Boolean).join(', ')} (${conf(profile.soils.attribution)}).`);
  else missing.push('soils');
  if (profile.elevation.status === 'ok') lines.push(`Elevation ${Math.round(profile.elevation.value.centroidM)} m, ${Math.round(profile.elevation.value.reliefM)} m of relief across the parcel (${profile.elevation.attribution.source}).`);
  if (profile.flood.status === 'ok') lines.push(`Flood: ${profile.flood.value.headline} (${profile.flood.attribution.source}).`);
  else missing.push('flood zone');
  if (profile.water.status === 'ok') lines.push(profile.water.value.nearest ? `Nearest mapped stream or pond about ${Math.round(profile.water.value.nearest.distanceM)} m away (${profile.water.attribution.source}).` : 'No mapped streams or ponds nearby.');
  lines.push('Sun per bed comes from the shade model in the bed planner, not from this summary.');
  return { lines, missing };
}

/** Build the context the planner's tools read, for one parcel. */
export async function plannerContext(parcelId: string, onGoals?: (g: HomesteadGoals) => void): Promise<PlannerContext> {
  const parcel = await getParcel(parcelId);
  if (!parcel) throw new Error('This property is no longer on this device.');
  const profile = await getSiteProfile(parcelId);
  let goals = await getGoals(parcelId);
  const fit = await climateFit(profile);
  const frame = frameForBoundary(parcel.geometry);
  return {
    kb: KNOWLEDGE_BASE,
    tier: currentTier(),
    goals: () => goals,
    saveGoals: async (g) => {
      goals = g;
      await saveGoals(parcelId, g);
      onGoals?.(g);
    },
    siteFacts: async () => siteFactLines(parcel, profile),
    sitePlanInput: async () => sitePlanInputFrom(parcel, profile, fit),
    design: async () => {
      const d = await getOrCreateDesign(parcelId);
      return { objects: d.objects.map((o, i) => ({ id: o.id, kind: o.kind, label: o.label ?? `${objectType(o.kind)?.name ?? o.kind} ${i + 1}`, areaSqFt: footprintAreaM2(o, frame) * SQFT })) };
    },
    suitability: async (ids) => {
      if (!fit) return [];
      const plants = ids ? PLANTS.filter((p) => ids.includes(p.id)) : [...PLANTS].sort((a, b) => (fit[b.id] ?? 0) - (fit[a.id] ?? 0)).slice(0, 12);
      const site = siteConditions(profile);
      return plants.map((p) => {
        const s = scorePlant(p, site, {}, undefined, 'your climate');
        return { plantId: p.id, name: p.commonName, score: s.score, verdict: s.verdict, summary: s.summary };
      });
    },
    sensorSummary: async () => {
      const sensors = await listSensors(parcelId);
      if (!sensors.length) return null;
      const lines: string[] = [`${sensors.filter((s) => !s.parentId).length} sensor(s) on this property.`];
      const soil = await soilSourceFor(parcelId, profile, siteConditions(profile)).catch(() => null);
      if (soil) lines.push(`Soil temperature for sowing dates: ${soil.label}.`);
      const low = await frostOffset(parcelId).catch(() => null);
      if (low) lines.push(`“${low.sensor}” runs about ${Math.abs(Math.round(low.offsetF))} °F ${low.offsetF < 0 ? 'colder' : 'warmer'} than the NWS forecast low (${low.nights} nights).`);
      const w = await waterAdvice(parcelId, profile).catch(() => null);
      if (w) lines.push(`Watering: ${w.message} (${w.basis}).`);
      return lines.join('\n');
    },
    saveDesignDraft: (d: DesignDraft) => saveDraft(parcelId, 'design', d),
    saveTaskDrafts: async (t: TaskDraft[]) => { await saveDraft(parcelId, 'tasks', t); return t.length; },
    newId,
    now: () => new Date(),
  };
}

// ---------------- Applying approved drafts ----------------

type Box = [number, number, number, number];
const boxOf = (ring: Array<[number, number]>): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  return [x0, y0, x1, y1];
};
const overlaps = (a: Box, b: Box, pad: number) => a[0] - pad < b[2] && b[0] - pad < a[2] && a[1] - pad < b[3] && b[1] - pad < a[3];

/**
 * Place new objects near the requested anchor (house, existing garden, or the parcel's middle) on a
 * spiral of candidate spots inside the boundary that don't overlap anything. Placement is a starting
 * point: the user moves things on the design screen (and should check the sun layer).
 */
function placeObjects(parcel: ParcelRecord, existing: DesignObject[], kind: string, count: number, near: string | undefined, size: { width?: number; length?: number }): DesignObject[] {
  const frame = frameForBoundary(parcel.geometry);
  const t = objectType(kind)!;
  const pick = (pred: (o: DesignObject) => boolean) => existing.filter(pred);
  const anchorSet = near === 'house' ? pick((o) => o.kind === 'building') : near === 'garden' ? pick((o) => objectType(o.kind)?.category === 'growing') : [];
  const centroid = (os: DesignObject[]) => {
    const pts = os.map((o) => project(frame, o.center));
    return pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : project(frame, [frame.origin.lon, frame.origin.lat]);
  };
  const [ax, ay] = centroid(anchorSet) as [number, number];
  const boxes = existing.map((o) => boxOf(footprintUtm(o, frame)));
  const out: DesignObject[] = [];
  const w = size.width ?? t.width, l = size.length ?? t.length;
  const step = Math.max(1.5, Math.max(w, l) + 1);
  // Spiral outwards in rings of candidate points.
  for (let ring = 0; ring < 60 && out.length < count; ring++) {
    const pts = ring === 0 ? [[0, 0]] : Array.from({ length: 8 * ring }, (_, k) => {
      const a = (2 * Math.PI * k) / (8 * ring);
      return [Math.cos(a) * ring * step, Math.sin(a) * ring * step];
    });
    for (const [dx, dy] of pts) {
      if (out.length >= count) break;
      const center = unproject(frame, [ax + dx!, ay + dy!]) as [number, number];
      if (!pointInAreal({ lon: center[0], lat: center[1] }, parcel.geometry)) continue;
      const o = newObject(kind, { lon: center[0], lat: center[1] }, newId());
      o.width = w;
      if (o.shape === 'circle') o.length = w;
      else o.length = l;
      o.label = `${t.name} (planner draft)`;
      if (o.shape === 'line') {
        // Lines (fences, drip lines, paths) need a path, as when placed by hand on the design screen.
        const [x, y] = project(frame, o.center);
        o.path = [unproject(frame, [x - o.length / 2, y]) as [number, number], unproject(frame, [x + o.length / 2, y]) as [number, number]];
      }
      const b = boxOf(footprintUtm(o, frame));
      if (boxes.some((x) => overlaps(b, x, 0.6))) continue;
      boxes.push(b);
      out.push(o);
    }
  }
  return out;
}

export interface ApplyResult {
  added: number;
  removed: number;
  plantings: number;
  unplaced: string[];
}

/** Apply an approved design draft: add/remove objects, and plan the draft's crops into the new beds. */
export async function applyDesignDraft(parcelId: string, draft: DesignDraft): Promise<ApplyResult> {
  // Approve once: a second tap (or another screen) finds the draft no longer pending.
  if ((await draftStatus(draft.id)) !== 'pending') throw new Error('This draft was already handled.');
  await setDraftStatus(draft.id, 'approved');
  const parcel = await getParcel(parcelId);
  if (!parcel) throw new Error('Property not found.');
  const design = await getOrCreateDesign(parcelId);
  let objects = [...design.objects];
  const res: ApplyResult = { added: 0, removed: 0, plantings: 0, unplaced: [] };
  const year = new Date().getFullYear();
  for (const c of draft.changes) {
    if (c.op === 'remove') {
      const before = objects.length;
      objects = objects.filter((o) => o.id !== c.objectId);
      res.removed += before - objects.length;
      continue;
    }
    if (!OBJECT_LIBRARY.some((t) => t.kind === c.kind)) { res.unplaced.push(c.kind); continue; }
    const n = c.count ?? 1;
    const placed = placeObjects(parcel, objects, c.kind, n, c.near, { width: c.width, length: c.length });
    if (placed.length < n) res.unplaced.push(`${n - placed.length} × ${objectType(c.kind)?.name ?? c.kind} (no free space found)`);
    objects.push(...placed);
    res.added += placed.length;
    // Crops the planner chose become planned plantings (they show up in the calendar). With areas, beds
    // are filled in order, each crop taking the share of a bed its planned area needs; without, one
    // crop per bed in turn.
    const plants = c.plants ?? [];
    if (placed.length && plants.length) {
      const bedSqFt = footprintAreaM2(placed[0]!, frameForBoundary(parcel.geometry)) * SQFT;
      const areas = c.plantAreas;
      if (areas && bedSqFt > 0) {
        let bed = 0, room = 1;
        for (const plantId of plants) {
          let need = (areas[plantId] ?? bedSqFt) / bedSqFt;
          while (need > 1e-3 && bed < placed.length) {
            const share = Math.min(need, room);
            await savePlanting({ parcelId, designId: design.id, bedObjectId: placed[bed]!.id, plantId, year, share: Math.round(share * 100) / 100, status: 'planned' });
            res.plantings++;
            need -= share;
            room -= share;
            if (room <= 1e-3) (bed++, (room = 1));
          }
          if (need > 1e-3) res.unplaced.push(`${plantId} (no bed left for it)`);
        }
      } else {
        for (let i = 0; i < Math.min(placed.length, plants.length); i++) {
          await savePlanting({ parcelId, designId: design.id, bedObjectId: placed[i]!.id, plantId: plants[i]!, year, share: 1, status: 'planned' });
          res.plantings++;
        }
      }
    }
  }
  await saveDesign({ ...design, objects, updatedAt: new Date().toISOString() });
  return res;
}

export async function applyTaskDrafts(parcelId: string, draftId: string, tasks: TaskDraft[]): Promise<number> {
  if ((await draftStatus(draftId)) !== 'pending') throw new Error('These tasks were already handled.');
  await setDraftStatus(draftId, 'approved');
  for (const t of tasks) await saveTask({ ...t, parcelId, done: false });
  return tasks.length;
}
