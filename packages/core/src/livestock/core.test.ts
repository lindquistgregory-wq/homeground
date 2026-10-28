import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newObject } from '../design/design';
import { localFrame } from '../geo/measure';
import {
  ANIMALS, animalById, animalCalendar, heatStress, housingCapacity, livestockAlerts, protectiveNeed, scoreAnimal, thi, zoneMinF,
} from './index';

const hens = animalById('laying_hens')!;
const goats = animalById('dairy_goats')!;
const cattle = animalById('beef_cattle')!;

test('conservative defaults: needs read at the larger figure; THI matches the NRC °F form', () => {
  assert.equal(protectiveNeed([1.5, 5]), 5);
  assert.equal(protectiveNeed(null), undefined);
  // NRC (1971): 90 °F at 50% RH → 90 − (0.55 − 0.275)(32) = 81.2
  assert.equal(Math.round(thi(90, 50) * 10) / 10, 81.2);
  // Every heat-tagged species uses its single sourced (protective) onset.
  for (const a of ANIMALS) if (a.heat.thiOnset !== undefined) assert.ok(a.heat.thiScale, a.id);
});

test('heat stress: air threshold, THI threshold, and a muggy fallback when the forecast has no humidity', () => {
  assert.equal(heatStress(hens, 84).stressed, false);
  assert.equal(heatStress(hens, 85).stressed, true);
  // Goats: THI 82. 90 °F at 30% RH → THI ≈ 79 (fine); at 70% (fallback) → ≈ 84 (stressed).
  assert.equal(heatStress(goats, 90, 30).stressed, false);
  assert.equal(heatStress(goats, 90).stressed, true);
  assert.match(heatStress(goats, 90).basis!, /assuming humid air/);
  assert.equal(heatStress(cattle, 72, 20).stressed, true, 'cattle: the 72 °F air onset trips first');
});

test('species with no sourced onset still get cautious heat and cold alerts (by tolerance)', () => {
  const dog = animalById('guardian_dog')!, alpaca = animalById('alpacas')!, donkey = animalById('guardian_donkey')!;
  const bees = animalById('honeybees')!;
  // Low heat tolerance: °F + humidity 120. 75 °F at 40% = 115 is fine; 80 °F at 45% = 125 is not.
  assert.equal(heatStress(dog, 75, 40).stressed, false);
  assert.equal(heatStress(dog, 80, 45).stressed, true);
  assert.match(heatStress(alpaca, 80, 45).basis!, /cautious general limit/);
  // High heat tolerance (donkeys): 150, so a warm muggy day doesn't alert daily.
  assert.equal(heatStress(donkey, 85, 50).stressed, false);
  assert.equal(heatStress(donkey, 100, 55).stressed, true);
  assert.equal(heatStress(bees, 110, 60).stressed, false, 'no fallback for hives');
  for (const id of ['guardian_dog', 'alpacas', 'guardian_llama', 'ducks_layers']) {
    const a = animalById(id)!;
    const heat = livestockAlerts([{ start: '2027-07-20T12:00:00-04:00', end: '2027-07-20T18:00:00-04:00', isNight: false, temperatureF: 104, relativeHumidityPct: 60 } as never], [{ herdId: 'h', animal: a, count: 1, housingName: 'run' }]);
    assert.equal(heat.filter((x) => x.kind === 'heat').length, 1, `${id} gets a heat alert at 104 °F`);
  }
  // Cold: donkeys (low cold tolerance) are warned at 20 °F; Great Pyrenees-type dogs (high) at 0 °F.
  const night = (f: number) => [{ start: '2027-01-10T18:00:00-05:00', end: '2027-01-11T06:00:00-05:00', isNight: true, temperatureF: f } as never];
  const kinds = (a: typeof dog, f: number) => livestockAlerts(night(f), [{ herdId: 'h', animal: a, count: 1, housingName: 'barn' }]).map((x) => x.kind);
  assert.ok(kinds(donkey, 18).includes('cold'));
  assert.ok(!kinds(dog, 18).includes('cold'));
  assert.ok(kinds(dog, -2).includes('cold'));
});

test('fit: heat, cold, pasture and social factors explain the score; impossible plans are capped', () => {
  const hot = scoreAnimal(hens, { zone: '8a', peakSummerMaxF: 95, summerRhPct: 75 }, undefined, 10);
  assert.equal(hot.factors.find((f) => f.key === 'heat')!.status === 'good', false);
  assert.ok(hot.flags.some((f) => /zoning/i.test(f)), 'zoning is always flagged, never scored');
  const tooSmall = scoreAnimal(cattle, { zone: '7a', parcelAcres: 2 }, undefined, 2);
  assert.equal(tooSmall.verdict, 'not-suitable');
  assert.match(tooSmall.hardFails[0]!, /acres of pasture/);
  const alone = scoreAnimal(goats, { zone: '7a', parcelAcres: 5 }, undefined, 1);
  assert.ok(alone.hardFails.some((h) => /alone/.test(h)), 'a single goat is never suggested');
  assert.equal(zoneMinF('8a'), 10);
  assert.equal(zoneMinF('6b'), -5);
});

test('housing capacity uses the larger cited space per animal', () => {
  const frame = localFrame({ lat: 35.7, lon: -79.8 });
  const coop = { ...newObject('chicken-coop', { lat: 35.7, lon: -79.8 }, 'c'), width: 2.4, length: 2.4 }; // ~62 sq ft
  const c = housingCapacity(hens, coop, frame, 10);
  assert.equal(c.fits, 12, '62 sq ft at 5 sq ft each');
  assert.equal(c.limitingFactor, 'indoor space');
  const hive = housingCapacity(animalById('honeybees')!, newObject('beehive', { lat: 35.7, lon: -79.8 }, 'h'), frame, 1);
  assert.equal(hive.fits, 1);
  const paddock = { ...newObject('paddock', { lat: 35.7, lon: -79.8 }, 'p'), width: 64, length: 64 }; // just over 1 acre
  assert.equal(housingCapacity(animalById('sheep')!, paddock, frame, 2).fits, 2);
});

const FROST = {
  lastSpring: { 28: { 10: 80, 50: 87, 90: 95 }, 32: { 10: 90, 50: 97, 90: 105 } },
  firstFall: { 28: { 10: 300, 50: 310, 90: 320 }, 32: { 10: 290, 50: 300, 90: 310 } },
} as never;

test('calendar: due dates from gestation, lay start from hatch, bee season from frost dates; processing only when switched on', () => {
  const g = animalCalendar(goats, { bredDoy: 280 }, { frost: FROST });
  const due = g.find((e) => e.kind === 'due')!;
  assert.deepEqual([due.start, due.end], [65, 65], 'Oct 7 + 150 days wraps into March');
  const h = animalCalendar(hens, { arrivedDoy: 100 }, { frost: FROST });
  assert.ok(h.some((e) => e.kind === 'lay-start' && e.start === 226));
  assert.ok(h.some((e) => e.kind === 'winter-water'));
  const bees = animalCalendar(animalById('honeybees')!, {}, { frost: FROST });
  assert.ok(bees.some((e) => e.kind === 'install-bees') && bees.filter((e) => e.kind === 'mite-check').length >= 6);
  const broilers = animalById('meat_chickens')!;
  assert.ok(!animalCalendar(broilers, { arrivedDoy: 120 }, { frost: FROST }).some((e) => e.kind === 'process'), 'processing hidden by default');
  assert.ok(animalCalendar(broilers, { arrivedDoy: 120 }, { frost: FROST, showProcessing: true }).some((e) => e.kind === 'process'));
  assert.ok(!animalCalendar(hens, {}, { frost: FROST, peakSummerMaxF: 80 }).some((e) => e.kind === 'heat-prep'), 'no heat season where summers stay cool');
});

test('alerts: heat by temperature or THI, freezing water at night, wind for hives; no medical wording', () => {
  const herds = [
    { herdId: 'h', animal: hens, count: 6, housingName: 'Coop' },
    { herdId: 'g', animal: goats, count: 2, housingName: 'Shelter' },
    { herdId: 'b', animal: animalById('honeybees')!, count: 2, housingName: 'Hives' },
  ];
  const periods = [
    { start: '2027-07-12T06:00:00-04:00', end: '2027-07-12T18:00:00-04:00', isNight: false, temperatureF: 92, relativeHumidityPct: 60, windMph: 35 },
    { start: '2027-12-12T18:00:00-05:00', end: '2027-12-13T06:00:00-05:00', isNight: true, temperatureF: 25 },
  ];
  const a = livestockAlerts(periods, herds);
  const heat = a.find((x) => x.kind === 'heat')!;
  assert.deepEqual(heat.herdIds.sort(), ['g', 'h']);
  assert.match(heat.title, /60% humidity/);
  assert.ok(a.some((x) => x.kind === 'freeze-water' && !x.herdIds.includes('b')));
  assert.ok(a.some((x) => x.kind === 'wind' && x.herdIds.includes('b')));
  for (const x of a) assert.ok(!/\b(dose|mg|medicat|antibiotic|treat)\w*\b/i.test(x.body), x.body);
  assert.equal(livestockAlerts(periods, []).length, 0);
});
