import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newObject } from '../design/design';
import { localFrame } from '../geo/measure';
import {
  HOUSING_KINDS, animalById, animalsForHousing, doyOfIso, housingHeatCheck, housingOccupancy, housingSensorLimits, upcomingAnimalTasks, windowOverlaps,
} from './index';

const hens = animalById('laying_hens')!;
const turkeys = animalById('turkeys')!;
const goats = animalById('dairy_goats')!;
const quail = animalById('coturnix_quail')!;
const frame = localFrame({ lat: 35.7, lon: -79.8 });
const coop = { ...newObject('chicken-coop', { lat: 35.7, lon: -79.8 }, 'c'), width: 2.4, length: 2.4 }; // ~62 sq ft: 12 hens at 5 sq ft

test('housing kinds and the species that can live in each', () => {
  for (const k of ['chicken-coop', 'chicken-run', 'paddock', 'barn', 'beehive', 'goat-shelter']) assert.ok(HOUSING_KINDS.has(k), k);
  assert.ok(!HOUSING_KINDS.has('raised-bed'));
  assert.deepEqual(animalsForHousing('beehive').map((a) => a.id), ['honeybees']);
  assert.ok(animalsForHousing('chicken-coop').some((a) => a.id === 'laying_hens'));
});

test('shared housing adds up each herd’s share of the space', () => {
  const six = housingOccupancy([{ herdId: 'a', animal: hens, count: 6 }], coop, frame);
  assert.equal(six.used, 0.5);
  assert.equal(six.over, false);
  assert.equal(six.shares[0]!.capacity.fits, 12);
  // 10 hens (10/12) plus quail: 62 sq ft at 4 sq ft each fits 15, so 5 quail add a third → over.
  const mixed = housingOccupancy([{ herdId: 'a', animal: hens, count: 10 }, { herdId: 'b', animal: quail, count: 5 }], coop, frame);
  assert.ok(mixed.used! > 1, String(mixed.used));
  assert.equal(mixed.over, true);
  assert.equal(housingOccupancy([{ herdId: 'a', animal: hens, count: 12 }], coop, frame).over, false, 'exactly full is not over');
});

test('species that should not share are flagged with the sourced reason, from either side', () => {
  const o = housingOccupancy([{ herdId: 'a', animal: hens, count: 4 }, { herdId: 'b', animal: turkeys, count: 2 }], coop, frame);
  assert.equal(o.conflicts.length, 1);
  assert.match(o.conflicts[0]!, /blackhead/i);
  assert.equal(housingOccupancy([{ herdId: 'a', animal: hens, count: 4 }], coop, frame).conflicts.length, 0);
});

test('a herd with no sourced space figure never makes the housing look roomier', () => {
  const hive = newObject('beehive', { lat: 35.7, lon: -79.8 }, 'h');
  // Hens have no figure for a beehive: nothing is counted, so `used` is null rather than 0.
  assert.equal(housingOccupancy([{ herdId: 'a', animal: hens, count: 3 }], hive, frame).used, null);
});

test('sensor limits for animal housing: lowest heat onset, and freezing water at minimum', () => {
  const l = housingSensorLimits([hens, goats]);
  assert.equal(l.maxF, 85, 'hens: 85 °F (goats are rated by THI)');
  assert.equal(l.minF, 32);
  assert.ok(l.basis.some((b) => /THI/.test(b)));
  const pigs = housingSensorLimits([hens, animalById('feeder_pigs')!]);
  assert.equal(pigs.maxF, 70, 'the most heat-sensitive animal sets the limit');
});

test('live heat check uses the sensor’s own humidity for THI species', () => {
  // Goats (THI 82): 90 °F at 30% RH → THI ≈ 79, fine; at 70% → ≈ 84, stressed.
  assert.equal(housingHeatCheck([goats], 90, 30).length, 0);
  assert.equal(housingHeatCheck([goats], 90, 70).length, 1);
  assert.equal(housingHeatCheck([hens, goats], 86, 30).map((x) => x.animal.id).join(), 'laying_hens');
  assert.equal(housingHeatCheck([hens], undefined, 50).length, 0);
});

test('care tasks: windows that wrap past New Year, and soonest first', () => {
  assert.equal(doyOfIso('2026-02-01'), 32);
  assert.equal(doyOfIso('2024-12-31'), 366);
  assert.equal(doyOfIso('nope'), undefined);
  const winter = { start: 311, end: 87 };
  assert.ok(windowOverlaps(winter, 20, 40), 'January is inside Nov–Mar');
  assert.ok(windowOverlaps(winter, 300, 320));
  assert.ok(!windowOverlaps(winter, 120, 200));
  const tasks = upcomingAnimalTasks([
    { herdId: 'h', animalId: 'laying_hens', events: [{ kind: 'heat-prep', start: 130, end: 270, label: 'Heat', basis: '' }, { kind: 'winter-water', ...winter, label: 'Water', basis: '' }] },
  ], 20, 48);
  assert.deepEqual(tasks.map((t) => t.kind), ['winter-water']);
  assert.equal(tasks[0]!.herdId, 'h');
});

test('counts read naturally: colonies for bees, the species name otherwise', async () => {
  const { countOf } = await import('./index');
  const bees = animalById('honeybees')!;
  assert.equal(countOf(bees, 1), '1 colony');
  assert.equal(countOf(bees, 2), '2 colonies');
  assert.equal(countOf(hens, 6), '6 laying hens');
  assert.equal(countOf(undefined, 3), '3 animals');
});

test('new homestead species: horse heat index, pond stocking, worms by the pound, roaming guardians', async () => {
  const { heatStress, housingCapacity, livestockAlerts } = await import('./index');
  const horses = animalById('horses')!;
  // Temperature + humidity: 80 °F at 40% = 120 (the most cautious extension cutoff) → stressed; 75 + 40 = 115 → fine.
  assert.equal(heatStress(horses, 80, 40).stressed, true);
  assert.equal(heatStress(horses, 75, 40).stressed, false);
  assert.match(heatStress(horses, 80, 40).basis!, /humidity/);
  const pond = { ...newObject('pond', { lat: 35.7, lon: -79.8 }, 'p'), width: 64, length: 64 }; // just over an acre (circle ≈ 0.8 acre)
  const fish = housingCapacity(animalById('pond_fish')!, pond, frame, 300);
  assert.equal(fish.limitingFactor, 'pond');
  assert.ok(fish.fits! > 300 && fish.fits! < 600, String(fish.fits));
  const bin = { ...newObject('worm-bin', { lat: 35.7, lon: -79.8 }, 'w'), width: 0.61, length: 0.61 }; // 2 × 2 ft
  assert.equal(housingCapacity(animalById('composting_worms')!, bin, frame, 4).fits, 4, '4 lb in a 4 sq ft bin');
  const { countOf } = await import('./index');
  assert.equal(countOf(animalById('composting_worms')!, 3), '3 lb of worms');
  assert.ok(animalById('guardian_dog')!.housingObjects.includes('chicken-run'), 'guardian dogs can live with the flock');
  // Pond fish and worms get no weather alerts (the advice is for land animals).
  const hot = [{ start: '2026-07-01T12:00:00-04:00', end: '2026-07-01T18:00:00-04:00', isNight: false, temperatureF: 99, relativeHumidityPct: 60 }] as never;
  assert.equal(livestockAlerts(hot, [{ herdId: 'f', animal: animalById('pond_fish')!, count: 500, housingName: 'Pond' }]).length, 0);
  assert.equal(livestockAlerts(hot, [{ herdId: 'h', animal: horses, count: 2, housingName: 'Pasture' }]).length, 1);
});
