/**
 * Plan projects: the plan's items grouped into projects a household can start one at a time ("Garden",
 * "Laying hens", "Honeybees"), each a short checklist of steps in order. A project put on the calendar
 * gets a date for every step, one after another; checking a step off early or late moves the steps
 * after it. Finished steps switch on the routine chores they bring (collect eggs, inspect the hives).
 *
 * Step lengths and chore frequencies are planning suggestions, labelled as such: the owner can change
 * the start date, and the calendar follows what they actually check off.
 */
import { doyToIso, isoAdd, type Repeat } from '../calendar/agenda';
import { IN_GROUND_KINDS } from '../safety/notes';
import type { DesignDraft, DraftObject } from './drafts';
import type { HomesteadPlan, PhaseId, PlanItem } from './plan';

export type ChoreRepeat = Exclude<Repeat, 'none' | 'yearly'>;

export interface ChoreTemplate {
  id: string;
  title: string;
  repeat: ChoreRepeat;
  /** Why this routine (a planning suggestion, not a sourced schedule). */
  basis: string;
}

export interface ProjectStep {
  id: string;
  title: string;
  detail?: string;
  /** Suggested working time, days (a planning suggestion). */
  days: number;
  optional?: boolean;
  /** Routine chores that start once this step is done. */
  chores?: ChoreTemplate[];
  /**
   * Only in season: 'spring-planting' from three weeks before the median last frost (cool crops first),
   * 'early-spring' from six weeks before it (bare-root trees, bee packages). Waits for the next spring otherwise.
   */
  season?: 'spring-planting' | 'early-spring';
}

export type ProjectIcon = 'garden' | 'hens' | 'poultry' | 'bees' | 'goats' | 'rabbits' | 'pigs' | 'orchard' | 'tunnel' | 'water';

export interface PlanProject {
  id: string;
  title: string;
  icon: ProjectIcon;
  /** The earliest phase among its plan items, for the timeline. */
  phase: PhaseId;
  summary: string;
  /** The plan items it was built from. */
  itemIds: string[];
  steps: ProjectStep[];
  why: string[];
  regulatory: string[];
}

/** What the owner has done with a project; stored per parcel and synced. */
export interface ProjectProgress {
  parcelId: string;
  projectId: string;
  /** First day of the first step, once the project is on the calendar. */
  startDate?: string;
  /** Step id → the day it was checked off. */
  done: Record<string, string>;
  /** Chore ids the owner switched off. */
  choresOff?: string[];
  /** The project as it was when started, so later plan changes don't reshuffle steps already under way. */
  project?: ProjectSnapshot;
  updatedAt: string;
}

export type ProjectSnapshot = Pick<PlanProject, 'id' | 'title' | 'icon' | 'steps'>;

/** The steps to follow: the snapshot taken at the start, else the plan's current version. */
export function projectFor(live: PlanProject | undefined, progress: ProjectProgress | undefined): ProjectSnapshot | undefined {
  return progress?.project ?? live;
}

export interface ScheduledStep {
  step: ProjectStep;
  index: number;
  start: string;
  end: string;
  doneOn?: string;
  /** Not done and its end has passed (it's stretched to today). */
  late?: boolean;
}

export interface ActiveChore {
  chore: ChoreTemplate;
  stepId: string;
  /** First day the chore applies (the day after its step was done). */
  from: string;
}

const ROUTINE = 'A suggested routine; adjust it to your setup.';

const PHASE_ORDER: PhaseId[] = ['year0', 'year1', 'years2to5'];
const earliest = (items: PlanItem[]): PhaseId => PHASE_ORDER.find((p) => items.some((i) => i.phase === p)) ?? 'year1';
const digs = (items: PlanItem[]) => items.some((i) => i.draft?.some((d) => d.op === 'add' && IN_GROUND_KINDS.has(d.kind)));
const call811: ProjectStep = { id: 'call-811', title: 'Call or click 811 before digging', detail: 'It’s free, and state law requires it a few working days before you dig.', days: 3 };
const rules = (what: string): ProjectStep => ({ id: 'check-rules', title: `Check local rules for ${what}`, detail: 'Zoning, HOA or lease limits on numbers, roosters, setbacks and housing.', days: 3 });

// Species → how the project is set up and what it brings. Chores are kept few, so the calendar stays readable.
interface Herdwork { title: string; icon: ProjectIcon; housing: string; arrive: string; chores: ChoreTemplate[]; extra?: ProjectStep[] }
const feedWater = (id: string, title = 'Feed, water and check the animals'): ChoreTemplate => ({ id, title, repeat: 'daily', basis: ROUTINE });
const HERDWORK: Record<string, Herdwork> = {
  laying_hens: {
    title: 'Laying hens', icon: 'hens', housing: 'Build the coop and run', arrive: 'Bring the hens home',
    chores: [
      { id: 'eggs', title: 'Collect eggs; check feed and water', repeat: 'daily', basis: ROUTINE },
      { id: 'bedding', title: 'Refresh the coop bedding', repeat: 'weekly', basis: ROUTINE },
    ],
  },
  meat_chickens: {
    title: 'Meat chickens', icon: 'poultry', housing: 'Set up a brooder and a run', arrive: 'Bring the chicks home',
    chores: [feedWater('feed', 'Feed, water and check the birds'), { id: 'move', title: 'Fresh bedding or move the run', repeat: 'weekly', basis: ROUTINE }],
  },
  turkeys: { title: 'Turkeys', icon: 'poultry', housing: 'Set up a brooder and a run', arrive: 'Bring the poults home', chores: [feedWater('feed', 'Feed, water and check the birds')] },
  ducks_layers: {
    title: 'Ducks', icon: 'poultry', housing: 'Build the duck house', arrive: 'Bring the ducks home',
    chores: [{ id: 'eggs', title: 'Collect eggs; fresh water', repeat: 'daily', basis: ROUTINE }, { id: 'bedding', title: 'Refresh the bedding', repeat: 'weekly', basis: ROUTINE }],
  },
  honeybees: {
    title: 'Honeybees', icon: 'bees', housing: 'Set up the hives', arrive: 'Install the bees',
    extra: [{ id: 'learn', title: 'Join a local beekeeping club or class', detail: 'A mentor nearby is the best start.', days: 14 }, { id: 'order', title: 'Order packages or nucs', detail: 'Suppliers sell out by late winter.', days: 7 }],
    chores: [{ id: 'inspect', title: 'Inspect the hives (in season)', repeat: 'weekly', basis: ROUTINE }],
  },
  meat_rabbits: { title: 'Rabbits', icon: 'rabbits', housing: 'Build the hutches', arrive: 'Bring the rabbits home', chores: [feedWater('feed'), { id: 'clean', title: 'Clean the hutches', repeat: 'weekly', basis: ROUTINE }] },
  dairy_goats: {
    title: 'Dairy goats', icon: 'goats', housing: 'Build the shelter', arrive: 'Bring the goats home',
    chores: [feedWater('feed'), { id: 'hooves', title: 'Check hooves and body condition', repeat: 'monthly', basis: ROUTINE }],
  },
  meat_goats: { title: 'Meat goats', icon: 'goats', housing: 'Build the shelter', arrive: 'Bring the goats home', chores: [feedWater('feed'), { id: 'hooves', title: 'Check hooves and body condition', repeat: 'monthly', basis: ROUTINE }] },
  sheep: { title: 'Sheep', icon: 'goats', housing: 'Build the shelter', arrive: 'Bring the sheep home', chores: [feedWater('feed'), { id: 'hooves', title: 'Check hooves and body condition', repeat: 'monthly', basis: ROUTINE }] },
  feeder_pigs: { title: 'Pigs', icon: 'pigs', housing: 'Fence the pig area and set up shelter', arrive: 'Bring the pigs home', chores: [feedWater('feed')] },
};

function livestockProject(item: PlanItem): PlanProject {
  const sp = item.livestock!.species;
  const w = HERDWORK[sp] ?? { title: item.title, icon: 'poultry' as const, housing: 'Build the housing', arrive: 'Bring the animals home', chores: [feedWater('feed')] };
  const fenced = item.draft?.some((d) => d.op === 'add' && d.kind === 'paddock');
  const steps: ProjectStep[] = [
    rules(w.title.toLowerCase()),
    ...(w.extra ?? []),
    ...(digs([item]) ? [call811] : []),
    ...(fenced ? [{ id: 'fence', title: 'Fence the paddock', days: 14 }] : []),
    { id: 'housing', title: w.housing, detail: item.detail || undefined, days: 14 },
    ...(sp === 'honeybees' ? [] : [{ id: 'supplies', title: 'Line up feed, bedding and a vet', detail: 'Find a vet who sees this species before the animals arrive.', days: 7 }]),
    { id: 'arrive', title: w.arrive, days: 1, chores: w.chores, ...(sp === 'honeybees' ? { season: 'early-spring' as const } : {}) },
  ];
  return {
    id: item.id, title: w.title, icon: w.icon, phase: item.phase, summary: item.title, itemIds: [item.id], steps,
    why: item.why, regulatory: item.regulatory ?? [],
  };
}

/** The plan's items as projects, in timeline order (phase, then the order they appear in the plan). */
export function projectsFromPlan(plan: HomesteadPlan): PlanProject[] {
  const by = new Map(plan.items.map((i) => [i.id, i]));
  const pick = (...ids: string[]) => ids.flatMap((id) => (by.has(id) ? [by.get(id)!] : []));
  const out: PlanProject[] = [];

  // Garden: the year-0 infrastructure that serves it, then planting.
  const garden = by.get('garden-y1');
  if (garden) {
    const infra = pick('beds', 'compost', 'drip', 'rain', 'deer');
    const items = [...infra, garden, ...pick('storage')];
    const steps: ProjectStep[] = [
      ...(digs(items) ? [call811] : []),
      ...pick('beds').map((i) => ({ id: 'beds', title: i.title, detail: i.detail, days: 14 })),
      ...pick('compost').map((i) => ({ id: 'compost', title: i.title, detail: i.detail, days: 7 })),
      ...pick('drip', 'rain').map((i) => ({ id: i.id, title: i.title, detail: i.detail, days: 7 })),
      ...(by.has('beds') ? [{ id: 'fill', title: 'Fill the beds with soil and compost', days: 7 }] : []),
      ...pick('deer').map((i) => ({ id: 'deer', title: 'Fence the garden (if deer visit)', detail: i.detail, days: 7, optional: true })),
      {
        id: 'plant', title: 'Plant the garden', detail: `${garden.detail}. Each crop’s sowing window shows on the calendar once it’s planned in a bed.`, days: 30, season: 'spring-planting',
        chores: [{ id: 'garden-check', title: 'Garden check: water, weeds and pests', repeat: 'weekly', basis: ROUTINE }],
      },
      ...pick('storage').map((i) => ({ id: 'storage', title: i.title, detail: i.detail, days: 14 })),
    ];
    out.push({ id: 'garden', title: 'Vegetable garden', icon: 'garden', phase: earliest(items), summary: garden.title, itemIds: items.map((i) => i.id), steps, why: garden.why, regulatory: [] });
  }

  for (const item of plan.items.filter((i) => i.category === 'livestock' && i.livestock)) out.push(livestockProject(item));

  // Orchard, berries and perennial beds: one planting project.
  const perennials = plan.items.filter((i) => i.category === 'perennials');
  if (perennials.length) {
    const trees = perennials.some((i) => i.id.startsWith('tree-'));
    out.push({
      id: 'perennials', title: trees ? 'Orchard and perennials' : 'Berries and perennials', icon: 'orchard', phase: earliest(perennials),
      summary: perennials.map((i) => i.title).join(', '), itemIds: perennials.map((i) => i.id),
      steps: [
        { id: 'choose', title: 'Choose varieties and order plants', detail: 'Bare-root stock ships in late winter and early spring.', days: 14 },
        ...(digs(perennials) ? [call811] : []),
        { id: 'prepare', title: 'Prepare the planting spots', detail: 'Clear grass, loosen the soil and mark the spacing.', days: 7 },
        {
          id: 'plant', title: 'Plant', detail: perennials.map((i) => i.title).join(', '), days: 7, season: 'early-spring',
          chores: [{ id: 'water-new', title: 'Water the new plantings (first year)', repeat: 'weekly', basis: ROUTINE }],
        },
        { id: 'protect', title: 'Mulch and protect the trunks', days: 3 },
      ],
      why: perennials.flatMap((i) => i.why).slice(0, 3), regulatory: [],
    });
  }

  const expand = by.get('garden-y2');
  if (expand) {
    out.push({
      id: 'garden-y2', title: 'Garden expansion', icon: 'garden', phase: expand.phase, summary: expand.title, itemIds: [expand.id],
      steps: [{ id: 'beds', title: 'Build the new beds', days: 14 }, { id: 'fill', title: 'Fill the beds with soil and compost', days: 7 }, { id: 'plant', title: 'Plant the new beds', detail: expand.detail, days: 30, season: 'spring-planting' }],
      why: expand.why, regulatory: [],
    });
  }

  const tunnel = by.get('tunnel');
  if (tunnel) {
    out.push({
      id: 'tunnel', title: 'High tunnel', icon: 'tunnel', phase: tunnel.phase, summary: tunnel.title, itemIds: [tunnel.id],
      steps: [{ id: 'site', title: 'Choose the site and a kit', detail: tunnel.detail, days: 14 }, call811, { id: 'build', title: 'Build the tunnel', days: 14 }],
      why: tunnel.why, regulatory: [],
    });
  }

  return out.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));
}

/** The plan items' design changes for a project, as one draft (the owner approves it in Drafts). */
export function projectDraft(project: PlanProject, plan: HomesteadPlan, id: string): DesignDraft | null {
  const items = plan.items.filter((i) => project.itemIds.includes(i.id) && i.draft?.length);
  if (!items.length) return null;
  const changes: DraftObject[] = items.flatMap((i) => i.draft!);
  const herd = items.find((i) => i.livestock)?.livestock;
  return { id, summary: project.title, changes, why: project.why, createdBy: 'rules', phase: project.phase, ...(herd ? { herd } : {}) };
}

/**
 * Dates for every step once the project is on the calendar: one after another from the start date.
 * A step checked off moves the next one to the following day; a step past its end and not done is
 * stretched to today, so the steps after it move too.
 */
export function scheduleProject(project: ProjectSnapshot, progress: ProjectProgress | undefined, today: string, site: { lastFrostDoy?: number } = {}): ScheduledStep[] {
  if (!progress?.startDate) return [];
  const out: ScheduledStep[] = [];
  let cursor = progress.startDate;
  let firstOpen = true;
  project.steps.forEach((step, index) => {
    const doneOn = progress.done[step.id];
    const start = inSeason(step, cursor, site.lastFrostDoy);
    if (doneOn) {
      const end = doneOn < start ? start : doneOn;
      out.push({ step, index, start: doneOn < start ? doneOn : start, end, doneOn });
      cursor = isoAdd(doneOn, 1) > cursor ? isoAdd(doneOn, 1) : cursor;
      return;
    }
    let end = isoAdd(start, Math.max(1, step.days) - 1);
    // Optional steps run alongside the next one instead of holding it up.
    if (step.optional) { out.push({ step, index, start, end }); return; }
    const late = firstOpen && end < today;
    if (late) end = today;
    firstOpen = false;
    out.push({ step, index, start, end, ...(late ? { late } : {}) });
    cursor = isoAdd(end, 1);
  });
  return out;
}

/** The first day from `from` that a seasonal step can start: inside its spring window, else the next one. */
function inSeason(step: ProjectStep, from: string, lastFrostDoy: number | undefined): string {
  if (!step.season || lastFrostDoy === undefined) return from;
  const open = lastFrostDoy - (step.season === 'early-spring' ? 42 : 21);
  const close = open + (step.season === 'early-spring' ? 75 : 120);
  const year = Number(from.slice(0, 4));
  for (const y of [year - 1, year, year + 1]) {
    const a = doyToIso(y, open), b = doyToIso(y, close);
    if (from <= b) return from >= a ? from : a;
  }
  return from;
}

/** Chores switched on by finished steps (and not switched off). */
export function activeChores(project: ProjectSnapshot, progress: ProjectProgress | undefined): ActiveChore[] {
  if (!progress) return [];
  const off = new Set(progress.choresOff ?? []);
  return project.steps.flatMap((s) => {
    const d = progress.done[s.id];
    return d ? (s.chores ?? []).filter((c) => !off.has(c.id)).map((c) => ({ chore: c, stepId: s.id, from: isoAdd(d, 1) })) : [];
  });
}

export function projectProgressShare(project: ProjectSnapshot, progress: ProjectProgress | undefined): { done: number; total: number } {
  const required = project.steps.filter((s) => !s.optional);
  return { done: required.filter((s) => progress?.done[s.id]).length, total: required.length };
}

/** The next step to do (first not-done, not-optional; optional ones only if nothing else is left). */
export function nextStep(project: ProjectSnapshot, progress: ProjectProgress | undefined): ProjectStep | undefined {
  const open = project.steps.filter((s) => !progress?.done[s.id]);
  return open.find((s) => !s.optional) ?? open[0];
}

/** Days from the start date to the last step's end, for "about N weeks". */
export function projectSpanDays(project: ProjectSnapshot): number {
  return project.steps.filter((s) => !s.optional).reduce((a, s) => a + Math.max(1, s.days), 0);
}

