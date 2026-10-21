/** Shared helpers for the animal screens, Calendar, Home and alerts. */
import {
  animalById, animalCalendar, countOf, doyOfIso, objectType, type ActiveHerd, type AnimalEvent, type AnimalSite, type AnimalSpec, type Design, type DesignObject, type SiteConditions,
} from '@plotwright/core';
import { getDesign } from '../db/designs';
import { herdsForParcel, type Herd } from '../db/herds';
import type { GardenState } from './useGarden';

const ACRE_M2 = 4046.86;

/** Today on the phone's calendar, as YYYY-MM-DD (records use local dates). */
export const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The property facts the animal fit score uses, from the loaded garden state. */
export function siteForAnimals(state: GardenState): AnimalSite {
  return { zone: state.site.zone, peakSummerMaxF: state.site.peakSummerMaxF, summerRhPct: state.site.summerRhPct, parcelAcres: state.parcel.areaM2 / ACRE_M2 };
}

/** What people call a coop or paddock: its label, or the object's name. */
export function housingName(o: DesignObject): string {
  return o.label ?? objectType(o.kind)?.name ?? o.kind;
}

/** Herds that are on the land now or planned (not retired, sold or processed). */
export const isCurrent = (h: Herd) => h.status === 'planned' || h.status === 'active';

/** "Bruno" when the owner named it; otherwise "6 laying hens" or "1 colony". */
export function herdLabel(h: Pick<Herd, 'count' | 'speciesId' | 'breed' | 'name'>, a: AnimalSpec | undefined = animalById(h.speciesId)): string {
  if (h.name?.trim()) return h.name.trim();
  if (a?.kind === 'pollinator') return countOf(a, h.count);
  const name = (a?.commonName ?? h.speciesId).toLowerCase();
  return `${h.count} ${h.breed ? `${h.breed} ` : ''}${name}`;
}

/** The plain count, for showing under a name: "1 livestock guardian dog". */
export function herdCount(h: Pick<Herd, 'count' | 'speciesId' | 'breed'>, a: AnimalSpec | undefined = animalById(h.speciesId)): string {
  return herdLabel({ ...h, name: undefined }, a);
}

export interface HerdCalendar { herd: Herd; animal: AnimalSpec; housing: string; events: AnimalEvent[] }

/** Care calendars for a parcel's current herds, anchored to its frost dates and each herd's own dates. */
export function herdCalendars(herds: Herd[], design: Design | undefined, site: SiteConditions, showProcessing: boolean): HerdCalendar[] {
  const out: HerdCalendar[] = [];
  for (const h of herds.filter(isCurrent)) {
    const animal = animalById(h.speciesId);
    const o = design?.objects.find((x) => x.id === h.objectId);
    // Free-roaming herds (no housing object) still get their care calendar.
    if (!animal || (!o && h.objectId)) continue;
    const events = animalCalendar(animal, { arrivedDoy: doyOfIso(h.arrivedOn), bredDoy: doyOfIso(h.bredOn) }, { frost: site.frost, showProcessing, peakSummerMaxF: site.peakSummerMaxF });
    out.push({ herd: h, animal, housing: o ? housingName(o) : 'on the property', events });
  }
  return out;
}

/** Species living (status active) in one housing object, and its name, for a sensor placed there. */
export async function herdsInHousing(parcelId: string, objectId: string): Promise<{ name: string; animals: AnimalSpec[] }> {
  const herds = (await herdsForParcel(parcelId)).filter((h) => h.status === 'active' && h.objectId === objectId);
  if (!herds.length) return { name: '', animals: [] };
  const o = (await getDesign(herds[0]!.designId))?.objects.find((x) => x.id === objectId);
  if (!o) return { name: '', animals: [] };
  const animals = [...new Set(herds.map((h) => h.speciesId))].flatMap((id) => animalById(id) ?? []);
  return { name: housingName(o), animals };
}

/** Herds that are on the land now (status active) and still have their housing, for weather alerts. */
export async function activeHerds(parcelId: string): Promise<ActiveHerd[]> {
  const herds = (await herdsForParcel(parcelId)).filter((h) => h.status === 'active');
  const designs = new Map<string, Design | undefined>();
  const out: ActiveHerd[] = [];
  for (const h of herds) {
    const animal = animalById(h.speciesId);
    if (!animal) continue;
    if (!designs.has(h.designId)) designs.set(h.designId, await getDesign(h.designId));
    const o = designs.get(h.designId)?.objects.find((x) => x.id === h.objectId);
    if (!o && h.objectId) continue; // housing no longer in the design
    out.push({ herdId: h.id, animal, count: h.count, housingName: o ? housingName(o) : 'on the property' });
  }
  return out;
}
