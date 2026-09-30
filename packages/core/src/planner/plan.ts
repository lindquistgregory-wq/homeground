/**
 * The rules-based planner (§9.1 fallback, and the engine behind the model's tools). Turns the goals and the
 * parcel into a phased plan: Year 0 infrastructure → Year 1 annual crops and small livestock → Years 2–5
 * perennials, orchard and expansions, sized to the household's food target, space, time and budget.
 *
 * Every figure comes from the plant database, the knowledge base or the parcel's own data. The planner's
 * own choices (how to split beds, what to defer) are planning heuristics and are labelled as suggestions.
 */
import { PLANTS, plantById } from '../plants/index';
import type { PlantSpec } from '../plants/types';
import { estimateBudget, moneyRange, type Budget, type BudgetItem } from './budget';
import { estimateFoodCoverage, type CoverageReport, type PlannedFood } from './coverage';
import type { DraftObject } from './drafts';
import { compareEnterprises, INCOME_DISCLAIMER, type EnterpriseFit } from './enterprises';
import { FOOD_TARGETS, summarizeGoals, type DietFlag, type HomesteadGoals } from './goals';
import type { KnowledgeBase } from './kb';
import { annualNeeds, cropContribution, livestockContribution, type CropAmount, type NutrientKey, type NutrientTotals } from './nutrition';

export type PhaseId = 'year0' | 'year1' | 'years2to5';
export const PHASE_TITLE: Record<PhaseId, string> = {
  year0: 'Year 0: set up (water, beds, fencing, housing)',
  year1: 'Year 1: annual crops and small livestock',
  years2to5: 'Years 2–5: perennials, orchard and expansions',
};

export interface PlanItem {
  id: string;
  phase: PhaseId;
  category: 'infrastructure' | 'garden' | 'livestock' | 'perennials' | 'income' | 'storage' | 'learning';
  title: string;
  detail: string;
  crops?: CropAmount[];
  livestock?: { species: string; count: number };
  budget?: BudgetItem[];
  draft?: DraftObject[];
  /** Livestock chore time from the sources; gardens have no sourced figure. */
  laborHoursPerWeek?: [number, number];
  optional?: boolean;
  why: string[];
  regulatory?: string[];
}

export interface SitePlanInput {
  parcelAcres?: number;
  zone?: string;
  /** Median 32 °F freeze-free days. */
  freezeFreeDays?: number | null;
  frostRare?: boolean;
  /** 0–100 climate fit per plant id (scorePlant against the parcel). Unscored plants are allowed. */
  suitability?: Record<string, number>;
  /** Sources the site facts came from, for the plan's "data used" list. */
  sources?: string[];
}

export interface HomesteadPlan {
  createdAt: string;
  goalsSummary: string;
  items: PlanItem[];
  /** Everything planned, at maturity (fruit trees take years). */
  coverage: CoverageReport;
  /** What the year-0/1 items produce: the honest "first year" picture. */
  coverageYear1: CoverageReport;
  budget: Budget;
  budgetByPhase: Record<PhaseId, Budget>;
  laborByPhase: Record<PhaseId, [number, number]>;
  enterprises?: EnterpriseFit[];
  warnings: string[];
  assumptions: string[];
  dataUsed: string[];
}

// ---------------- Crop allocation ----------------

/** Crops most home gardeners grow and eat a lot of: preferred when the planner adds variety (a heuristic). */
const GARDEN_STAPLES = new Set(['tomato', 'pepper-sweet', 'bean-bush', 'squash-summer', 'squash-winter', 'potato', 'lettuce', 'carrot', 'cucumber', 'onion', 'kale', 'pea', 'corn', 'sweet-potato', 'broccoli', 'bean-dry']);
/** Flavour crops: a little goes a long way, so they get one bed per ~1,300 sq ft at most. */
const isFlavour = (p: PlantSpec) => p.kind === 'herb' || ['garlic', 'pepper-hot', 'scallion', 'leek'].includes(p.id);

type Weights = Partial<Record<NutrientKey, number>>;

function dietAllows(diet: DietFlag[] | undefined, species: string): boolean {
  const d = new Set(diet ?? []);
  if (d.has('vegan')) return false; // includes honey
  const meat = ['meat_chickens', 'turkeys', 'meat_rabbits', 'meat_goats', 'sheep', 'feeder_pigs'];
  if (d.has('vegetarian') && meat.includes(species)) return false;
  if (d.has('no-pork') && species === 'feeder_pigs') return false;
  if (d.has('no-eggs') && (species === 'laying_hens' || species === 'ducks_layers')) return false;
  if (d.has('no-dairy') && species === 'dairy_goats') return false;
  return true;
}

function annualCandidates(site: SitePlanInput, kb: KnowledgeBase): PlantSpec[] {
  return PLANTS.filter((p) => {
    if (p.lifecycle === 'perennial' && p.kind !== 'vegetable') return false;
    if (p.kind !== 'vegetable' && p.kind !== 'herb') return false;
    if (['asparagus', 'rhubarb'].includes(p.id)) return false; // perennial beds: years 2–5
    const f = kb.nutrition.foods[p.id];
    if (!f?.food || !f.per100g || f.per100g.kcal === null || !p.yieldLb) return false;
    const s = site.suitability?.[p.id];
    return s === undefined || s >= 55;
  });
}

/**
 * Fill the garden bed by bed with the crop that closes the largest remaining share of the household's
 * targets (vitamins A and C and fibre for vegetables; calories and protein for staples), with a cap per
 * crop for variety. Yields are the midpoint of each crop's range.
 */
/**
 * Most of a crop worth growing for a household, lb/year: up to twice the US per-capita availability
 * (USDA ERS; gardeners eat more produce than average: a planning allowance), counting canned/frozen
 * amounts only if the household will preserve. Null when ERS has no series for the crop.
 */
export function consumptionCapLb(plantId: string, people: number, willPreserve: boolean, kb: KnowledgeBase): number | null {
  const c = kb.consumption?.perCapitaLb[plantId];
  if (!c) return null;
  const fresh = c.fresh ?? (c.processed === null ? c.total : null);
  const all = c.total ?? ((c.fresh ?? 0) + (c.processed ?? 0) || null);
  const per = willPreserve ? all ?? fresh : fresh ?? all;
  return per === null || per === undefined ? null : per * people * 2;
}

export function allocateGarden(
  areaSqFt: number, needs: NutrientTotals, target: { micro: number; kcal: number }, site: SitePlanInput, kb: KnowledgeBase,
  household: { people: number; willPreserve: boolean } = { people: 1, willPreserve: false },
): CropAmount[] {
  const unit = areaSqFt >= 400 ? 32 : areaSqFt >= 100 ? 16 : 8; // 4×8, 4×4 or 2×4 ft beds
  const units = Math.max(1, Math.floor(areaSqFt / unit));
  // Variety: no crop takes more than ~12 % of the beds, and the first beds go to different crops.
  const cap = Math.max(1, Math.ceil(units * 0.12));
  const minVariety = Math.min(units, 10);
  const want: NutrientTotals = {
    kcal: needs.kcal * target.kcal, proteinG: needs.proteinG * target.kcal, vitARaeUg: needs.vitARaeUg * target.micro,
    vitCMg: needs.vitCMg * target.micro, fiberG: needs.fiberG * target.micro, calciumMg: 0, ironMg: 0,
  };
  const w: Weights = { kcal: 2, proteinG: 1, vitARaeUg: 1, vitCMg: 1, fiberG: 0.5 };
  const have: NutrientTotals = { kcal: 0, proteinG: 0, vitARaeUg: 0, vitCMg: 0, fiberG: 0, calciumMg: 0, ironMg: 0 };
  // Crops without consumption data get a small allowance (a planning choice): one 4×8 bed per three
  // people, and never more than one bed per ~1,000 sq ft of garden.
  const noDataUnits = Math.max(1, Math.min(Math.floor((units * unit) / 1000), Math.ceil((Math.ceil(household.people / 3) * 32) / unit)));
  const cands = annualCandidates(site, kb).map((p) => {
    const c = cropContribution(p, { plantId: p.id, areaSqFt: unit }, kb);
    const mid = c ? (Object.fromEntries(Object.keys(c.nutrients.low).map((k) => [k, (c.nutrients.low[k as NutrientKey] + c.nutrients.high[k as NutrientKey]) / 2])) as NutrientTotals) : null;
    const capLb = consumptionCapLb(p.id, household.people, household.willPreserve, kb);
    const lbPerUnit = c ? (c.amountLb[0] + c.amountLb[1]) / 2 : 0;
    const maxUnits = capLb === null ? noDataUnits : lbPerUnit > 0 ? Math.max(1, Math.floor(capLb / lbPerUnit)) : 1;
    return { p, perUnit: mid, maxUnits };
  }).filter((c) => c.perUnit);
  const used = new Map<string, number>();
  for (let i = 0; i < units; i++) {
    let best: { id: string; gain: number } | null = null;
    for (const c of cands) {
      if ((used.get(c.p.id) ?? 0) >= Math.min(c.maxUnits, isFlavour(c.p) ? Math.max(1, Math.floor(units / 40)) : cap)) continue;
      let gain = 0;
      for (const [k, wt] of Object.entries(w) as Array<[NutrientKey, number]>) {
        const rem = Math.max(0, want[k] - have[k]);
        if (want[k] > 0) gain += (wt * Math.min(rem, c.perUnit![k])) / want[k];
      }
      // Bonus for a new crop, strong until the garden has some variety.
      if (!used.has(c.p.id)) gain *= used.size < minVariety ? (GARDEN_STAPLES.has(c.p.id) ? 4.5 : 3) : 1.2;
      if (!best || gain > best.gain) best = { id: c.p.id, gain };
    }
    if (!best || best.gain <= 1e-4) break;
    used.set(best.id, (used.get(best.id) ?? 0) + 1);
    const c = cands.find((x) => x.p.id === best!.id)!;
    for (const k of Object.keys(have) as NutrientKey[]) have[k] += c.perUnit![k];
  }
  return [...used.entries()].map(([plantId, n]) => ({ plantId, areaSqFt: n * unit }));
}

// ---------------- Plan ----------------

/** "3" for [3, 3], "1.5–5" otherwise (one decimal at most). */
export const rng = (r: [number, number]) => {
  const f = (x: number) => String(Math.round(x * 10) / 10);
  return r[0] === r[1] ? f(r[0]) : `${f(r[0])}–${f(r[1])}`;
};
const fmtArea = (sq: number) => `${Math.round(sq).toLocaleString('en-US')} sq ft`;

export function buildPlan(goals: HomesteadGoals, site: SitePlanInput, kb: KnowledgeBase, opts: { now?: Date; includeIncome?: boolean; showCosts?: boolean } = {}): HomesteadPlan {
  const items: PlanItem[] = [];
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const members = goals.household?.length ? goals.household : [];
  if (!members.length) {
    warnings.push('No household entered yet, so food needs are for one moderately active adult.');
    members.push({ age: 35, sex: 'female', activity: 'moderatelyActive' });
  }
  const needs = annualNeeds(members, kb);
  const ambition = goals.ambition ?? 'kitchen';
  const target = FOOD_TARGETS[ambition];
  const space = goals.gardenSpaceSqFt ?? 200;
  if (goals.gardenSpaceSqFt === undefined) assumptions.push('Garden space not given: planned for about 200 sq ft.');
  const physical = goals.physical ?? 'none';
  const beginner = !goals.experience || goals.experience === 'none';

  // --- Year 1 garden (beginners start with half the space; the rest follows in year 2) ---
  const y1Area = beginner && space > 100 ? space / 2 : space;
  if (beginner && space > 100) assumptions.push('Suggestion: first-time growers start with about half the space and expand in year 2.');
  const hh = { people: members.length, willPreserve: goals.willPreserve ?? false };
  const crops = allocateGarden(y1Area, needs, target, site, kb, hh);
  const bedKind = physical === 'none' && y1Area >= 2000 ? 'in-ground-row' : 'raised-bed';
  const bedArea = bedKind === 'raised-bed' ? 1.2 * 2.4 * 10.764 : 0.75 * 10 * 10.764; // library sizes in sq ft
  const beds = Math.max(1, Math.round(crops.reduce((a, c) => a + (c.areaSqFt ?? 0), 0) / bedArea));
  const usedY1 = crops.reduce((a, c) => a + (c.areaSqFt ?? 0), 0);
  if (usedY1 < y1Area * 0.8) assumptions.push(`Only about ${fmtArea(usedY1)} of the ${fmtArea(y1Area)} is needed to grow what your household eats (USDA ERS average use, allowing twice the average); the rest could hold cover crops, flowers or crops to sell.`);
  items.push({
    id: 'garden-y1', phase: 'year1', category: 'garden',
    title: `Vegetable garden, ${fmtArea(usedY1)}`,
    detail: crops.map((c) => `${plantById(c.plantId)!.commonName} ${fmtArea(c.areaSqFt!)}`).join(', '),
    crops,
    draft: [{ op: 'add', kind: bedKind, count: beds, near: 'sunny', plants: crops.map((c) => c.plantId), plantAreas: Object.fromEntries(crops.map((c) => [c.plantId, c.areaSqFt ?? 0])) }],
    why: [
      `Chosen to cover your target (${target.label.toLowerCase()}) with the crops that suit this climate${site.suitability ? '' : ' (climate fit not scored yet)'}.`,
      bedKind === 'raised-bed' ? (physical !== 'none' ? 'Raised beds mean less bending.' : 'Raised beds suit a small, intensive garden.') : 'In-ground rows suit a large garden.',
    ],
  });
  if (beginner && space > 100) {
    const crops2 = allocateGarden(space, needs, target, site, kb, hh);
    items.push({
      id: 'garden-y2', phase: 'years2to5', category: 'garden', title: `Expand the garden to ${fmtArea(space)}`,
      detail: crops2.map((c) => `${plantById(c.plantId)!.commonName} ${fmtArea(c.areaSqFt!)}`).join(', '),
      crops: crops2, draft: [{ op: 'add', kind: bedKind, count: Math.max(1, Math.round((space - y1Area) / bedArea)), near: 'garden' }],
      why: ['Adds the second half once the first season’s routine is set.'],
    });
  }

  // --- Year 0 infrastructure for the garden ---
  if (physical !== 'none' || bedKind === 'raised-bed') {
    items.push({ id: 'beds', phase: 'year0', category: 'infrastructure', title: `Build ${beds} raised bed${beds === 1 ? '' : 's'}`, detail: 'Library size 4 × 8 ft.', budget: [{ kind: 'raised-beds', count: beds }], why: ['Beds for the year-1 garden.'] });
  }
  if (goals.water === 'well' || goals.water === 'municipal' || goals.water === undefined || goals.water === 'unsure') {
    items.push({ id: 'drip', phase: 'year0', category: 'infrastructure', title: 'Drip irrigation for the garden', detail: `${fmtArea(usedY1)} of beds on a timer.`, budget: [{ kind: 'drip', areaSqFt: usedY1 }], draft: [{ op: 'add', kind: 'drip-line', near: 'garden' }], why: ['Drip puts water at the roots and saves hours of hand-watering.'] });
  }
  if (goals.water === 'rain-only' || goals.water === 'none') {
    items.push({ id: 'rain', phase: 'year0', category: 'infrastructure', title: 'Rainwater catchment', detail: 'Example size 1,000 gallons; size it to your roof and dry spells.', budget: [{ kind: 'rain-catchment', gallons: 1000 }], draft: [{ op: 'add', kind: 'ibc-tote', count: 3, near: 'house' }], why: ['You said the garden has no mains or well water.'] });
    warnings.push('Without mains or well water, a dry spell can outlast stored rainwater. Check your state’s rules on rainwater collection.');
  }
  items.push({ id: 'deer', phase: 'year0', category: 'infrastructure', title: 'Deer fence around the garden (if deer visit)', detail: `About ${Math.round(4 * Math.sqrt(usedY1))} ft of fence for a square plot.`, budget: [{ kind: 'deer-fence', lengthFt: 4 * Math.sqrt(usedY1) }], draft: [{ op: 'add', kind: 'fence-deer', near: 'garden' }], optional: true, why: ['Only needed where deer are common.'] });
  items.push({ id: 'compost', phase: 'year0', category: 'infrastructure', title: 'Compost bays', detail: 'Turn kitchen and garden waste into bed fill.', draft: [{ op: 'add', kind: 'compost-bays', near: 'garden' }], why: ['Cuts the cost of soil and fertiliser each year.'] });

  // --- Livestock ---
  // Animals only once the user says they're allowed (or unsure, with a warning to check).
  const animalsOk = goals.animals === 'yes' || goals.animals === 'poultry-only' || goals.animals === 'unsure';
  if (goals.animals === undefined) assumptions.push('Animals are left out until you say whether they’re allowed where you live.');
  const poultryOnly = goals.animals === 'poultry-only';
  const interest = new Set(goals.animalInterest ?? []);
  const wantsAnimalFood = ambition !== 'kitchen' || interest.size > 0;
  /**
   * Chore time only where the source's scale matches: the hen range is 10 hens (low) to 100 hens (high);
   * the broiler figure is a 100-bird, 7-batch system, so it isn't applied to small batches.
   */
  const laborFor = (species: string, count: number): [number, number] | undefined => {
    const l = kb.homestead.livestock[species]?.laborHoursPerWeek ?? undefined;
    if (!l) return undefined;
    if (species === 'laying_hens') return count <= 10 ? [l[0], l[0]] : count >= 100 ? [l[1], l[1]] : l;
    if (species === 'meat_chickens') return count >= 100 ? l : undefined;
    return l;
  };
  const addLivestock = (species: string, count: number, phase: PhaseId, why: string[], draft: DraftObject[], extraBudget: BudgetItem[] = []) => {
    const lp = kb.homestead.livestock[species]!;
    const labor = laborFor(species, count);
    const name = species === 'honeybees' ? `hive${count === 1 ? '' : 's'} of honeybees` : species.replace(/_/g, ' ');
    items.push({
      id: `ls-${species}`, phase, category: 'livestock', title: `${count} ${name}`,
      detail: [lp.spaceIndoorSqFt ? `${rng(lp.spaceIndoorSqFt)} sq ft indoors each` : '', lp.spaceOutdoorSqFt ? `${rng(lp.spaceOutdoorSqFt)} sq ft outdoors each` : '', labor ? `about ${rng(labor)} h/week of chores` : 'chore time not in the sources for this size'].filter(Boolean).join('; '),
      livestock: { species, count }, budget: [{ kind: 'livestock', species, count }, ...extraBudget], draft,
      laborHoursPerWeek: labor, why, regulatory: lp.regulatory,
    });
  };
  if (animalsOk && (interest.has('laying_hens') || (wantsAnimalFood && interest.size === 0)) && dietAllows(goals.diet, 'laying_hens')) {
    const n = kb.homestead.livestock.laying_hens?.starterFlockSize?.[0] ?? 10;
    addLivestock('laying_hens', n, 'year1', [`A ${n}-hen flock is the size the University of Maryland backyard budget uses.`, 'Hens are the easiest first livestock: eggs, pest control and compost.'],
      [{ op: 'add', kind: 'chicken-coop', near: 'house' }, { op: 'add', kind: 'chicken-run', near: 'house' }], [{ kind: 'coop' }]);
    if (goals.roostersAllowed === undefined) warnings.push('Hens don’t need a rooster to lay. Check whether your town limits roosters or flock size.');
  }
  if (animalsOk && interest.has('honeybees') && !(goals.diet ?? []).includes('vegan')) addLivestock('honeybees', 2, 'year1', ['Two hives let you compare colonies and share resources between them (a common beginner suggestion).'], [{ op: 'add', kind: 'beehive', count: 2, near: 'edge' }]);
  if (animalsOk && interest.has('meat_chickens') && dietAllows(goals.diet, 'meat_chickens')) {
    // Size to the protein still missing after the garden and any eggs, in batches of 5.
    const mid = (c: ReturnType<typeof cropContribution>) => (c ? (c.nutrients.low.proteinG + c.nutrients.high.proteinG) / 2 : 0);
    const have = crops.reduce((a, c) => a + mid(cropContribution(plantById(c.plantId)!, c, kb)), 0)
      + items.filter((i) => i.livestock).reduce((a, i) => a + mid(livestockContribution(i.livestock!.species, i.livestock!.count, kb)), 0);
    const per = mid(livestockContribution('meat_chickens', 1, kb));
    const gap = Math.max(0, needs.proteinG * Math.max(target.kcal, 0.25) - have);
    const n = per > 0 ? Math.min(100, Math.max(5, Math.ceil(gap / per / 5) * 5)) : 10;
    addLivestock('meat_chickens', n, 'year1', [gap > 0 ? 'Sized to the protein your garden and eggs don’t cover; raise them in one or two summer batches.' : 'A small batch of 5 (your garden and eggs already cover your protein target).'], [{ op: 'add', kind: 'chicken-run', near: 'anywhere' }]);
  }
  if (animalsOk && !poultryOnly) {
    const acres = site.parcelAcres ?? 0;
    const later: Array<[string, number, DraftObject[]]> = [
      ['meat_rabbits', 3, [{ op: 'add', kind: 'rabbit-hutch', near: 'house' }]],
      ['dairy_goats', 2, [{ op: 'add', kind: 'goat-shelter' }, { op: 'add', kind: 'paddock' }]],
      ['meat_goats', 2, [{ op: 'add', kind: 'goat-shelter' }, { op: 'add', kind: 'paddock' }]],
      ['sheep', 2, [{ op: 'add', kind: 'goat-shelter' }, { op: 'add', kind: 'paddock' }]],
      ['feeder_pigs', 2, [{ op: 'add', kind: 'paddock' }]],
      ['turkeys', 4, [{ op: 'add', kind: 'chicken-run' }]],
      ['ducks_layers', 4, [{ op: 'add', kind: 'duck-house' }]],
    ];
    for (const [sp, n, draft] of later) {
      if (!interest.has(sp) || !dietAllows(goals.diet, sp)) continue;
      const lp = kb.homestead.livestock[sp]!;
      const pasture = lp.pastureAcresPerHead;
      if (pasture && pasture[0] * n > acres) {
        warnings.push(`${sp.replace(/_/g, ' ')}: ${n} need about ${(pasture[0] * n).toFixed(2)}+ acres of pasture; ${site.parcelAcres === undefined ? 'the parcel size isn’t known yet' : `the parcel is ${acres.toFixed(2)} acres`}.`);
        continue;
      }
      const herd = ['dairy_goats', 'meat_goats', 'sheep', 'feeder_pigs'].includes(sp);
      const fence: BudgetItem[] = pasture ? [{ kind: 'livestock-fence', lengthFt: 4 * Math.sqrt(Math.max(pasture[1] * n, 0.05) * 43560) }] : [];
      addLivestock(sp, n, 'years2to5', [herd ? `${n} animals, because herd animals shouldn't be kept alone.` : `A small starting group of ${n}.`, 'Added after the garden and hens are running.'], draft, fence);
    }
  } else if (poultryOnly && [...interest].some((s) => !['laying_hens', 'meat_chickens', 'ducks_layers', 'turkeys', 'honeybees'].includes(s))) {
    warnings.push('Your rules allow poultry only, so the other animals you’re interested in are left out.');
  }
  if (goals.animals === 'unsure' && items.some((i) => i.category === 'livestock')) warnings.push('Check zoning, HOA or lease rules before buying animals.');

  // --- Years 2–5 perennials ---
  const perennialFruit = PLANTS.filter((p) => ['fruit-tree', 'berry', 'vine-fruit', 'nut-tree'].includes(p.kind) && (site.suitability?.[p.id] ?? 0) >= 70)
    .sort((a, b) => (site.suitability?.[b.id] ?? 0) - (site.suitability?.[a.id] ?? 0));
  // Scale perennials to the household and the land (a planning choice): a kitchen garden or a single
  // person gets one tree and one berry; tiny lots get berries only; bigger goals get up to three trees.
  const people = members.length;
  const acresKnown = site.parcelAcres;
  const treeTypes = acresKnown !== undefined && acresKnown < 0.1 ? 0 : ambition === 'kitchen' || people === 1 ? 1 : ambition === 'most-veg' ? 2 : 3;
  const berryTypes = ambition === 'kitchen' || people === 1 ? 1 : 2;
  const trees = perennialFruit.filter((p) => p.kind === 'fruit-tree' || p.kind === 'nut-tree').slice(0, treeTypes);
  const berries = perennialFruit.filter((p) => p.kind === 'berry' || p.kind === 'vine-fruit').slice(0, berryTypes);
  if (!site.suitability) assumptions.push('Fruit and berry choices need the site profile’s climate fit; none are suggested until it’s built.');
  for (const t of trees) {
    const n = t.pollination === 'needs-partner' ? 2 : 1;
    items.push({
      id: `tree-${t.id}`, phase: 'years2to5', category: 'perennials', title: `${n} ${t.commonName} tree${n > 1 ? 's' : ''}`,
      detail: `${t.yearsToBearing ? `First real crop in ${t.yearsToBearing[0]}–${t.yearsToBearing[1]} years. ` : ''}${n > 1 ? 'Two varieties for cross-pollination.' : ''}`,
      crops: [{ plantId: t.id, plants: n }], draft: [{ op: 'add', kind: t.kind === 'nut-tree' ? 'nut-tree' : 'fruit-tree-semi', count: n, near: 'sunny' }],
      why: [`Fits this climate (${site.suitability?.[t.id]}/100).`, 'Plant early: trees take years to bear.'],
    });
  }
  for (const b of berries) {
    const plants = b.yieldLb?.per === 'plant' ? 6 : 0;
    items.push({
      id: `berry-${b.id}`, phase: 'years2to5', category: 'perennials', title: `${b.commonName} row`,
      detail: plants ? `${plants} plants.` : 'One 25 ft row.', crops: [plants ? { plantId: b.id, plants } : { plantId: b.id, rowFt: 25 }],
      draft: [{ op: 'add', kind: b.kind === 'vine-fruit' ? 'trellis' : 'berry-row', near: 'sunny' }], why: [`Fits this climate (${site.suitability?.[b.id]}/100).`],
    });
  }
  for (const id of ['asparagus', 'rhubarb']) {
    const p = plantById(id);
    if (p && ambition !== 'kitchen' && (site.suitability?.[id] ?? 0) >= 70) {
      items.push({ id: `bed-${id}`, phase: 'years2to5', category: 'perennials', title: `${p.commonName} bed`, detail: 'A permanent 4 × 8 ft bed.', crops: [{ plantId: id, areaSqFt: 32 }], draft: [{ op: 'add', kind: 'raised-bed', near: 'garden', plants: [id] }], why: ['Perennial vegetable: plant once, harvest for years.'] });
    }
  }
  if ((site.freezeFreeDays ?? 999) < 150 && !site.frostRare) {
    items.push({ id: 'tunnel', phase: 'years2to5', category: 'infrastructure', title: 'High tunnel for season extension', detail: 'Example size 20 × 48 ft.', budget: [{ kind: 'high-tunnel', areaSqFt: 960 }], draft: [{ op: 'add', kind: 'high-tunnel', near: 'sunny' }], optional: true, why: [`About ${site.freezeFreeDays} frost-free days here: a tunnel adds weeks at both ends.`] });
  }

  // --- Coverage of everything planned (all phases, mature) ---
  // The garden counts once, at its full size: year 2's expanded garden replaces year 1's when there is one.
  const hasExpansion = items.some((j) => j.id === 'garden-y2');
  const planned: PlannedFood = {
    crops: items.filter((i) => i.crops && !(hasExpansion && i.id === 'garden-y1')).flatMap((i) => i.crops ?? []),
    livestock: items.filter((i) => i.livestock).map((i) => i.livestock!),
  };
  const coverage = estimateFoodCoverage(members, planned, kb);
  // What years 0–1 produce (the year-1 garden and year-1 animals only; trees bear years later).
  const coverageYear1 = estimateFoodCoverage(members, {
    crops: items.filter((i) => i.phase === 'year1' && i.crops).flatMap((i) => i.crops ?? []),
    livestock: items.filter((i) => i.phase === 'year1' && i.livestock).map((i) => i.livestock!),
  }, kb);

  // --- Storage (year 1 harvest; the orchard adds more once it bears) ---
  if (coverageYear1.storage.length && goals.willPreserve !== false) {
    items.push({
      id: 'storage', phase: 'year1', category: 'storage', title: 'Plan for storing the harvest',
      detail: coverageYear1.storage.map((s) => `${s.method.replace('-', ' ')}: ${Math.round(s.lb[0])}–${Math.round(s.lb[1])} lb (${s.crops.join(', ')})`).join('; '),
      budget: goals.willPreserve ? [{ kind: 'chest-freezer' }] : undefined,
      why: [String(kb.homestead.preservation.safetyNote)],
    });
  }

  // --- Income (Homestead Pro) ---
  let enterprises: EnterpriseFit[] | undefined;
  if (opts.includeIncome && goals.wantsIncome) {
    enterprises = compareEnterprises(goals, site.parcelAcres, kb);
    for (const e of enterprises.filter((x) => x.fit === 'good').slice(0, 3)) {
      const scale = String(kb.homestead.enterprises[e.id]?.scale ?? '');
      items.push({ id: `inc-${e.id}`, phase: 'years2to5', category: 'income', title: `Consider: ${e.name}`, detail: `${e.revenue}${scale ? ` (at the studied scale: ${scale})` : ''}`, why: [...e.reasons, INCOME_DISCLAIMER], regulatory: e.regulatory });
    }
  }

  // --- Budgets and labour per phase ---
  const phases: PhaseId[] = ['year0', 'year1', 'years2to5'];
  const budgetByPhase = Object.fromEntries(phases.map((ph) => [ph, estimateBudget(items.filter((i) => i.phase === ph && !i.optional).flatMap((i) => i.budget ?? []), kb)])) as Record<PhaseId, Budget>;
  const budget = estimateBudget(items.filter((i) => !i.optional).flatMap((i) => i.budget ?? []), kb);
  const laborByPhase = Object.fromEntries(phases.map((ph) => {
    // Livestock chores carry on into later phases.
    const upto = phases.slice(0, phases.indexOf(ph) + 1);
    const l = items.filter((i) => upto.includes(i.phase) && i.laborHoursPerWeek).reduce<[number, number]>((a, i) => [a[0] + i.laborHoursPerWeek![0], a[1] + i.laborHoursPerWeek![1]], [0, 0]);
    return [ph, [Math.round(l[0] * 10) / 10, Math.round(l[1] * 10) / 10]];
  })) as Record<PhaseId, [number, number]>;

  const startNow = budgetByPhase.year0.startupTotal[0] + budgetByPhase.year1.startupTotal[0];
  if (goals.budgetStartupUsd !== undefined && startNow > goals.budgetStartupUsd) {
    warnings.push(opts.showCosts === false
      ? 'Setting up everything in years 0–1 likely costs more than your budget. Start with the garden and hens, and build the rest as money allows.'
      : `Years 0–1 cost at least ${moneyRange([startNow, startNow])} (sourced items only) vs your ${moneyRange([goals.budgetStartupUsd, goals.budgetStartupUsd])} budget. Start with the garden and hens, and build the rest as money allows.`);
  }
  if (goals.hoursPerWeek !== undefined && laborByPhase.year1[0] > goals.hoursPerWeek) {
    warnings.push(`Animal chores alone take about ${rng(laborByPhase.year1)} h/week in year 1, more than the ${goals.hoursPerWeek} h you have, before any gardening.`);
  }
  assumptions.push('Garden work isn’t estimated in hours: there’s no reliable published figure for home gardens. Livestock chore times come from extension budgets.');
  if (budget.unknown.length) assumptions.push(`No sourced cost for: ${budget.unknown.join(', ')}.`);

  return {
    createdAt: (opts.now ?? new Date()).toISOString(), goalsSummary: summarizeGoals(goals), items, coverage, coverageYear1, budget, budgetByPhase, laborByPhase, enterprises,
    warnings, assumptions,
    dataUsed: [...(site.sources ?? []), ...coverage.sources, 'Livestock, infrastructure and enterprise figures: extension and USDA sources cited in each item'],
  };
}
