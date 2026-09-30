/**
 * Parcel-adjusted planting calendar (§7.3). Dates come from the parcel's own frost probabilities
 * (Phase 1 frost engine, elevation-adjusted) and, when available, soil temperature (sensor → regional
 * station → modeled). Every event explains what it was based on.
 */
import { formatDoy } from '../climate/normals';
import type { FrostDates } from '../climate/frost';
import { daysToGdd, firstDayAtLeast, modeledSoilF, type ClimateCurves } from './seasonModel';
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
  /** Where `soilF` comes from ("measured", "regional station", "modeled"), for the explanations. */
  soilLabel?: string;
  /** Use heat units (GDD) instead of calendar days for maturity where the crop has a GDD target. */
  dynamicGdd?: boolean;
}

const clampDoy = (d: number) => Math.max(1, Math.min(365, Math.round(d)));
const win = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/**
 * Spring timing is anchored to the median last frost, as extension offsets are written. In cautious
 * mode, frost-tender crops are also never set out before the 10 % (late) frost date; the offset is not
 * applied on top of that date, which would double-count the caution.
 */
function lastFrost(ctx: CalendarContext): { doy: number; late: number | null; label: string } | null {
  const d = ctx.frost.lastSpring[32][50];
  if (d === null) return null;
  return { doy: d, late: ctx.frost.lastSpring[32][10], label: `median last frost (${formatDoy(d)})` };
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

  const lf = lastFrost(ctx);
  const ff = firstFrost(ctx, plant);
  if (ctx.frost.freezeRare || !lf || !ff) {
    // Frost-free climates plan around heat and rain, not frost: no frost-anchored dates to give.
    return {
      plantId: plant.id, events, fits: true,
      warnings: [ctx.frost.freezeRare
        ? 'Frost is rare here, so frost-based dates don’t apply: grow cool-season crops through fall and winter and warm-season crops from late winter to early summer. Your state extension service publishes a local planting calendar.'
        : 'No frost dates for this parcel, so timing can’t be personalised yet.'],
    };
  }

  // Soil-temperature gate: the first day soil stays at or above the crop's minimum.
  const soilReady = sow.minSoilF !== undefined && soil ? firstDayAtLeast(soil, sow.minSoilF, 1, 250) : null;
  const soilKind = ctx.soilLabel ?? (ctx.soilF ? 'measured' : 'modeled');
  // Soil that never gets warm enough is a real limit, not a reason to drop the check.
  const soilNeverWarm = sow.minSoilF !== undefined && !!soil && soilReady === null;
  if (soilNeverWarm)
    warnings.push(`Soil here rarely reaches the ${sow.minSoilF} °F this crop needs (${soilKind}). Warm it with black plastic mulch or a low tunnel before planting, and check with a soil thermometer.`);
  const soilNote = soilReady !== null ? ` and soil ${sow.minSoilF} °F+ (≈${formatDoy(soilReady)}, ${soilKind})` : '';
  const cautious = tender && ctx.risk !== 'typical' && lf.late !== null;
  const cautionNote = cautious ? `, not before the 1-in-10-years late frost (${formatDoy(lf.late!)})` : '';
  const gate = (d: number) => {
    let g = d;
    if (cautious) g = Math.max(g, lf.late!);
    if (soilReady !== null) g = Math.max(g, soilReady);
    return g;
  };

  let establish: number | null = null; // day the crop goes in the ground (for maturity)
  let establishFromTransplant = false;

  if (sow.transplantDays && (sow.method === 'transplant' || sow.method === 'either')) {
    const [a, b] = win(lf.doy + sow.transplantDays[0], lf.doy + sow.transplantDays[1]);
    // If caution or warm soil come later than the frost-based window, shift the window rather than squeeze it.
    const start = clampDoy(gate(a)), end = clampDoy(start + (b - a));
    if (sow.indoorStartWeeks) {
      // Seedlings are started so they reach transplant size when the transplant window opens.
      const [older, younger] = sow.indoorStartWeeks;
      events.push({ kind: 'start-indoors', start: clampDoy(start - older * 7), end: clampDoy(start - younger * 7), label: 'Start seeds indoors', basis: `${younger}–${older} weeks before transplanting` });
    }
    events.push({ kind: 'harden-off', start: clampDoy(start - 10), end: clampDoy(start - 1), label: 'Harden off seedlings', basis: 'the 7–10 days before transplanting' });
    events.push({ kind: 'transplant', start, end, label: 'Transplant outdoors', basis: `${describeOffset(sow.transplantDays)} the ${lf.label}${cautionNote}${soilNote}` });
    establish = start;
    establishFromTransplant = true;
  }
  // Nursery plants (crowns, potted herbs, trees) may carry their window in either field.
  const plantDays = sow.directSowDays ?? (sow.method === 'plant' ? sow.transplantDays : undefined);
  if (plantDays && (sow.method === 'direct' || sow.method === 'either' || sow.method === 'plant')) {
    const [a, b] = win(lf.doy + plantDays[0], lf.doy + plantDays[1]);
    const start = clampDoy(gate(a)), end = clampDoy(Math.max(b, start + Math.min(14, b - a)));
    events.push({ kind: sow.method === 'plant' ? 'plant' : 'direct-sow', start, end, label: sow.method === 'plant' ? 'Plant out' : 'Sow outdoors', basis: `${describeOffset(plantDays)} the ${lf.label}${cautionNote}${soilNote}` });
    if (establish === null) establish = start;
  }

  // Maturity / harvest.
  const dtm = plant.daysToMaturity;
  let fits = !soilNeverWarm;
  if (establish !== null && dtm) {
    let harvestStart: number | null = null;
    let basis: string;
    // Days-to-maturity is published either from seeding or from transplanting. Convert to the way
    // this crop is actually established: direct-seeded transplant-type crops take ~2 weeks longer;
    // seed-counted crops set out as transplants already have their seedling weeks behind them.
    const seedlingDays = sow.indoorStartWeeks ? Math.round(((sow.indoorStartWeeks[0] + sow.indoorStartWeeks[1]) / 2) * 7) : 28;
    const extra = plant.maturityFrom === 'transplant' && !establishFromTransplant ? 14
      : plant.maturityFrom === 'seed' && establishFromTransplant ? -seedlingDays : 0;
    const fromLabel = extra > 0 ? 'seeding (+ ~2 weeks vs. transplants)' : extra < 0 ? `seeding (≈${Math.round(-extra / 7)} weeks of that already indoors)` : plant.maturityFrom ?? 'planting';
    if (ctx.dynamicGdd && plant.gddToMaturity && ctx.curves) {
      const days = daysToGdd(ctx.curves, establish, plant.gddToMaturity, plant.gddBaseF ?? 50);
      harvestStart = days === null ? null : establish + Math.max(14, days);
      basis = `${plant.gddToMaturity} heat units (base ${plant.gddBaseF ?? 50} °F) after ${formatDoy(establish)}`;
      if (days === null) {
        fits = false;
        warnings.push(`This climate doesn’t build up the ${plant.gddToMaturity} heat units it needs to mature. Choose a much faster variety or grow it under cover.`);
      }
    } else {
      // Even a well-grown transplant needs a couple of weeks in the ground before the first harvest.
      harvestStart = establish + Math.max(14, dtm[0] + extra);
      basis = `${dtm[0]}–${dtm[1]} days from ${fromLabel}`;
    }
    const tenderAnnual = plant.lifecycle !== 'perennial' && tender;
    if (harvestStart !== null && tenderAnnual && harvestStart > ff.doy) {
      // It won't mature before frost kills it: no harvest window to show.
      fits = false;
      warnings.push(`Needs until about ${formatDoy(harvestStart)} to mature, after the ${ff.label}. Choose a faster variety, start earlier indoors, or use row cover.`);
    } else if (harvestStart !== null && harvestStart <= 365 + 60) {
      const end = Math.min(harvestStart + (dtm[1] - dtm[0]) + (plant.harvestWindowDays ?? 14), tenderAnnual ? ff.doy : 400);
      events.push({ kind: 'harvest', start: clampDoy(harvestStart), end: clampDoy(Math.max(harvestStart, end)), label: 'Harvest', basis });
    }
    if (sow.successionDays && harvestStart !== null) {
      // Successions are direct-sown: count from seed (transplant-counted crops take ~2 weeks longer).
      const lastSow = (tender ? ff.doy : ff.doy + 14) - dtm[0] - (plant.maturityFrom === 'transplant' ? 14 : 0);
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
      const ready = a + dtm[0];
      if (tender && ready > ff.doy) {
        warnings.push(`A fall sowing wouldn’t mature (about ${formatDoy(ready)}) before the ${ff.label}.`);
      } else {
        // Tender crops stop at the frost; hardy ones keep going for weeks after it.
        const end = tender ? ff.doy : Math.max(ready, ff.doy + (plant.frost === 'very-hardy' ? 45 : plant.frost === 'hardy' ? 21 : 7));
        events.push({ kind: 'fall-harvest', start: clampDoy(ready), end: clampDoy(Math.max(ready, end)), label: 'Fall harvest', basis: tender ? `${dtm[0]}+ days after sowing, until the ${ff.label}` : `${dtm[0]}+ days after sowing; ${plant.frost} crops keep past the first frost` });
      }
    }
  }

  // Season length check for tender annuals.
  if (tender && plant.lifecycle !== 'perennial' && dtm && ctx.frost.freezeFreeDays !== null) {
    const needed = dtm[0] + (plant.maturityFrom === 'transplant' && !establishFromTransplant ? 14 : 0) - (plant.maturityFrom === 'seed' && establishFromTransplant && sow.indoorStartWeeks ? Math.round(((sow.indoorStartWeeks[0] + sow.indoorStartWeeks[1]) / 2) * 7) : 0);
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
