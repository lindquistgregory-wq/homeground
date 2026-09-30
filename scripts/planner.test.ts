/** The rules-based planner and its calculators, run against the real bundled knowledge base. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANTS, QUESTIONS, STORAGE_METHOD, annualNeeds, buildPlan, compareEnterprises, dailyEnergy, estimateBudget, estimateFoodCoverage,
  lookupEnterprise, mergeGoals, nextQuestions, readyToPlan, safetyTopic, screenReply, scorePlant, validateDesignDraft, validateTasks,
  type HomesteadGoals,
} from '@plotwright/core';
import { KNOWLEDGE_BASE as KB } from '@plotwright/data';

const adult = (sex: 'male' | 'female', age = 40) => ({ age, sex, activity: 'moderatelyActive' as const });
const suit = Object.fromEntries(PLANTS.map((p) => [p.id, scorePlant(p, { zone: '6a', chillHours: 1200, peakSummerMaxF: 84, summerRhPct: 70 }, {}).score]));
const site = { parcelAcres: 2.5, zone: '6a', freezeFreeDays: 160, suitability: suit, sources: ['test'] };
const family: HomesteadGoals = {
  household: [adult('male'), adult('female', 38), { age: 9, sex: 'female', activity: 'active' }], ambition: 'veg-and-staples', hoursPerWeek: 10,
  budgetStartupUsd: 3000, gardenSpaceSqFt: 2000, experience: 'some-gardening', animals: 'yes', animalInterest: ['laying_hens'], water: 'well', willPreserve: true, diet: [],
};

test('interview: at most three questions at a time, essentials first, income follow-ups only when wanted', () => {
  assert.deepEqual(nextQuestions({}).map((q) => q.id), ['household', 'goals', 'ambition']);
  assert.ok(nextQuestions({}, 10).length <= 3);
  assert.ok(!nextQuestions({ ...family, wantsIncome: false }, 3).some((q) => q.id === 'market'));
  assert.ok(nextQuestions({ ...family, goals: ['food'], wantsIncome: true, physical: 'none' }).some((q) => q.id === 'market'));
  assert.equal(readyToPlan(family), true);
  assert.equal(readyToPlan({ household: family.household }), false);
  // Choosing the "income" goal implies wanting income; a change after confirmation needs re-confirmation.
  assert.equal(QUESTIONS.find((q) => q.id === 'goals')!.apply(['income']).wantsIncome, true);
  assert.equal(mergeGoals({ ...family, confirmedAt: 'x' }, { hoursPerWeek: 5 }).confirmedAt, undefined);
});

test('needs come from the Dietary Guidelines and DRI tables', () => {
  const row = KB.nutrition.dri.energy.byAge.find((r) => r.age === '36-40')!;
  assert.equal(dailyEnergy(adult('male'), KB), row.male.moderatelyActive);
  assert.equal(dailyEnergy({ ...adult('female'), pregnant: true }, KB) - dailyEnergy(adult('female'), KB), 340);
  const n = annualNeeds([adult('male')], KB);
  assert.equal(n.proteinG, 56 * 365);
  assert.equal(n.vitCMg, 90 * 365);
});

test('coverage: counts crops and animals, explains what it cannot count, groups storage', () => {
  const r = estimateFoodCoverage([adult('female')], { crops: [{ plantId: 'potato', areaSqFt: 100 }, { plantId: 'winter-rye', areaSqFt: 100 }, { plantId: 'nope', areaSqFt: 10 }], livestock: [{ species: 'laying_hens', count: 4 }, { species: 'meat_rabbits', count: 2 }] }, KB);
  assert.equal(r.contributions.length, 2);
  assert.ok(r.notCounted.some((x) => x.id === 'winter-rye' && /soil-building/.test(x.reason)));
  assert.ok(r.notCounted.some((x) => x.id === 'meat_rabbits'));
  assert.ok(r.share.kcal[0] > 0 && r.share.kcal[0] <= r.share.kcal[1]);
  assert.ok(r.storage.some((s) => s.method === 'root-cellar' && s.crops.includes('Potato')));
  for (const id of Object.keys(STORAGE_METHOD)) assert.ok(PLANTS.some((p) => p.id === id), `storage map has unknown plant ${id}`);
});

test('budget: per-unit costs scale, whole-system budgets are quoted at their own scale, unknowns are listed', () => {
  const b = estimateBudget([{ kind: 'drip', areaSqFt: 2000 }, { kind: 'livestock', species: 'laying_hens', count: 20 }, { kind: 'livestock', species: 'honeybees', count: 2 }, { kind: 'raised-beds', count: 4 }], KB);
  const drip = b.lines.find((l) => /Drip/.test(l.label))!;
  assert.deepEqual(drip.startup, [1000, 2000]);
  const hens = b.lines.find((l) => /laying hens/.test(l.label))!;
  assert.equal(hens.startup, null, 'a 10-hen flock budget is not stretched to 20 hens, nor added to totals');
  assert.deepEqual(hens.reference?.startup, KB.homestead.livestock.laying_hens!.startupCostUSD);
  assert.ok(!b.startupTotal.includes(NaN));
  assert.equal(hens.annual![0], (KB.homestead.livestock.laying_hens!.annualCostUSD![0] / 10) * 20);
  const bees = b.lines.find((l) => /honeybees/.test(l.label))!;
  assert.equal(bees.startup![0], KB.homestead.livestock.honeybees!.startupCostUSD![0] * 2);
  assert.ok(bees.caution, 'old price flagged');
  assert.ok(b.unknown.some((u) => /raised beds/.test(u)));
});

test('enterprises: plain-word lookup and fit against land, time, money and market', () => {
  assert.equal(lookupEnterprise('u-pick farm', KB)?.id, 'agritourism');
  assert.equal(lookupEnterprise('shiitake', KB)?.id, 'mushrooms_shiitake_logs');
  const fits = compareEnterprises({ hoursPerWeek: 5, budgetStartupUsd: 500, marketAccess: 'none', animals: 'no' }, 0.2, KB);
  assert.equal(fits.find((f) => f.id === 'market_garden_per_acre')!.fit, 'poor');
  assert.equal(fits.find((f) => f.id === 'eggs_small_flock')!.fit, 'poor');
  assert.ok(fits.every((f) => f.sources.length > 0));
});

test('rules planner: a phased, sourced plan whose drafts all validate', () => {
  const plan = buildPlan(family, site, KB, { now: new Date('2026-09-29T12:00:00Z') });
  assert.ok(plan.items.some((i) => i.phase === 'year0') && plan.items.some((i) => i.phase === 'year1') && plan.items.some((i) => i.phase === 'years2to5'));
  const garden = plan.items.find((i) => i.id === 'garden-y1')!;
  assert.ok(garden.crops!.length >= 8, 'a varied garden');
  const area = garden.crops!.reduce((a, c) => a + (c.areaSqFt ?? 0), 0);
  assert.ok(area <= 2000);
  // Consumption caps: no single crop takes more than ~12 % of the beds.
  for (const c of garden.crops!) assert.ok(c.areaSqFt! <= 0.13 * 2000 + 32, `${c.plantId} ${c.areaSqFt}`);
  assert.ok(plan.items.some((i) => i.livestock?.species === 'laying_hens'));
  assert.ok(plan.coverage.share.kcal[1] > 0);
  assert.ok(!plan.warnings.some((w) => /budget/.test(w)), 'garden + hens fit $3,000');
  assert.ok(buildPlan({ ...family, budgetStartupUsd: 500 }, site, KB).warnings.some((w) => /budget/.test(w)), 'over-budget warning');
  for (const i of plan.items) for (const d of i.draft ?? []) {
    const v = validateDesignDraft({ id: 'x', summary: i.title, changes: [d], why: [], createdBy: 'rules' }, []);
    assert.ok(v.ok, `${i.id}: ${v.problems.join('; ')}`);
  }
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(plan)));
});

test('rules planner respects diet, animal rules and experience', () => {
  const vegan = buildPlan({ ...family, diet: ['vegan'], animalInterest: ['laying_hens', 'feeder_pigs'] }, site, KB);
  assert.ok(!vegan.items.some((i) => i.category === 'livestock'));
  const none = buildPlan({ ...family, animals: 'no' }, site, KB);
  assert.ok(!none.items.some((i) => i.category === 'livestock'));
  const poultry = buildPlan({ ...family, animals: 'poultry-only', animalInterest: ['laying_hens', 'dairy_goats'] }, site, KB);
  assert.ok(!poultry.items.some((i) => i.livestock?.species === 'dairy_goats'));
  assert.ok(poultry.warnings.some((w) => /poultry only/.test(w)));
  const newbie = buildPlan({ ...family, experience: 'none' }, site, KB);
  assert.ok(newbie.items.some((i) => i.id === 'garden-y2'), 'beginners expand in year 2');
  const tiny = buildPlan({ ...family, ambition: 'max', gardenSpaceSqFt: 100 }, { ...site, parcelAcres: 0.1 }, KB);
  assert.ok(tiny.items.find((i) => i.id === 'garden-y1')!.crops!.length >= 1);
  const income = buildPlan({ ...family, wantsIncome: true, marketAccess: 'strong' }, site, KB, { includeIncome: true });
  assert.ok(income.enterprises && income.enterprises.length > 5);
  assert.ok(income.items.filter((i) => i.category === 'income').every((i) => i.why.some((w) => /not financial/.test(w))));
});

test('drafts and tasks are validated before anything can be approved', () => {
  const v = validateDesignDraft({ id: 'd', summary: 's', createdBy: 'model', why: [], changes: [
    { op: 'add', kind: 'raised-bed', count: 400, plants: ['tomato', 'unicorn'] }, { op: 'add', kind: 'moat' }, { op: 'remove', objectId: 'missing' },
  ] }, []);
  assert.equal(v.ok, false); // the unknown object and removal
  // 400 beds are split into chunks of 50 rather than rejected.
  assert.equal(v.cleaned.changes.length, 8);
  assert.equal((v.cleaned.changes[0] as { count: number }).count, 50);
  assert.deepEqual((v.cleaned.changes[0] as { plants: string[] }).plants, ['tomato']);
  const t = validateTasks([{ title: '  Build coop ', category: 'build', due: 'March' }, { title: '', category: 'plant' }, { title: 'x', category: 'weird' as 'plant', due: 'someday' }]);
  assert.equal(t.tasks.length, 2);
  assert.equal(t.tasks[1]!.category, 'admin');
  assert.equal(t.tasks[1]!.due, undefined);
});

test('safety: pesticide mixing, vet diagnosis and foraging questions get the fixed safe answer', () => {
  assert.equal(safetyTopic('How much Sevin should I mix per gallon for my squash?'), 'pesticide');
  assert.equal(safetyTopic('My hen is lethargic and not eating, what is wrong?'), 'veterinary');
  assert.equal(safetyTopic('I found wild mushrooms in the yard, can I eat these?'), 'foraging');
  assert.equal(safetyTopic('How many hens do I need for eggs?'), null);
  assert.equal(safetyTopic('When should I plant garlic?'), null);
  assert.equal(screenReply('Mix 2 oz per gallon of the insecticide spray.').replaced, 'pesticide');
  assert.equal(screenReply('Plant garlic in October.').replaced, undefined);
});

test('safety filter: catches real risks and leaves ordinary garden questions alone', () => {
  const must: Array<[string, string]> = [
    ['Can I eat dandelions from my yard?', 'foraging'], ['Are morels safe to eat?', 'foraging'], ['Which berries in my woods are edible?', 'foraging'],
    ['Is pokeweed edible?', 'foraging'], ['Can I eat the elderberries raw?', 'foraging'],
    ['How many tablespoons of Sevin per gallon?', 'pesticide'], ['Can I use copper fungicide at double strength?', 'pesticide'],
    ['What dewormer dose for a 100 lb goat?', 'veterinary'], ['How much ivermectin should I give goats?', 'veterinary'], ['Hen has bumblefoot, how do I treat it?', 'veterinary'],
    ['My son ate a pokeweed berry and is vomiting', 'medical'],
  ];
  for (const [q, topic] of must) assert.equal(safetyTopic(q), topic, q);
  const fine = [
    'How much forage do goats need per acre?', 'Is it safe to eat tomatoes after a frost?', 'How much water should I spray on seedlings?',
    'Which crops mix well together so I can avoid spraying?', 'What ratio of compost to soil should I use with no pesticide?',
    'I’m allergic to bee stings, can I keep bees?', 'We ate all our tomatoes by August', 'How many hens do I need for eggs?', 'When should I plant garlic?',
    'Can my kids help with the chickens?', 'How do I start a worm bin?',
  ];
  for (const q of fine) assert.equal(safetyTopic(q), null, q);
});
