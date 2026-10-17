/**
 * Care calendar for a herd (prompt §4), the counterpart of plantCalendar. Events are anchored to the
 * property's median frost dates and to the herd's own dates (arrival or hatch, breeding), and each
 * says what it's based on. Only sourced timings are used; nothing here is veterinary scheduling.
 */
import { formatDoy } from '../climate/normals';
import type { FrostDates } from '../climate/frost';
import type { AnimalSpec } from './types';

export type AnimalEventKind =
  | 'lay-start' | 'due' | 'hatch' | 'wean' | 'grow-out' | 'process'
  | 'breeding-season' | 'shear' | 'install-bees' | 'swarm-watch' | 'mite-check' | 'winter-prep' | 'heat-prep' | 'winter-water';

export interface AnimalEvent {
  kind: AnimalEventKind;
  start: number; // day of year
  end: number;
  label: string;
  basis: string;
}

export interface HerdDates {
  /** Day of year the animals arrived or hatched. */
  arrivedDoy?: number;
  /** Day of year they were bred, or the eggs were set. */
  bredDoy?: number;
}

export interface AnimalCalendarContext {
  frost?: FrostDates;
  /** "Show harvest and processing details" (owner decision 5); off by default. */
  showProcessing?: boolean;
  /** Peak summer high, °F: heat-prep is only shown where summers reach the species' onset. */
  peakSummerMaxF?: number;
}

const wrap = (d: number) => ((Math.round(d) - 1 + 365 * 10) % 365) + 1;
const win = (a: number, b: number): [number, number] => [wrap(a), wrap(b)];

export function animalCalendar(a: AnimalSpec, herd: HerdDates, ctx: AnimalCalendarContext): AnimalEvent[] {
  const ev: AnimalEvent[] = [];
  const push = (kind: AnimalEventKind, [start, end]: [number, number], label: string, basis: string) => ev.push({ kind, start, end, label, basis });
  const last = ctx.frost?.lastSpring[32][50] ?? null;
  const first = ctx.frost?.firstFall[32][50] ?? null;
  const r = a.reproduction;

  if (herd.bredDoy !== undefined && r.gestationDays)
    push('due', win(herd.bredDoy + r.gestationDays[0], herd.bredDoy + r.gestationDays[1]), 'Due to give birth', `Bred ${formatDoy(wrap(herd.bredDoy))} + ${r.gestationDays[0]}–${r.gestationDays[1]} days’ gestation`);
  if (herd.bredDoy !== undefined && r.incubationDays)
    push('hatch', win(herd.bredDoy + r.incubationDays[0], herd.bredDoy + r.incubationDays[1]), 'Eggs due to hatch', `Set ${formatDoy(wrap(herd.bredDoy))} + ${r.incubationDays[0]}–${r.incubationDays[1]} days’ incubation`);
  if (herd.arrivedDoy !== undefined && a.production.layStartWeeks) {
    const [w0, w1] = a.production.layStartWeeks;
    push('lay-start', win(herd.arrivedDoy + w0 * 7, herd.arrivedDoy + w1 * 7), 'Laying should start', `Hatched ${formatDoy(wrap(herd.arrivedDoy))} + ${w0}–${w1} weeks`);
  }
  if (herd.arrivedDoy !== undefined && a.production.growOutDays) {
    const [d0, d1] = a.production.growOutDays;
    push('grow-out', win(herd.arrivedDoy + d0, herd.arrivedDoy + d1), 'End of grow-out', `Arrived ${formatDoy(wrap(herd.arrivedDoy))} + ${d0}–${d1} days`);
  }
  if (ctx.showProcessing && herd.arrivedDoy !== undefined && a.processing?.ageDays) {
    const [d0, d1] = a.processing.ageDays;
    push('process', win(herd.arrivedDoy + d0, herd.arrivedDoy + d1), 'Processing date', `Arrived ${formatDoy(wrap(herd.arrivedDoy))} + ${d0}–${d1} days`);
  }
  if (r.breedingSeason && /fall/i.test(r.breedingSeason) && first !== null)
    push('breeding-season', win(first - 60, first), 'Breeding season', `${r.breedingSeason} Shown as the two months before your median first frost (${formatDoy(first)}).`);

  if (a.purposes.includes('fiber') && a.kind === 'ruminant' && last !== null && first !== null) {
    push('shear', win(last - 30, last + 14), 'Spring shearing', `Angoras are shorn in spring before kidding (UMass); around your median last frost (${formatDoy(last)}). Keep shorn goats sheltered.`);
    push('shear', win(first - 60, first - 21), 'Fall shearing', `And in fall before breeding (UMass); before your median first frost (${formatDoy(first)}).`);
  }

  if (a.kind === 'pollinator' && last !== null && first !== null) {
    push('install-bees', win(last - 30, last), 'Install packages or nucs', `Early spring (Maine, Utah State): the month before your median last frost (${formatDoy(last)}). Feed until comb is drawn.`);
    push('swarm-watch', win(91, 212), 'Swarm season: check for queen cells', 'April–July (Utah State; earlier in the Southeast).');
    for (let d = last; d < first; d += 30) push('mite-check', win(d, d + 6), 'Monthly mite count', 'Count Varroa mites monthly through the season (Utah State). Any treatment: follow the label exactly.');
    push('winter-prep', win(first - 45, first), 'Prepare hives for winter', `Before your median first frost (${formatDoy(first)}): stores, ventilation, wind protection.`);
  }

  const onset = a.heat.airOnsetF;
  if (last !== null && first !== null && (onset === undefined || ctx.peakSummerMaxF === undefined || ctx.peakSummerMaxF >= onset))
    push('heat-prep', win(last + 45, first - 45), 'Heat season: shade, water and air flow', onset !== undefined ? `Summer highs here reach the ${onset} °F heat-stress onset for ${a.commonName.toLowerCase()}.` : 'Summer: check shade and water daily.');
  if (first !== null && last !== null)
    push('winter-water', win(first, last), 'Keep water from freezing', `Between your median first (${formatDoy(first)}) and last (${formatDoy(last)}) frosts.`);

  return ev.sort((x, y) => x.start - y.start);
}
