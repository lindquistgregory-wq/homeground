/**
 * At-a-glance numbers for a property card on the home screen: crops in the ground or planned this
 * year, objects in the main design, and the next few planting tasks. Read-only and offline: no
 * design is created and no network layer is fetched (the calendar uses the modeled soil temperature
 * here; the full calendar screen refines it with sensors and stations).
 */
import { plantById, upcomingTasks, type EventKind, type PlantCalendar } from '@plotwright/core';
import type { SiteProfile } from '@plotwright/providers';
import { designsForParcel } from '../db/designs';
import { plantingsForParcel } from '../db/plantings';
import { activePlantings, calendarFor, siteConditions } from './garden';

export interface HomeTask { plantId: string; plantName: string; label: string; kind: EventKind; start: number; end: number }
/** `next`: the first task after the window (wrapping into next year), so a quiet season still says what comes next. */
export interface HomeSummary { crops: number; objects: number; tasks: HomeTask[]; next?: HomeTask }

export const todayDoy = (now = new Date()): number =>
  Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86_400_000);

export async function homeSummary(parcelId: string, profile: SiteProfile | undefined, days = 28): Promise<HomeSummary> {
  const year = new Date().getFullYear();
  const [designs, plantings] = await Promise.all([designsForParcel(parcelId), plantingsForParcel(parcelId)]);
  const active = activePlantings(plantings, year);
  const objects = designs[0]?.objects.length ?? 0;
  const site = siteConditions(profile);
  const cals: PlantCalendar[] = [];
  for (const plantId of new Set(active.map((p) => p.plantId))) {
    const plant = plantById(plantId);
    const cal = plant && calendarFor(plant, site, { risk: 'cautious' });
    if (cal) cals.push(cal);
  }
  const today = todayDoy();
  const toTask = (e: ReturnType<typeof upcomingTasks>[number]): HomeTask => ({
    plantId: e.plantId, plantName: plantById(e.plantId)?.commonName ?? e.plantId, label: e.label, kind: e.kind, start: e.start, end: e.end,
  });
  const horizon = Math.min(365, today + days);
  const tasks = upcomingTasks(cals, today, horizon).map(toTask);
  // Seasons repeat yearly, so the first event after the window is either later this year or early next year.
  const all = upcomingTasks(cals, 1, 365);
  const after = all.find((e) => e.start > horizon) ?? all[0];
  return { crops: new Set(active.map((p) => p.plantId)).size, objects, tasks, next: tasks.length ? undefined : after && toTask(after) };
}
