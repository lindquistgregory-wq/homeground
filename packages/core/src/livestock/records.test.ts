import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDaysIso, animalById, animalCsvTemplate, animalsCsv, eggsPerHenPerWeek, expectedDue, healthDue, isHousehold, logSeries, logTotal, parseAnimalCsv,
  statusOptions, toCsv, vetHistoryHtml, weanedPerLitter, welfareNote, type AnimalLog, type AnimalRecord, type HealthRecord,
} from './index';

const goats = animalById('dairy_goats')!;
const hens = animalById('laying_hens')!;

test('due windows cover the whole cited range, from gestation or incubation', () => {
  const g = goats.reproduction.gestationDays!;
  const d = expectedDue(goats, '2026-01-01')!;
  assert.equal(d.from, addDaysIso('2026-01-01', g[0]));
  assert.equal(d.to, addDaysIso('2026-01-01', g[1]));
  assert.match(d.basis, /gestation/);
  const eggs = expectedDue(hens, '2026-04-01', 'eggs-set')!;
  assert.match(eggs.basis, /incubation/);
  assert.equal(expectedDue(goats, 'April 1'), null);
  assert.equal(expectedDue(undefined, '2026-01-01'), null);
});

test('health due: a later record for the same product replaces the earlier due date', () => {
  const r = (id: string, date: string, nextDue: string | undefined, product = 'CDT'): HealthRecord => ({ id, animalId: 'a1', date, type: 'vaccination', product, nextDue });
  const records = [r('1', '2025-03-01', '2026-03-01'), r('2', '2026-03-05', '2027-03-05'), r('3', '2026-01-10', '2026-02-01', 'Rabies')];
  const due = healthDue(records, '2026-02-10', 30);
  assert.deepEqual(due.map((d) => d.record.id), ['3'], 'CDT was renewed; rabies is overdue');
  assert.equal(due[0]!.overdue, true);
  assert.equal(due[0]!.days, -9);
  assert.equal(healthDue([r('4', '2026-01-01', '2026-06-01')], '2026-02-10', 30).length, 0, 'beyond the horizon');
  assert.equal(healthDue([r('5', '2026-01-01', undefined)], '2026-02-10').length, 0, 'no next-due date, no reminder');
});

test('egg logs: weekly series, eggs per hen per week, and totals', () => {
  const logs: AnimalLog[] = Array.from({ length: 28 }, (_, i) => ({ id: String(i), herdId: 'h', date: addDaysIso('2026-05-28', -i), kind: 'eggs', value: 5, unit: 'eggs' }));
  // 5 eggs a day from 6 hens → 35 a week ÷ 6 ≈ 5.8 per hen.
  assert.equal(eggsPerHenPerWeek(logs, 6, '2026-05-28'), 5.8);
  assert.equal(eggsPerHenPerWeek(logs, 0, '2026-05-28'), null);
  const weeks = logSeries(logs, 'eggs', 'week', '2026-05-28');
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks.slice(-4).map((w) => w.total), [35, 35, 35, 35]);
  assert.equal(weeks[0]!.total, 0);
  const months = logSeries(logs, 'eggs', 'month', '2026-05-28');
  assert.equal(months.length, 6);
  assert.equal(months[5]!.label, 'May');
  assert.equal(months[5]!.total + months[4]!.total, 140);
  assert.equal(logSeries(logs, 'eggs', 'season', '2026-05-28').length, 4);
  assert.equal(logTotal(logs, 'eggs', '2026-05-22'), 35);
  assert.equal(weanedPerLitter([{ id: 'w', date: '2026-01-01', kind: 'litter-weaned', value: 7, unit: 'head' }, { id: 'v', date: '2026-04-01', kind: 'litter-weaned', value: 8, unit: 'head' }]), 7.5);
});

test('statuses: processed only with the processing switch on, never for pets', () => {
  assert.ok(!statusOptions(false).includes('processed'));
  assert.ok(statusOptions(true).includes('processed'));
  assert.ok(!statusOptions(true, 'household:dog').includes('processed'));
  assert.ok(isHousehold('household:cat'));
  assert.ok(!isHousehold('laying_hens'));
});

test('welfare: a social species kept alone gets a gentle note', () => {
  assert.match(welfareNote(goats, 1)!, /groups of 2 or more/);
  assert.equal(welfareNote(goats, 2), null);
  assert.equal(welfareNote(goats, 0), null);
});

test('CSV: the template round-trips, bad rows are reported, and nothing is guessed', () => {
  const resolve = (s: string) => (s === 'dairy_goats' || s === 'household:dog' ? s : s.toLowerCase() === 'goat' ? 'dairy_goats' : undefined);
  const t = parseAnimalCsv(animalCsvTemplate(), resolve);
  assert.deepEqual(t.errors, []);
  assert.equal(t.animals.length, 2);
  assert.equal(t.animals[1]!.sex, 'castrated');
  const bad = parseAnimalCsv('name,species,sex,birth_date,status\nBilly,goat,buck,2025-04-01,\nX,unicorn,,,\nY,goat,maybe,,\nZ,goat,,04/01/2025,\nP,goat,,,processed\n', resolve);
  assert.equal(bad.animals.length, 1);
  assert.equal(bad.animals[0]!.sex, 'male', '“buck” is read as male');
  assert.equal(bad.errors.length, 4);
  assert.ok(bad.errors.some((e) => /unicorn/.test(e)));
  assert.ok(bad.errors.some((e) => /YYYY-MM-DD/.test(e)));
  assert.ok(bad.errors.some((e) => /processed/.test(e)), 'processed needs the switch on');
  assert.equal(parseAnimalCsv('name,species,status\nP,goat,processed\n', resolve, { showProcessing: true }).animals.length, 1);
  assert.match(parseAnimalCsv('nom,espece\nA,B\n', resolve).errors[0]!, /name/);
  // Exports quote commas and quotes.
  assert.equal(toCsv(['a'], [['x, "y"']]), 'a\n"x, ""y"""\n');
  const rec: AnimalRecord = { id: '1', speciesId: 'dairy_goats', name: 'Daisy', sex: 'female', status: 'active', createdAt: '2026-01-01', outsideSire: { name: 'Buck from Smith' } };
  assert.match(animalsCsv([rec], () => undefined), /Buck from Smith/);
});

test('vet export lists the owner’s records, escaped, and says they are the owner’s', () => {
  const a: AnimalRecord = { id: '1', speciesId: 'household:dog', name: 'Rex <3', sex: 'castrated', status: 'active', createdAt: '2026-01-01', tag: 'chip 123' };
  const html = vetHistoryHtml(a, 'Dog', [{ id: 'h', animalId: '1', date: '2026-02-01', type: 'vaccination', product: 'Rabies 3-yr', nextDue: '2029-02-01' }], '2026-02-02');
  assert.match(html, /Rex &lt;3/);
  assert.match(html, /Rabies 3-yr/);
  assert.match(html, /not veterinary advice/);
});
