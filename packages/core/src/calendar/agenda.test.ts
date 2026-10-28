import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doyToIso, expandCustom, formatRange, itemsOn, monthGrid, windowToIso, type AgendaItem, type CustomEvent } from './agenda';

const ev = (over: Partial<CustomEvent>): CustomEvent => ({ id: 'e', parcelId: 'p', title: 'Farrier', date: '2026-01-31', repeat: 'none', createdAt: '2026-01-01', ...over });

test('day-of-year windows become dates, wrapping into the next year', () => {
  assert.equal(doyToIso(2026, 1), '2026-01-01');
  assert.equal(doyToIso(2026, 87), '2026-03-28');
  assert.deepEqual(windowToIso(2026, 311, 87), { start: '2026-11-07', end: '2027-03-28' });
});

test('leap years: a normals date (Apr 15 = day 105) stays Apr 15, and out-of-range days roll over', () => {
  assert.equal(doyToIso(2028, 105), '2028-04-15');
  assert.equal(doyToIso(2028, 59), '2028-02-28');
  assert.equal(doyToIso(2028, 60), '2028-03-01');
  assert.equal(doyToIso(2026, 0), '2025-12-31');
  assert.equal(doyToIso(2026, 366), '2027-01-01');
});

test('repeating custom events: weekly, monthly (31st falls back), yearly, and one-offs', () => {
  assert.equal(expandCustom(ev({ repeat: 'weekly', date: '2026-10-01' }), '2026-10-01', '2026-10-31').length, 5);
  const monthly = expandCustom(ev({ repeat: 'monthly' }), '2026-01-01', '2026-04-30').map((i) => i.start);
  assert.deepEqual(monthly, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(expandCustom(ev({ repeat: 'yearly', date: '2024-02-29' }), '2026-01-01', '2026-12-31').map((i) => i.start), ['2026-02-28']);
  assert.equal(expandCustom(ev({}), '2026-02-01', '2026-02-28').length, 0);
  const multi = expandCustom(ev({ date: '2026-01-30', endDate: '2026-02-02' }), '2026-02-01', '2026-02-28');
  assert.equal(multi.length, 1, 'a multi-day event that started last month still shows');
  assert.equal(multi[0]!.end, '2026-02-02');
});

test('month grid: whole Sunday-first weeks, title cards on start days, long windows only once', () => {
  const items: AgendaItem[] = [
    { id: 'a', source: 'planting', title: 'Sow peas', start: '2026-03-05', end: '2026-03-08', details: [] },
    { id: 'b', source: 'animal', title: 'Keep water from freezing', start: '2025-11-07', end: '2026-03-28', details: [] },
    { id: 'c', source: 'alert', title: 'Frost tonight', start: '2026-03-06', details: [], urgent: true },
  ];
  const g = monthGrid(2026, 3, items);
  assert.equal(g[0]![0]!.iso, '2026-03-01', 'March 2026 starts on a Sunday');
  assert.equal(g.length, 5);
  const day6 = g.flat().find((c) => c.iso === '2026-03-06')!;
  assert.deepEqual(day6.items.map((i) => i.id), ['c', 'a'], 'urgent first; short windows on every day they span');
  assert.equal(day6.ongoing, 1, 'the winter window is ongoing, not a card');
  assert.equal(itemsOn(items, '2025-11-07').shown[0]!.id, 'b', 'long windows show on their first day');
  assert.equal(g.flat().filter((c) => c.inMonth).length, 31);
});

test('ranges read plainly', () => {
  assert.equal(formatRange('2026-03-28'), 'Mar 28');
  assert.equal(formatRange('2026-03-28', '2026-04-04'), 'Mar 28 – Apr 4');
  assert.equal(formatRange('2026-11-07', '2027-03-28'), 'Nov 7 – Mar 28, 2027');
});
