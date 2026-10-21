/**
 * At-a-glance numbers for a property card on the home screen: crops in the ground or planned this
 * year, objects in the main design, and the next few planting tasks. Read-only and offline: no
 * design is created and no network layer is fetched (the calendar uses the modeled soil temperature
 * here; the full calendar screen refines it with sensors and stations).
 */
import { animalById, plantById, upcomingAnimalTasks, upcomingTasks, type AnimalEventKind, type EventKind, type PlantCalendar } from '@plotwright/core';
import type { SiteProfile } from '@plotwright/providers';
import { designsForParcel } from '../db/designs';
import { plantingsForParcel } from '../db/plantings';
import { herdsForParcel } from '../db/herds';
import { herdCalendars, isCurrent } from './animals';
import { activePlantings, calendarFor, siteConditions } from './garden';

/** A crop task, or (with `animalId`) a herd's care task; `plantName` is then the animal's name. */
export interface HomeTask { plantId: string; plantName: string; label: string; kind: EventKind | AnimalEventKind; start: number; end: number; animalId?: string }
/** `next`: the first task after the window (wrapping into next year), so a quiet season still says what comes next. */
export interface HomeSummary { crops: number; objects: number; tasks: HomeTask[]; next?: HomeTask; /** Animals in current herds (with animal features on). */ animals: number }

export const todayDoy = (now = new Date()): number =>
  Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86_400_000);

export async function homeSummary(parcelId: string, profile: SiteProfile | undefined, days = 28, opts: { animals?: boolean; showProcessing?: boolean } = {}): Promise<HomeSummary> {
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
  // Herd care joins the list when animal features are on. Long seasonal windows (winter water,
  // heat season) show only when they begin, so they don't crowd out dated tasks for months.
  let animals = 0;
  if (opts.animals) {
    const herds = (await herdsForParcel(parcelId)).filter(isCurrent);
    const hc = herdCalendars(herds, designs[0], site, !!opts.showProcessing);
    // Only herds whose housing is still in the design (herdCalendars drops the rest).
    animals = hc.reduce((n, c) => n + c.herd.count, 0);
    const long = new Set<AnimalEventKind>(['winter-water', 'heat-prep', 'swarm-watch']);
    const starting = (x: { kind: AnimalEventKind; start: number }) => !long.has(x.kind) || (x.start >= today && x.start <= horizon);
    for (const e of upcomingAnimalTasks(hc.map((c) => ({ herdId: c.herd.id, animalId: c.animal.id, events: c.events.filter(starting) })), today, horizon))
      tasks.push({ plantId: '', plantName: hc.find((c) => c.herd.id === e.herdId)?.herd.name?.trim() || (animalById(e.animalId)?.commonName ?? e.animalId), label: e.label, kind: e.kind, start: e.start, end: e.end, animalId: e.animalId });
    tasks.sort((a, b) => a.start - b.start);
  }
  // Seasons repeat yearly, so the first event after the window is either later this year or early next year.
  const all = upcomingTasks(cals, 1, 365);
  const after = all.find((e) => e.start > horizon) ?? all[0];
  return { crops: new Set(active.map((p) => p.plantId)).size, objects, tasks, next: tasks.length ? undefined : after && toTask(after), animals };
}
