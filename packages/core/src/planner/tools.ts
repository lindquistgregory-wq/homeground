/**
 * The planner's local tools (§9.2). Every fact the on-device model states must come from one of these.
 * Arguments are flat (strings, numbers, enums) because ~3B-parameter models fill flat arguments far more
 * reliably than nested objects; lists are comma-separated ("tomato:32, potato:64").
 * Results are short plain text with their sources, sized for a 4,096-token context.
 */
import { plantById, searchPlants } from '../plants/index';
import { estimateBudget, moneyRange, type BudgetItem } from './budget';
import { estimateFoodCoverage, pct } from './coverage';
import { validateDesignDraft, validateTasks, type DesignDraft, type DraftObject, type TaskDraft } from './drafts';
import { compareEnterprises, INCOME_DISCLAIMER, lookupEnterprise } from './enterprises';
import { FOOD_TARGETS, mergeGoals, summarizeGoals, type HomesteadGoals, type HouseholdMember } from './goals';
import type { KnowledgeBase } from './kb';
import { NUTRIENT_KEYS, NUTRIENT_LABEL, cropHarvestLb, type CropAmount } from './nutrition';
import { PHASE_TITLE, buildPlan, rng, type SitePlanInput } from './plan';

export interface JsonProp {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description: string;
  enum?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, JsonProp>; required: string[] };
}

export interface SiteFacts {
  /** Short lines like "Hardiness zone 6a (USDA PHZM 2023, high confidence)". */
  lines: string[];
  missing: string[];
}

export interface DesignSummary {
  objects: Array<{ id: string; kind: string; label: string; areaSqFt: number }>;
}

export interface SuitabilityRow {
  plantId: string;
  name: string;
  score: number;
  verdict: string;
  summary: string;
}

/** What the app provides to the tools (all local: SQLite, the site profile, the shade model). */
export interface PlannerContext {
  kb: KnowledgeBase;
  goals(): HomesteadGoals;
  saveGoals(g: HomesteadGoals): Promise<void>;
  siteFacts(): Promise<SiteFacts | null>;
  sitePlanInput(): Promise<SitePlanInput>;
  design(): Promise<DesignSummary>;
  suitability(plantIds: string[] | null, bedId?: string): Promise<SuitabilityRow[]>;
  sensorSummary(): Promise<string | null>;
  /** Stores a validated draft for the user to approve. Returns its id. */
  saveDesignDraft(d: DesignDraft): Promise<string>;
  saveTaskDrafts(t: TaskDraft[]): Promise<number>;
  tier: { full: boolean; income: boolean; multiYear: boolean };
  newId(): string;
  now(): Date;
}

export interface Tool extends ToolSpec {
  run(ctx: PlannerContext, args: Record<string, unknown>): Promise<string>;
}

const MAX_RESULT_CHARS = 1400;
const clip = (s: string) => (s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS - 20)}… (shortened)` : s);
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const numArg = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(str(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const list = (v: unknown) => str(v).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

/** "tomato:32, potato:64" or "tomato 32" → crop amounts (sq ft); plant names are matched loosely. */
export function parseCropList(v: unknown): { crops: CropAmount[]; unknown: string[] } {
  const crops: CropAmount[] = [];
  const unknown: string[] = [];
  for (const part of list(v)) {
    const m = /^(.+?)[\s:=]+(\d+(?:\.\d+)?)\s*(sq ?ft|ft|plants?|trees?)?$/i.exec(part);
    const name = (m ? m[1]! : part).trim();
    const p = plantById(name.toLowerCase().replace(/\s+/g, '-')) ?? searchPlants(name)[0];
    if (!p) { unknown.push(name); continue; }
    const n = m ? Number(m[2]) : 32;
    const unit = (m?.[3] ?? '').toLowerCase();
    crops.push(/plant|tree/.test(unit) || (!unit && p.yieldLb?.per === 'plant') ? { plantId: p.id, plants: n } : unit === 'ft' ? { plantId: p.id, rowFt: n } : { plantId: p.id, areaSqFt: n });
  }
  return { crops, unknown };
}

/** "laying_hens:10, bees 2" → livestock counts, matched against the knowledge base ids. */
export function parseAnimalList(v: unknown, kb: KnowledgeBase): { animals: Array<{ species: string; count: number }>; unknown: string[] } {
  const ids = Object.keys(kb.homestead.livestock);
  const alias: Record<string, string> = { hens: 'laying_hens', chickens: 'laying_hens', layers: 'laying_hens', broilers: 'meat_chickens', 'meat birds': 'meat_chickens', bees: 'honeybees', hives: 'honeybees', rabbits: 'meat_rabbits', pigs: 'feeder_pigs', goats: 'dairy_goats', ducks: 'ducks_layers' };
  const animals: Array<{ species: string; count: number }> = [];
  const unknown: string[] = [];
  for (const part of list(v)) {
    let name = part, count = 1;
    let m = /^(.+?)[\s:=x×]+(\d+)$/i.exec(part);
    if (m) (name = m[1]!), (count = Number(m[2]));
    else if ((m = /^(\d+)\s*[x×]?\s*(.+)$/i.exec(part))) (count = Number(m[1])), (name = m[2]!);
    name = name.trim().toLowerCase();
    const id = ids.find((i) => i === name.replace(/\s+/g, '_')) ?? alias[name] ?? ids.find((i) => i.includes(name.replace(/s$/, '').replace(/\s+/g, '_')));
    if (id && count > 0) animals.push({ species: id, count });
    else unknown.push(name);
  }
  return { animals, unknown };
}

/** "40m, 38f, 9f" (age + sex, optional a/s for active/sedentary) → household members. */
export function parseHousehold(v: unknown): HouseholdMember[] {
  const out: HouseholdMember[] = [];
  for (const part of list(v)) {
    const m = /^(\d{1,3})\s*(m|f|male|female|man|woman|boy|girl)?\s*(active|sedentary|a|s)?$/i.exec(part.replace(/\s+/g, ' ').trim());
    if (!m) continue;
    const sexWord = (m[2] ?? '').toLowerCase();
    const sex = /^(f|female|woman|girl)$/.test(sexWord) ? 'female' : 'male';
    const act = (m[3] ?? '').toLowerCase();
    out.push({ age: Number(m[1]), sex, activity: act.startsWith('a') ? 'active' : act.startsWith('s') ? 'sedentary' : 'moderatelyActive' });
  }
  return out;
}

const E = (values: string[]) => values;

export const TOOLS: Tool[] = [
  {
    name: 'update_goals',
    description: 'Save what you learned about the household. Call it whenever the user tells you something. Use only fields the user stated.',
    parameters: {
      type: 'object', required: [], properties: {
        household: { type: 'string', description: 'Ages and sex, comma-separated, e.g. "40m, 38f, 9f"' },
        diet: { type: 'string', description: 'Comma list from: vegetarian, vegan, no-pork, no-dairy, no-eggs' },
        ambition: { type: 'string', description: 'How much food to grow', enum: E(Object.keys(FOOD_TARGETS)) },
        hoursPerWeek: { type: 'number', description: 'Hours per week available in season' },
        budgetStartupUsd: { type: 'number', description: 'Startup budget in US dollars' },
        gardenSpaceSqFt: { type: 'number', description: 'Space for vegetables in square feet' },
        experience: { type: 'string', description: 'Growing experience', enum: E(['none', 'some-gardening', 'experienced', 'livestock']) },
        physical: { type: 'string', description: 'Physical limits', enum: E(['none', 'some', 'significant']) },
        animals: { type: 'string', description: 'Are animals allowed', enum: E(['yes', 'poultry-only', 'no', 'unsure']) },
        animalInterest: { type: 'string', description: 'Comma list, e.g. "laying_hens, honeybees"' },
        water: { type: 'string', description: 'Garden water source', enum: E(['municipal', 'well', 'rain-only', 'none', 'unsure']) },
        willPreserve: { type: 'boolean', description: 'Will can, freeze or dry food' },
        wantsIncome: { type: 'boolean', description: 'Wants the homestead to earn money' },
        marketAccess: { type: 'string', description: 'Access to buyers', enum: E(['none', 'some', 'strong']) },
        goals: { type: 'string', description: 'Comma list from: food, savings, income, lifestyle, ecology, resilience' },
        confirmed: { type: 'boolean', description: 'True only when the user confirmed your summary' },
      },
    },
    async run(ctx, a) {
      const patch: Partial<HomesteadGoals> = {};
      if (a.household !== undefined) { const h = parseHousehold(a.household); if (h.length) patch.household = h; }
      const pick = <T extends string>(v: unknown, allowed: readonly T[]) => (allowed.includes(str(v) as T) ? (str(v) as T) : undefined);
      if (a.diet !== undefined) patch.diet = list(a.diet).filter((d) => ['vegetarian', 'vegan', 'no-pork', 'no-dairy', 'no-eggs'].includes(d)) as HomesteadGoals['diet'];
      patch.ambition = pick(a.ambition, Object.keys(FOOD_TARGETS) as Array<keyof typeof FOOD_TARGETS>);
      patch.hoursPerWeek = numArg(a.hoursPerWeek);
      patch.budgetStartupUsd = numArg(a.budgetStartupUsd);
      patch.gardenSpaceSqFt = numArg(a.gardenSpaceSqFt);
      patch.experience = pick(a.experience, ['none', 'some-gardening', 'experienced', 'livestock'] as const);
      patch.physical = pick(a.physical, ['none', 'some', 'significant'] as const);
      patch.animals = pick(a.animals, ['yes', 'poultry-only', 'no', 'unsure'] as const);
      if (a.animalInterest !== undefined) patch.animalInterest = parseAnimalList(a.animalInterest, ctx.kb).animals.map((x) => x.species);
      patch.water = pick(a.water, ['municipal', 'well', 'rain-only', 'none', 'unsure'] as const);
      if (typeof a.willPreserve === 'boolean') patch.willPreserve = a.willPreserve;
      if (typeof a.wantsIncome === 'boolean') patch.wantsIncome = a.wantsIncome;
      patch.marketAccess = pick(a.marketAccess, ['none', 'some', 'strong'] as const);
      if (a.goals !== undefined) patch.goals = list(a.goals).filter((g) => ['food', 'savings', 'income', 'lifestyle', 'ecology', 'resilience'].includes(g)) as HomesteadGoals['goals'];
      let next = mergeGoals(ctx.goals(), patch);
      if (a.confirmed === true) next = { ...next, confirmedAt: ctx.now().toISOString() };
      await ctx.saveGoals(next);
      return `Saved. Profile now: ${summarizeGoals(next)}`;
    },
  },
  {
    name: 'get_site_profile',
    description: 'Facts about the parcel: size, hardiness zone, frost dates, soils, sun, flood risk, water. Includes sources and confidence.',
    parameters: { type: 'object', required: [], properties: {} },
    async run(ctx) {
      const f = await ctx.siteFacts();
      if (!f) return 'No site profile yet. Ask the user to open the property and build its site profile.';
      return clip([...f.lines, ...(f.missing.length ? [`Not available: ${f.missing.join(', ')}.`] : [])].join('\n'));
    },
  },
  {
    name: 'get_design',
    description: 'What is already placed on the property map (beds, buildings, trees, coops), with ids and sizes.',
    parameters: { type: 'object', required: [], properties: {} },
    async run(ctx) {
      const d = await ctx.design();
      if (!d.objects.length) return 'The design is empty.';
      return clip(d.objects.map((o) => `${o.id}: ${o.label} (${o.kind}, ${Math.round(o.areaSqFt)} sq ft)`).join('\n'));
    },
  },
  {
    name: 'get_plant_suitability',
    description: 'How well plants fit this parcel (0-100 with reasons). Give plant names, or leave empty for the best matches.',
    parameters: { type: 'object', required: [], properties: { plants: { type: 'string', description: 'Comma-separated plant names, or empty' }, bedId: { type: 'string', description: 'Optional bed id from get_design' } } },
    async run(ctx, a) {
      const names = list(a.plants);
      const ids = names.length ? names.map((n) => (plantById(n.toLowerCase().replace(/\s+/g, '-')) ?? searchPlants(n)[0])?.id).filter((x): x is string => !!x) : null;
      const rows = await ctx.suitability(ids, str(a.bedId) || undefined);
      if (!rows.length) return names.length ? `No plants matched: ${names.join(', ')}.` : 'No suitability data yet (the site profile may be missing).';
      return clip(rows.slice(0, 12).map((r) => `${r.name}: ${r.score}/100 (${r.verdict}). ${r.summary}`).join('\n'));
    },
  },
  {
    name: 'get_sensor_summary',
    description: 'Recent readings from the property’s sensors (soil temperature, frost at the low spot, rain, watering need).',
    parameters: { type: 'object', required: [], properties: {} },
    async run(ctx) {
      return (await ctx.sensorSummary()) ?? 'No sensors on this property.';
    },
  },
  {
    name: 'estimate_yield',
    description: 'Typical yearly harvest for crops and animals. crops: "tomato:32, potato:64" (sq ft; "apple:2 trees"). animals: "laying_hens:10".',
    parameters: { type: 'object', required: [], properties: { crops: { type: 'string', description: 'Crop list with square feet' }, animals: { type: 'string', description: 'Animal list with counts' } } },
    async run(ctx, a) {
      const { crops, unknown } = parseCropList(a.crops);
      const { animals, unknown: ua } = parseAnimalList(a.animals, ctx.kb);
      const lines: string[] = [];
      for (const c of crops) {
        const p = plantById(c.plantId)!;
        const lb = cropHarvestLb(p, c);
        lines.push(lb ? `${p.commonName} (${c.areaSqFt ? `${c.areaSqFt} sq ft` : c.plants ? `${c.plants} plants` : `${c.rowFt} ft row`}): ${rng([Math.round(lb[0]), Math.round(lb[1])])} lb a year` : `${p.commonName}: no yield figure in the plant database.`);
      }
      if (animals.length) {
        const cov = estimateFoodCoverage([{ age: 40, sex: 'female', activity: 'moderatelyActive' }], { crops: [], livestock: animals }, ctx.kb);
        for (const c of cov.contributions) lines.push(`${c.label}: ${rng([Math.round(c.amountLb[0]), Math.round(c.amountLb[1])])} lb of food a year (${c.notes.join('; ')})`);
        for (const n of cov.notCounted) lines.push(`${n.id}: ${n.reason}`);
      }
      if (unknown.length || ua.length) lines.push(`Not recognised: ${[...unknown, ...ua].join(', ')}.`);
      lines.push('Source: plant database home-garden ranges; extension livestock figures; USDA edible portions.');
      return clip(lines.join('\n'));
    },
  },
  {
    name: 'estimate_food_coverage',
    description: 'Share of the household’s yearly calories and nutrients the crops and animals would provide. Leave both empty to use the current plan.',
    parameters: { type: 'object', required: [], properties: { crops: { type: 'string', description: 'Crop list with square feet, or empty' }, animals: { type: 'string', description: 'Animal list with counts, or empty' } } },
    async run(ctx, a) {
      const g = ctx.goals();
      if (!g.household?.length) return 'Household not known yet: ask who lives there first.';
      let crops = parseCropList(a.crops).crops, animals = parseAnimalList(a.animals, ctx.kb).animals;
      if (!crops.length && !animals.length) {
        const plan = buildPlan(g, await ctx.sitePlanInput(), ctx.kb, { now: ctx.now() });
        crops = plan.items.flatMap((i) => (i.id === 'garden-y1' && plan.items.some((j) => j.id === 'garden-y2') ? [] : i.crops ?? []));
        animals = plan.items.filter((i) => i.livestock).map((i) => i.livestock!);
      }
      const r = estimateFoodCoverage(g.household, { crops, livestock: animals }, ctx.kb);
      const lines = NUTRIENT_KEYS.map((k) => `${NUTRIENT_LABEL[k]}: ${pct(r.share[k][0])}–${pct(r.share[k][1])} of yearly needs`);
      if (r.gaps.length) lines.push(`Biggest gaps: ${r.gaps.join('; ')}.`);
      if (r.notCounted.length) lines.push(`Not counted: ${r.notCounted.map((n) => n.reason).join('; ')}.`);
      if (r.storage.length) lines.push(`To store: ${r.storage.map((s) => `${Math.round(s.lb[0])}–${Math.round(s.lb[1])} lb for ${s.method.replace('-', ' ')}`).join(', ')}.`);
      lines.push(`Sources: ${r.sources.join('; ')}.`);
      return clip(lines.join('\n'));
    },
  },
  {
    name: 'estimate_budget',
    description: 'Startup and yearly costs as sourced ranges. items: comma list like "drip 1000 sqft, deer fence 200 ft, coop, rain 500 gal, raised beds 4, laying_hens 10".',
    parameters: { type: 'object', required: ['items'], properties: { items: { type: 'string', description: 'What to price' } } },
    async run(ctx, a) {
      if (!ctx.tier.multiYear) return 'Detailed budgets are part of Homestead Pro. Give the user the plan without cost figures.';
      const items: BudgetItem[] = [];
      const unknown: string[] = [];
      for (const part of list(a.items)) {
        const n = numArg(/(\d[\d,.]*)/.exec(part)?.[1]) ?? 0;
        const t = part.toLowerCase();
        if (/drip/.test(t)) items.push({ kind: 'drip', areaSqFt: n || 1000 });
        else if (/deer/.test(t)) items.push({ kind: 'deer-fence', lengthFt: n || 200 });
        else if (/fence/.test(t)) items.push({ kind: 'livestock-fence', lengthFt: n || 400 });
        else if (/tunnel/.test(t)) items.push({ kind: 'high-tunnel', areaSqFt: n || 960 });
        else if (/coop/.test(t)) items.push({ kind: 'coop' });
        else if (/rain|catch/.test(t)) items.push({ kind: 'rain-catchment', gallons: n || 500 });
        else if (/cellar/.test(t)) items.push({ kind: 'root-cellar' });
        else if (/well/.test(t)) items.push({ kind: 'well' });
        else if (/freezer/.test(t)) items.push({ kind: 'chest-freezer' });
        else if (/bed/.test(t)) items.push({ kind: 'raised-beds', count: n || 1 });
        else {
          const an = parseAnimalList(part, ctx.kb).animals[0];
          if (an) items.push({ kind: 'livestock', species: an.species, count: an.count });
          else unknown.push(part);
        }
      }
      const b = estimateBudget(items, ctx.kb);
      const lines = b.lines.map((l) => `${l.label}: ${l.startup ? `start ${moneyRange(l.startup)}` : ''}${l.annual ? `${l.startup ? ', ' : ''}yearly ${moneyRange(l.annual)}` : ''}${l.caution ? ` (${l.caution})` : ''}`);
      lines.push(`Total start ${moneyRange(b.startupTotal)}; yearly ${moneyRange(b.annualTotal)}.`);
      if (b.unknown.length || unknown.length) lines.push(`No sourced cost for: ${[...b.unknown, ...unknown].join(', ')}.`);
      lines.push('Sources: extension budgets and cost guides cited in the app; rough ranges.');
      return clip(lines.join('\n'));
    },
  },
  {
    name: 'lookup_enterprise_profile',
    description: 'Facts about a small farm business (eggs, market garden, microgreens, cut flowers, honey, mushrooms, cottage food, agritourism, meat birds, nursery). Leave name empty to compare all for this household.',
    parameters: { type: 'object', required: [], properties: { name: { type: 'string', description: 'Business type, or empty to compare' } } },
    async run(ctx, a) {
      if (!ctx.tier.income) return 'The income module is part of Homestead Pro.';
      const name = str(a.name);
      if (!name) {
        const site = await ctx.sitePlanInput();
        const fits = compareEnterprises(ctx.goals(), site.parcelAcres, ctx.kb);
        return clip([...fits.slice(0, 6).map((f) => `${f.name}: ${f.fit} fit. ${f.reasons.join(' ')}`), INCOME_DISCLAIMER].join('\n'));
      }
      const e = lookupEnterprise(name, ctx.kb);
      if (!e) return `No profile for “${name}”.`;
      const p = e.profile;
      const r = (k: string) => (Array.isArray(p[k]) ? `$${(p[k] as number[]).map((x) => Math.round(x).toLocaleString('en-US')).join('–$')}` : null);
      return clip([
        `${e.id.replace(/_/g, ' ')} (${p.scale})`,
        p.startupCostUSD ? `Startup: ${r('startupCostUSD')}` : 'Startup: not in sources',
        p.weeklyLaborHours ? `Labour: ${rng(p.weeklyLaborHours)} h/week in season` : 'Labour: not in sources',
        ...['grossRevenueUSD', 'grossRevenueUSDPerAcre', 'grossRevenueUSDPerYear', 'netIncomeUSD', 'netIncomeUSDPerYear'].filter((k) => p[k]).map((k) => `${k.replace('USD', '').replace(/([A-Z])/g, ' $1').toLowerCase()}: ${r(k)}`),
        `Season: ${p.seasonality}`, `Rules to check: ${p.regulatory.join(' ')}`, `Risks: ${p.risks.join(', ')}`,
        `Sources: ${p.sources.map((s) => `${s.title} (${s.year ?? 'undated'})`).join('; ')}`, INCOME_DISCLAIMER,
      ].join('\n'));
    },
  },
  {
    name: 'make_plan',
    description: 'Build the phased homestead plan from the saved profile and the parcel (garden, animals, perennials, setup). Use it before recommending.',
    parameters: { type: 'object', required: [], properties: {} },
    async run(ctx) {
      const g = ctx.goals();
      const plan = buildPlan(g, await ctx.sitePlanInput(), ctx.kb, { now: ctx.now(), includeIncome: ctx.tier.income });
      const phases = ctx.tier.multiYear ? (['year0', 'year1', 'years2to5'] as const) : (['year0', 'year1'] as const);
      const lines: string[] = [];
      for (const ph of phases) {
        const its = plan.items.filter((i) => i.phase === ph);
        if (its.length) lines.push(`${PHASE_TITLE[ph]}: ${its.map((i) => i.title).join('; ')}.`);
      }
      lines.push(`Food: calories ${pct(plan.coverage.share.kcal[0])}–${pct(plan.coverage.share.kcal[1])}, vitamin C ${pct(plan.coverage.share.vitCMg[0])}–${pct(plan.coverage.share.vitCMg[1])} of needs.`);
      if (ctx.tier.multiYear) lines.push(`Startup ${moneyRange(plan.budget.startupTotal)} for priced items.`);
      lines.push(...plan.warnings.slice(0, 3));
      lines.push('The full plan is on the Plan tab.');
      return clip(lines.join('\n'));
    },
  },
  {
    name: 'propose_design_changes',
    description: 'Propose adding objects to the property map, as a draft the user must approve. kind: raised-bed, in-ground-row, chicken-coop, chicken-run, beehive, fruit-tree-semi, berry-row, compost-bays, rain-barrel, high-tunnel, etc.',
    parameters: {
      type: 'object', required: ['kind', 'summary'], properties: {
        kind: { type: 'string', description: 'Object type' },
        count: { type: 'integer', description: 'How many' },
        near: { type: 'string', description: 'Where', enum: E(['garden', 'house', 'sunny', 'edge', 'anywhere']) },
        plants: { type: 'string', description: 'Optional comma list of plants for beds' },
        summary: { type: 'string', description: 'One sentence explaining the change' },
      },
    },
    async run(ctx, a) {
      if (!ctx.tier.full) return 'Design drafts from the planner are part of Grower and Homestead Pro. Describe the idea instead.';
      const change: DraftObject = { op: 'add', kind: str(a.kind), count: numArg(a.count), near: (['garden', 'house', 'sunny', 'edge', 'anywhere'].includes(str(a.near)) ? str(a.near) : 'anywhere') as DraftObject['near'], plants: parseCropList(a.plants).crops.map((c) => c.plantId) };
      const d: DesignDraft = { id: ctx.newId(), summary: str(a.summary).slice(0, 200) || `Add ${change.kind}`, changes: [change], why: [], createdBy: 'model' };
      const design = await ctx.design();
      const v = validateDesignDraft(d, design.objects);
      if (!v.ok) return `Draft not saved: ${v.problems.join(' ')}`;
      const id = await ctx.saveDesignDraft(v.cleaned);
      return `Draft ${id} saved. The user must approve it on the Drafts tab before anything changes.`;
    },
  },
  {
    name: 'create_tasks',
    description: 'Propose to-do items as drafts. tasks: one per line as "title | month or YYYY-MM-DD | category" (category: build, plant, animals, buy, learn, admin).',
    parameters: { type: 'object', required: ['tasks'], properties: { tasks: { type: 'string', description: 'Tasks, one per line' } } },
    async run(ctx, a) {
      const raw = str(a.tasks).split(/\n|;/).map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]);
      const { tasks, problems } = validateTasks(raw.map(([title, due, category]) => ({ title: title!, due, category: (category ?? 'admin') as TaskDraft['category'] })));
      if (!tasks.length) return `No tasks saved. ${problems.join(' ')}`;
      const n = await ctx.saveTaskDrafts(tasks);
      return `${n} task draft${n === 1 ? '' : 's'} saved for the user to approve.`;
    },
  },
];

export const toolSpecs = (tools: Tool[] = TOOLS): ToolSpec[] => tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
export const findTool = (name: string) => TOOLS.find((t) => t.name === name);
