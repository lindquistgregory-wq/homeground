/** The planner's tools and model orchestration, with scripted stand-ins for the on-device models. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANNER_INSTRUCTIONS, PLANTS, TOOLS, approxTokens, extractJson, parseAnimalList, parseCropList, parseHousehold, plannerTurn, scorePlant, toolsForTurn, unverifiedNumbers,
  type DesignDraft, type HomesteadGoals, type NativeToolModel, type PlannerContext, type TaskDraft, type TextModel,
} from '@plotwright/core';
import { KNOWLEDGE_BASE as KB } from '@plotwright/data';

function fakeContext(goals: HomesteadGoals = {}, tier = { full: true, income: true, multiYear: true }) {
  let g = goals;
  const drafts: DesignDraft[] = [];
  const tasks: TaskDraft[] = [];
  const suit = Object.fromEntries(PLANTS.map((p) => [p.id, scorePlant(p, { zone: '6a', chillHours: 1200, peakSummerMaxF: 84 }, {}).score]));
  let n = 0;
  const ctx: PlannerContext = {
    kb: KB, tier,
    goals: () => g, saveGoals: async (x) => { g = x; },
    siteFacts: async () => ({ lines: ['Parcel 2.5 acres (county GIS).', 'Hardiness zone 6a (USDA PHZM 2023, high confidence).'], missing: ['soils'] }),
    sitePlanInput: async () => ({ parcelAcres: 2.5, zone: '6a', freezeFreeDays: 160, suitability: suit }),
    design: async () => ({ objects: [{ id: 'bed-1', kind: 'raised-bed', label: 'Bed 1', areaSqFt: 32 }] }),
    suitability: async (ids) => (ids ?? ['tomato', 'kale']).map((id) => ({ plantId: id, name: id, score: suit[id] ?? 0, verdict: 'good', summary: 'ok' })),
    sensorSummary: async () => null,
    saveDesignDraft: async (d) => { drafts.push(d); return d.id; },
    saveTaskDrafts: async (t) => { tasks.push(...t); return t.length; },
    newId: () => `id${++n}`, now: () => new Date('2026-09-29T12:00:00Z'),
  };
  return { ctx, drafts, tasks, goals: () => g };
}

test('argument parsers read the flat formats small models produce', () => {
  assert.deepEqual(parseHousehold('40m, 38 F, 9f active, 70 male sedentary').map((m) => [m.age, m.sex, m.activity]), [[40, 'male', 'moderatelyActive'], [38, 'female', 'moderatelyActive'], [9, 'female', 'active'], [70, 'male', 'sedentary']]);
  const c = parseCropList('tomato:32, Potato 64, apple:2 trees, garlic, unicornfruit:10');
  assert.deepEqual(c.crops.map((x) => x.plantId), ['tomato', 'potato', 'apple', 'garlic']);
  assert.equal(c.crops[2]!.plants, 2);
  assert.deepEqual(c.unknown, ['unicornfruit']);
  const a = parseAnimalList('hens:10, 2 bees, goats x2, dragons 1', KB);
  assert.deepEqual(a.animals, [{ species: 'laying_hens', count: 10 }, { species: 'honeybees', count: 2 }, { species: 'dairy_goats', count: 2 }]);
  assert.deepEqual(a.unknown, ['dragons']);
  assert.deepEqual(extractJson('Sure!\n```json\n{"tool": "make_plan", "args": {"a": "}"}}\n```'), { tool: 'make_plan', args: { a: '}' } });
  assert.equal(extractJson('no json here'), null);
});

test('prompts fit a 4,096-token context with room to spare', () => {
  const { ctx } = fakeContext({ household: parseHousehold('40m,38f,9f'), ambition: 'most-veg', hoursPerWeek: 8, budgetStartupUsd: 2000, gardenSpaceSqFt: 500 });
  const tools = toolsForTurn('what should I grow, what would it cost, can I sell eggs, add beds to the map, and make me a to-do list', ctx);
  assert.ok(tools.length <= 6);
  const specs = JSON.stringify(tools.map(({ name, description, parameters }) => ({ name, description, parameters })));
  assert.ok(approxTokens(PLANNER_INSTRUCTIONS + specs) < 1800, `instructions + tools ≈ ${approxTokens(PLANNER_INSTRUCTIONS + specs)} tokens`);
  // Tier gates remove tools rather than relying on the model to behave.
  const free = fakeContext({}, { full: false, income: false, multiYear: false });
  const names = toolsForTurn('add beds, cost, sell eggs, to-do', free.ctx).map((t) => t.name);
  for (const gated of ['propose_design_changes', 'create_tasks', 'lookup_enterprise_profile', 'estimate_budget']) assert.ok(!names.includes(gated), gated);
});

test('text-only model (JSON protocol): saves goals through a tool, then answers', async () => {
  const f = fakeContext();
  const script = ['{"tool":"update_goals","args":{"household":"40m, 38f","hoursPerWeek":6}}', 'Thanks! {"say":"Got it: two adults with about 6 hours a week. How much space could go to vegetables?"}'];
  const model: TextModel = { kind: 'text', name: 'fake-nano', generate: async () => script.shift() ?? '{"say":"done"}' };
  const r = await plannerTurn(model, f.ctx, [], 'We are two adults, about 6 hours a week.');
  assert.equal(f.goals().household?.length, 2);
  assert.equal(f.goals().hoursPerWeek, 6);
  assert.match(r.reply, /6 hours/);
  assert.deepEqual(r.unverifiedNumbers, []);
  assert.equal(r.toolCalls[0]!.name, 'update_goals');
});

test('native tool model: numbers from tools pass, invented numbers are flagged', async () => {
  const f = fakeContext({ household: parseHousehold('40m,38f'), ambition: 'most-veg', hoursPerWeek: 8, budgetStartupUsd: 2000, gardenSpaceSqFt: 500, confirmedAt: 'x' });
  let toolText = '';
  const honest: NativeToolModel = { kind: 'native-tools', name: 'fake-fm', respond: async ({ callTool, tools }) => {
    assert.ok(tools.some((t) => t.name === 'estimate_yield'));
    toolText = await callTool('estimate_yield', JSON.stringify({ crops: 'tomato:32' }));
    const lb = /(\d+)–(\d+) lb/.exec(toolText)!;
    return `A 32 sq ft tomato bed gives about ${lb[1]}–${lb[2]} lb a year.`;
  } };
  const ok = await plannerTurn(honest, f.ctx, [], 'How much would a tomato bed yield?');
  assert.deepEqual(ok.unverifiedNumbers, []);
  const liar: NativeToolModel = { kind: 'native-tools', name: 'fake-fm', respond: async () => 'You will harvest 5,000 lb of tomatoes worth $12,000.' };
  const bad = await plannerTurn(liar, f.ctx, [], 'How much would a tomato bed yield?');
  assert.deepEqual(bad.unverifiedNumbers, ['5,000', '$12,000']);
  assert.match(bad.reply, /unverified/);
});

test('safety questions never reach the model', async () => {
  const f = fakeContext();
  const model: TextModel = { kind: 'text', name: 'x', generate: async () => { throw new Error('model must not be called'); } };
  const r = await plannerTurn(model, f.ctx, [], 'my goat is bloated and not eating, what dose of medicine?');
  assert.equal(r.safety, 'veterinary');
  assert.match(r.reply, /vet/);
});

test('tools: drafts are validated and stored for approval; gated tools refuse on lower tiers', async () => {
  const f = fakeContext({ household: parseHousehold('40m') });
  const prop = TOOLS.find((t) => t.name === 'propose_design_changes')!;
  assert.match(await prop.run(f.ctx, { kind: 'moat', summary: 'x' }), /not saved/);
  assert.match(await prop.run(f.ctx, { kind: 'chicken-coop', near: 'house', summary: 'Coop by the house' }), /approve/);
  assert.equal(f.drafts.length, 1);
  const tasks = TOOLS.find((t) => t.name === 'create_tasks')!;
  assert.match(await tasks.run(f.ctx, { tasks: 'Build coop | March | build\nOrder chicks | 2027-03-01 | animals' }), /2 task drafts/);
  const free = fakeContext({}, { full: false, income: false, multiYear: false });
  assert.match(await TOOLS.find((t) => t.name === 'estimate_budget')!.run(free.ctx, { items: 'coop' }), /Homestead Pro/);
  assert.match(await TOOLS.find((t) => t.name === 'lookup_enterprise_profile')!.run(free.ctx, { name: 'eggs' }), /Homestead Pro/);
  const cov = await TOOLS.find((t) => t.name === 'estimate_food_coverage')!.run(f.ctx, { crops: 'potato:100', animals: 'hens:6' });
  assert.match(cov, /Calories: \d+%–\d+%/);
  assert.match(await TOOLS.find((t) => t.name === 'lookup_enterprise_profile')!.run(f.ctx, { name: 'u-pick' }), /agritourism[\s\S]*not financial/);
});

test('unverified-number check ignores small counts and years', () => {
  assert.deepEqual(unverifiedNumbers('Ask 3 questions. In 2027 plant 10 trees.', []), []);
  assert.deepEqual(unverifiedNumbers('Costs $735–$1,950.', ['$735–$1,950 (UMD)']), []);
});
