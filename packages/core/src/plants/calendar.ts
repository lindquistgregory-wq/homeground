/**
 * Parcel-adjusted planting calendar (§7.3). Dates come from the parcel's own frost probabilities
 * (Phase 1 frost engine, elevation-adjusted) and, when available, soil temperature (sensor → regional
 * station → modeled). Every event explains what it was based on.
 */
import { formatDoy } from '../climate/normals';
import type { FrostDates, RiskLevel } from '../climate/frost';
import { dayGddReached, firstDayAtLeast, modeledSoilF, type ClimateCurves } from './seasonModel';
import type { PlantSpec } from './types';

export type EventKind = 'start-indoors' | 'harden-off' | 'transplant' | 'direct-sow' | 'plant' | 'succession' | 'fall-sow' | 'fall-transplant' | 'harvest' | 'fall-harvest';

export interface CalendarEvent {
  kind: EventKind;
  /** Day-of-year window, inclusive. */
  start: number;
  end: number;
  label: string;
  /** Why these dates: which frost date / soil temperature / heat units they came from. */
  basis: string;
}

export interface PlantCalendar {
  plantId: string;
  events: CalendarEvent[];
  /** Crop fits the season at all (enough frost-free days / heat units). */
  fits: boolean;
  warnings: string[];
}

export interface CalendarContext {
  frost: FrostDates;
  curves?: ClimateCurves;
  /** 'cautious' plans tender crops around the 10 % risk frost date; 'typical' around the median. */
  risk?: 'cautious' | 'typical';
  /** Soil temperature by day-of-year from a sensor or regional station, overriding the model. */
  soilF?: (doy: number) => number;
  /** Use heat units (GDD) instead of calendar days for maturity where the crop has a GDD target. */
  dynamicGdd?: boolean;
}

const clampDoy = (d: number) => Math.max(1, Math.min(365, Math.round(d)));
const win = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

function lastFrost(ctx: CalendarContext, tender: boolean): { doy: number; label: string } | null {
  const level: RiskLevel = tender && ctx.risk !== 'typical' ? 10 : 50;
  const d = ctx.frost.lastSpring[32][level];
  if (d === null) return null;
  return { doy: d, label: level === 10 ? `last 32 °F frost (only 1 year in 10 is later: ${formatDoy(d)})` : `median last frost (${formatDoy(d)})` };
}

function firstFrost(ctx: CalendarContext, plant: PlantSpec): { doy: number; label: string } | null {
  // Hardy crops keep going through light frosts: use the 28 °F date for them.
  const hardy = plant.frost === 'hardy' || plant.frost === 'very-hardy';
  const d = hardy ? ctx.frost.firstFall[28][50] : ctx.frost.firstFall[32][50];
  if (d === null) return null;
  return { doy: d, label: `median first ${hardy ? '28' : '32'} °F freeze (${formatDoy(d)})` };
}

export function plantCalendar(plant: PlantSpec, ctx: CalendarContext): PlantCalendar {
  const events: CalendarEvent[] = [];
  const warnings: string[] = [];
  const tender = plant.frost === 'tender';
  const sow = plant.sowing;
  const soil = ctx.soilF ?? (ctx.curves ? (d: number) => modeledSoilF(ctx.curves!, d) : undefined);

  if (ctx.frost.freezeRare) {
    warnings.push('Frost is rare here: plant cool-season crops in fall and winter, warm-season crops in spring.');
  }
  const lf = lastFrost(ctx, tender);
  const ff = firstFrost(ctx, plant);
  if (!lf || !ff) {
    return { plantId: plant.id, events, fits: true, warnings: [...warnings, 'No frost dates for this parcel, so timing can’t be personalised yet.'] };
  }

  // Soil-temperature gate: the first day soil stays at or above the crop's minimum.
  const soilReady = sow.minSoilF !== undefined && soil ? firstDayAtLeast(soil, sow.minSoilF, 1, 250) : null;
  const soilNote = soilReady !== null ? ` and soil ${sow.minSoilF} °F+ (≈${formatDoy(soilReady)}${ctx.soilF ? '' : ', modeled'})` : '';
  const gate = (d: number) => (soilReady !== null ? Math.max(d, soilReady) : d);

  let establish: number | null = null; // day the crop goes in the ground (for maturity)
  let establishFromTransplant = false;

  if (sow.indoorStartWeeks && (sow.method === 'transplant' || sow.method === 'either')) {
    const [early, late] = sow.indoorStartWeeks;
    events.push({ kind: 'start-indoors', start: clampDoy(lf.doy - early * 7), end: clampDoy(lf.doy - late * 7), label: 'Start seeds indoors', basis: `${early}–${late} weeks before the ${lf.label}` });
  }
  if (sow.transplantDays && (sow.method === 'transplant' || sow.method === 'either')) {
    const [a, b] = win(lf.doy + sow.transplantDays[0], lf.doy + sow.transplantDays[1]);
    // If warm soil comes later than the frost-based window, shift the whole window rather than squeeze it.
    const start = clampDoy(gate(a)), end = clampDoy(start + (b - a));
    events.push({ kind: 'harden-off', start: clampDoy(start - 10), end: clampDoy(start - 1), label: 'Harden off seedlings', basis: 'the 7–10 days before transplanting' });
    events.push({ kind: 'transplant', start, end, label: 'Transplant outdoors', basis: `${describeOffset(sow.transplantDays)} the ${lf.label}${soilNote}` });
    establish = start;
    establishFromTransplant = true;
  }
  if (sow.directSowDays && (sow.method === 'direct' || sow.method === 'either' || sow.method === 'plant')) {
    const [a, b] = win(lf.doy + sow.directSowDays[0], lf.doy + sow.directSowDays[1]);
    const start = clampDoy(gate(a)), end = clampDoy(Math.max(b, start + Math.min(14, b - a)));
    events.push({ kind: sow.method === 'plant' ? 'plant' : 'direct-sow', start, end, label: sow.method === 'plant' ? 'Plant out' : 'Sow outdoors', basis: `${describeOffset(sow.directSowDays)} the ${lf.label}${soilNote}` });
    if (establish === null) establish = start;
  }

  // Maturity / harvest.
  const dtm = plant.daysToMaturity;
  if (establish !== null && dtm) {
    let harvestStart: number | null = null;
    let basis: string;
    const fromLabel = plant.maturityFrom === 'transplant' && !establishFromTransplant ? 'seeding (+ ~2 weeks vs. transplants)' : plant.maturityFrom ?? 'planting';
    const extra = plant.maturityFrom === 'transplant' && !establishFromTransplant ? 14 : 0;
    if (ctx.dynamicGdd && plant.gddToMaturity && ctx.curves) {
      harvestStart = dayGddReached(ctx.curves, establish, plant.gddToMaturity, plant.gddBaseF ?? 50);
      basis = `${plant.gddToMaturity} heat units (base ${plant.gddBaseF ?? 50} °F) after ${formatDoy(establish)}`;
    } else {
      harvestStart = establish + dtm[0] + extra;
      basis = `${dtm[0]}–${dtm[1]} days from ${fromLabel}`;
    }
    if (harvestStart !== null && harvestStart <= 365 + 60) {
      const end = Math.min(harvestStart + (dtm[1] - dtm[0]) + (plant.harvestWindowDays ?? 14), plant.lifecycle === 'annual' && tender ? ff.doy : 400);
      events.push({ kind: 'harvest', start: clampDoy(harvestStart), end: clampDoy(end), label: 'Harvest', basis });
      if (plant.lifecycle !== 'perennial' && harvestStart > ff.doy && tender) {
        warnings.push(`Needs until about ${formatDoy(harvestStart)} to mature, after the ${ff.label}. Choose a faster variety, start earlier indoors, or use row cover.`);
      }
    }
    if (sow.successionDays && harvestStart !== null) {
      const lastSow = (tender ? ff.doy : ff.doy + 14) - dtm[0] - extra;
      if (lastSow > establish + sow.successionDays)
        events.push({ kind: 'succession', start: clampDoy(establish + sow.successionDays), end: clampDoy(lastSow), label: `Sow again every ${sow.successionDays} days`, basis: `last sowing leaves ${dtm[0]} days before the ${ff.label}` });
    }
  }

  // Fall crop.
  if (sow.fallDaysBeforeFirstFrost && ctx.frost.firstFall[32][50] !== null) {
    // Fall timing is conventionally counted from the average (32 °F) first frost.
    const f32 = ctx.frost.firstFall[32][50]!;
    const f32Label = `median first frost (${formatDoy(f32)})`;
    const [a, b] = win(f32 - sow.fallDaysBeforeFirstFrost[0], f32 - sow.fallDaysBeforeFirstFrost[1]);
    const kind: EventKind = sow.method === 'transplant' ? 'fall-transplant' : 'fall-sow';
    const label = plant.id === 'garlic' ? 'Plant cloves' : kind === 'fall-transplant' ? 'Set out fall transplants' : plant.kind === 'cover-crop' ? 'Sow cover crop' : 'Sow for fall harvest';
    events.push({ kind, start: clampDoy(a), end: clampDoy(b), label, basis: `${describeFall(sow.fallDaysBeforeFirstFrost)} the ${f32Label}` });
    if (dtm && plant.id !== 'garlic' && plant.kind !== 'cover-crop') {
      events.push({ kind: 'fall-harvest', start: clampDoy(a + dtm[0]), end: clampDoy(Math.max(a + dtm[0], ff.doy + (plant.frost === 'very-hardy' ? 45 : 21))), label: 'Fall harvest', basis: `${dtm[0]}+ days after sowing; frost-hardy crops keep past the first frost` });
    }
  }

  // Season length check for tender annuals.
  let fits = true;
  if (tender && plant.lifecycle !== 'perennial' && dtm && ctx.frost.freezeFreeDays !== null) {
    const needed = dtm[0] + (plant.maturityFrom === 'transplant' && !establishFromTransplant ? 14 : 0);
    const available = ff.doy - (establish ?? lf.doy);
    if (available < needed) {
      fits = false;
      warnings.push(`Only about ${Math.max(0, available)} frost-free days after planting; even fast varieties need ${needed}.`);
    }
  }
  events.sort((x, y) => x.start - y.start);
  return { plantId: plant.id, events, fits, warnings };
}

function describeOffset([a, b]: [number, number]): string {
  const f = (d: number) => (d === 0 ? 'on' : d < 0 ? `${-d} days before` : `${d} days after`);
  if (a === b) return `${f(a)}`;
  if (a < 0 && b <= 0) return `${-b}–${-a} days before`;
  if (a >= 0 && b > 0) return `${a}–${b} days after`;
  return `from ${-a} days before to ${b} days after`;
}

function describeFall([a, b]: [number, number]): string {
  if (a >= 0 && b >= 0) return `${Math.min(a, b)}–${Math.max(a, b)} days before`;
  if (a <= 0 && b <= 0) return `${Math.min(-a, -b)}–${Math.max(-a, -b)} days after`;
  return `from ${a} days before to ${-b} days after`;
}

/** Tasks whose window overlaps [fromDoy, toDoy] across all calendars, sorted by start. */
export function upcomingTasks(cals: PlantCalendar[], fromDoy: number, toDoy: number): Array<CalendarEvent & { plantId: string }> {
  const out: Array<CalendarEvent & { plantId: string }> = [];
  for (const c of cals) for (const e of c.events) if (e.end >= fromDoy && e.start <= toDoy) out.push({ ...e, plantId: c.plantId });
  return out.sort((a, b) => a.start - b.start);
}
