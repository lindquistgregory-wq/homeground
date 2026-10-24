/**
 * Everything on a property's calendar, as one list of AgendaItems: planting tasks, animal care,
 * breeding and health due dates, planner tasks with a date, weather alerts and the user's own events.
 * The calendar screen lays them out by month; Home's daily brief takes today's.
 */
import {
  HEALTH_TYPES, activeChores, expandCustom, healthDue, isoAdd, plantById, scheduleProject, windowToIso,
  type AgendaItem, type AnimalAlert, type WeatherAlert,
} from '@plotwright/core';
import { eventsForParcel } from '../db/calendarEvents';
import { herdsForParcel } from '../db/herds';
import { listProjectProgress, listTasks } from '../db/planner';
import { allRecords, listAnimals } from '../db/records';
import { herdCalendars, herdLabel, localToday } from './animals';
import { activePlantings, bedName, calendarFor } from './garden';
import { healthSubjects } from './healthReminders';
import { useSettings } from './settings';
import type { GardenState } from './useGarden';

export interface AgendaOptions {
  from: string;
  to: string;
  risk?: 'cautious' | 'typical';
  /** Heat-unit harvest dates (Homestead Pro). */
  dynamicGdd?: boolean;
  alerts?: Array<WeatherAlert | AnimalAlert>;
}

/** A window repeats each season: place it in every year the range touches. */
function seasonal(start: number, end: number, from: string, to: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)); y++) {
    const w = windowToIso(y, start, end);
    if (w.end >= from && w.start <= to) out.push(w);
  }
  return out;
}

export async function agendaFor(state: GardenState, opts: AgendaOptions): Promise<AgendaItem[]> {
  const { from, to } = opts;
  const parcelId = state.parcel.id;
  const items: AgendaItem[] = [];
  const settings = useSettings.getState();
  const today = localToday();
  const year = Number(today.slice(0, 4));

  // Planting tasks for what's planned or planted, with the beds they're in.
  const byPlant = new Map<string, string[]>();
  for (const p of activePlantings(state.plantings, year)) {
    const i = state.design.objects.findIndex((o) => o.id === p.bedObjectId);
    byPlant.set(p.plantId, [...(byPlant.get(p.plantId) ?? []), i >= 0 ? bedName(state.design.objects[i]!, i) : 'removed bed']);
  }
  for (const [plantId, beds] of byPlant) {
    const plant = plantById(plantId);
    const cal = plant && calendarFor(plant, state.site, { risk: opts.risk ?? 'cautious', dynamicGdd: opts.dynamicGdd, soilF: state.soil.soilF, soilLabel: state.soil.basisLabel });
    if (!cal) continue;
    for (const e of cal.events)
      for (const w of seasonal(e.start, e.end, from, to))
        items.push({ id: `plant-${plantId}-${e.kind}-${w.start}`, source: 'planting', title: `${plant!.commonName}: ${e.label}`, short: e.label, start: w.start, end: w.end !== w.start ? w.end : undefined, plantId, details: [e.basis, `In ${beds.join(', ')}`] });
  }

  // Animal care, breeding and health dates (with animal features on).
  if (settings.animals === 'yes') {
    const herds = await herdsForParcel(parcelId);
    for (const c of herdCalendars(herds, state.design, state.site, settings.showProcessing))
      for (const e of c.events)
        for (const w of seasonal(e.start, e.end, from, to))
          items.push({ id: `herd-${c.herd.id}-${e.kind}-${w.start}`, source: 'animal', title: `${c.herd.name?.trim() || c.animal.commonName}: ${e.label}`, short: e.label, start: w.start, end: w.end !== w.start ? w.end : undefined, animalId: c.animal.id, details: [e.basis, `${herdLabel(c.herd, c.animal)}, ${c.housing}`] });
    const names = new Map((await listAnimals()).map((a) => [a.id, a]));
    for (const b of (await allRecords('breedingRecords')).filter((r) => r.parcelId === parcelId && r.dueFrom && r.born === undefined))
      if (b.dueTo! >= from && b.dueFrom! <= to)
        items.push({ id: `breed-${b.id}`, source: 'record', title: `${b.damId ? names.get(b.damId)?.name ?? 'Dam' : 'Eggs set'}: ${b.method === 'eggs-set' ? 'hatch' : 'due'}`, start: b.dueFrom!, end: b.dueTo !== b.dueFrom ? b.dueTo : undefined, animalId: b.speciesId, details: [`${b.method === 'eggs-set' ? 'Set' : 'Bred'} ${b.bredOn}`, 'The window covers the full cited range.'] });
    const who = await healthSubjects();
    for (const d of healthDue((await allRecords('healthRecords')).filter((r) => r.parcelId === parcelId || !r.parcelId), today, 400)) {
      const due = d.record.nextDue!;
      if (due < from || due > to) continue;
      const animal = d.record.animalId ? names.get(d.record.animalId) : undefined;
      items.push({ id: `health-${d.record.id}`, source: 'record', title: `${who(d.record)}: ${d.record.product || HEALTH_TYPES[d.record.type]}`, start: due, urgent: d.overdue, animalId: animal?.speciesId,
        details: [`${HEALTH_TYPES[d.record.type]} recorded ${d.record.date}${d.record.givenBy ? ` by ${d.record.givenBy}` : ''}.`, 'Due date as you or your vet entered it.'] });
    }
  }

  // Planner tasks with a date.
  for (const tk of (await listTasks(parcelId)).filter((x) => !x.done && x.due && /^\d{4}-\d{2}-\d{2}$/.test(x.due) && x.due >= from && x.due <= to))
    items.push({ id: `task-${tk.id}`, source: 'task', title: tk.title, start: tk.due!, details: [...(tk.notes ? [tk.notes] : []), `Planner task (${tk.category})`] });

  // Projects from the plan: each step on its date (until checked off), and the chores finished steps bring.
  // A daily chore is one long window (shown once, then as "ongoing"), so the month doesn't fill up with it.
  for (const p of Object.values(await listProjectProgress(parcelId))) {
    if (!p.project) continue;
    const name = p.project.title;
    for (const s of scheduleProject(p.project, p, today, { lastFrostDoy: state.site.frost?.lastSpring[32][50] ?? undefined }))
      if (!s.doneOn && s.end >= from && s.start <= to)
        items.push({ id: `project-${p.projectId}-${s.step.id}`, source: 'task', title: `${name}: ${s.step.title}`, short: s.step.title, start: s.start, end: s.end !== s.start ? s.end : undefined, urgent: s.late,
          details: [...(s.step.detail ? [s.step.detail] : []), `Step ${s.index + 1} of ${p.project.steps.length} in your ${name.toLowerCase()} project${s.step.optional ? ' (optional)' : ''}.`, 'Dates are a planning suggestion; check steps off in the Planner.'] });
    for (const c of activeChores(p.project, p)) {
      const details = [c.chore.basis, `From your ${name.toLowerCase()} project. Switch it off in the Planner.`];
      const title = `${name}: ${c.chore.title}`;
      if (c.chore.repeat === 'daily') {
        if (c.from <= to) items.push({ id: `chore-${p.projectId}-${c.chore.id}`, source: 'task', title: `Daily: ${c.chore.title}`, short: c.chore.title, start: c.from, end: isoAdd(to, 1), details });
      } else {
        for (const occ of expandCustom({ id: `${p.projectId}-${c.chore.id}`, parcelId, title, date: c.from, repeat: c.chore.repeat, createdAt: c.from }, from, to))
          items.push({ ...occ, id: `chore-${occ.id}`, source: 'task', customId: undefined, short: c.chore.title, details });
      }
    }
  }

  // The user's own events.
  for (const e of await eventsForParcel(parcelId)) items.push(...expandCustom(e, from, to));

  // Weather alerts from the forecast (crops and animals).
  for (const a of opts.alerts ?? []) {
    const day = a.at.slice(0, 10);
    if (day >= from && day <= to) items.push({ id: `alert-${a.kind}-${a.at}`, source: 'alert', title: a.title, start: day, urgent: true, details: [a.body, 'From the National Weather Service forecast. Not an official warning.'] });
  }
  return items;
}

/** The range a month view needs: the visible weeks, with a day either side. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  return { from: isoAdd(first, -7), to: isoAdd(first, 42) };
}
