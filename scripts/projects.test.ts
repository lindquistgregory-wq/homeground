/** Plan projects: grouping the plan into projects, dating their steps, and the chores finished steps bring. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANTS, activeChores, buildPlan, expandCustom, nextStep, projectDraft, projectProgressShare, projectsFromPlan, scheduleProject, scorePlant,
  type HomesteadGoals, type ProjectProgress,
} from '@plotwright/core';
import { KNOWLEDGE_BASE as KB } from '@plotwright/data';

const suit = Object.fromEntries(PLANTS.map((p) => [p.id, scorePlant(p, { zone: '6a', chillHours: 1200, peakSummerMaxF: 84, summerRhPct: 70 }, {}).score]));
const site = { parcelAcres: 2.5, zone: '6a', freezeFreeDays: 160, suitability: suit, sources: ['test'] };
const goals: HomesteadGoals = {
  household: [{ age: 40, sex: 'male', activity: 'moderatelyActive' }, { age: 38, sex: 'female', activity: 'moderatelyActive' }],
  ambition: 'most-veg', hoursPerWeek: 10, budgetStartupUsd: 3000, gardenSpaceSqFt: 500, experience: 'some-gardening',
  animals: 'yes', animalInterest: ['laying_hens', 'honeybees'], water: 'well', willPreserve: true, diet: [],
};
const plan = buildPlan(goals, site, KB, { now: new Date('2026-10-01T00:00:00Z'), showCosts: true });
const projects = projectsFromPlan(plan);
const byId = (id: string) => projects.find((p) => p.id === id)!;
const prog = (projectId: string, over: Partial<ProjectProgress> = {}): ProjectProgress => ({ parcelId: 'p', projectId, done: {}, updatedAt: '2026-10-01', ...over });

test('projects: the garden, each animal and the perennials, garden infrastructure folded into the garden', () => {
  const ids = projects.map((p) => p.id);
  assert.ok(ids.includes('garden') && ids.includes('ls-laying_hens') && ids.includes('ls-honeybees'));
  const garden = byId('garden');
  assert.ok(garden.itemIds.includes('beds') && garden.itemIds.includes('garden-y1'));
  // Steps in a sensible order: build before planting.
  const order = garden.steps.map((s) => s.id);
  assert.ok(order.indexOf('beds') < order.indexOf('plant'));
  const hens = byId('ls-laying_hens').steps.map((s) => s.id);
  assert.ok(hens.indexOf('housing') < hens.indexOf('arrive'));
  assert.equal(hens[0], 'check-rules');
  // Every plan item that isn't income ends up in some project.
  const covered = new Set(projects.flatMap((p) => p.itemIds));
  for (const i of plan.items.filter((x) => x.category !== 'income' && x.category !== 'learning')) assert.ok(covered.has(i.id), `${i.id} in a project`);
});

test('schedule: steps follow one another; finishing early or late moves the rest', () => {
  const hens = byId('ls-laying_hens');
  assert.deepEqual(scheduleProject(hens, prog(hens.id), '2026-10-01'), [], 'not on the calendar yet');
  const s = scheduleProject(hens, prog(hens.id, { startDate: '2026-10-05' }), '2026-10-01');
  assert.equal(s[0]!.start, '2026-10-05');
  for (let i = 1; i < s.length; i++) assert.ok(s[i]!.start > s[i - 1]!.end, 'sequential');
  // Rules checked on day one: the next step starts the day after.
  const early = scheduleProject(hens, prog(hens.id, { startDate: '2026-10-05', done: { 'check-rules': '2026-10-05' } }), '2026-10-05');
  assert.equal(early[1]!.start, '2026-10-06');
  // Nothing done three weeks on: the first step is late and stretched to today; the rest wait behind it.
  const late = scheduleProject(hens, prog(hens.id, { startDate: '2026-10-05' }), '2026-10-26');
  assert.equal(late[0]!.late, true);
  assert.equal(late[0]!.end, '2026-10-26');
  assert.equal(late[1]!.start, '2026-10-27');
});

test('chores start the day after their step is done, and can be switched off', () => {
  const hens = byId('ls-laying_hens');
  assert.equal(activeChores(hens, prog(hens.id)).length, 0);
  const done = prog(hens.id, { startDate: '2026-10-01', done: Object.fromEntries(hens.steps.map((st) => [st.id, st.id === 'arrive' ? '2026-10-14' : '2026-10-10'])) });
  const chores = activeChores(hens, done);
  assert.ok(chores.some((c) => c.chore.repeat === 'daily' && c.from === '2026-10-15'));
  assert.equal(activeChores(hens, { ...done, choresOff: ['eggs'] }).some((c) => c.chore.id === 'eggs'), false);
  assert.deepEqual(projectProgressShare(hens, done), { done: hens.steps.length, total: hens.steps.length });
  assert.equal(nextStep(hens, done), undefined);
});

test('a project draft gathers its items’ design changes and the herd', () => {
  const d = projectDraft(byId('ls-laying_hens'), plan, 'd1')!;
  assert.ok(d.changes.some((c) => c.op === 'add' && c.kind === 'chicken-coop'));
  assert.equal(d.herd?.species, 'laying_hens');
});

test('daily events repeat every day, even when they started long ago', () => {
  const e = { id: 'e', parcelId: 'p', title: 'Eggs', date: '2020-01-01', repeat: 'daily' as const, createdAt: '2020-01-01' };
  assert.equal(expandCustom(e, '2026-10-01', '2026-10-31').length, 31);
});
