import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COI_DEFAULT_LIMIT, COI_MAX_LIMIT, Pedigree, animalById, coiLimit, estimateMerit, herdInbreedingTrend, meritTrait, shallowPedigreeWarning, suggestMates,
  type AnimalLog, type PedigreeAnimal,
} from './index';

const A = (id: string, sex: 'female' | 'male', sireId?: string, damId?: string, extra: Partial<PedigreeAnimal> = {}): PedigreeAnimal =>
  ({ id, name: id, sex, speciesId: 'dairy_goats', status: 'active', sireId, damId, ...extra });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('hand-worked COI: half sibs 1/8, full sibs 1/4, parent × offspring 1/4, unrelated 0', () => {
  const p = new Pedigree([
    A('S', 'male'), A('D1', 'female'), A('D2', 'female'),
    A('X', 'male', 'S', 'D1'), A('Y', 'female', 'S', 'D2'), A('Z', 'female', 'S', 'D1'),
  ]);
  close(p.pairingCoi('X', 'Y'), 1 / 8); // half sibs through S
  close(p.pairingCoi('X', 'Z'), 1 / 4); // full sibs
  close(p.pairingCoi('S', 'Y'), 1 / 4); // sire × daughter
  close(p.pairingCoi('S', 'D1'), 0);
  close(p.relatedness('X', 'Z'), 0.5);
});

test('hand-worked COI: first cousins 1/16 (= the 6.25% rule of thumb)', () => {
  const p = new Pedigree([
    A('G1', 'male'), A('G2', 'female'), A('M1', 'female'), A('M2', 'male'),
    A('P', 'male', 'G1', 'G2'), A('Q', 'female', 'G1', 'G2'),
    A('X', 'male', 'P', 'M1'), A('Y', 'female', 'M2', 'Q'),
  ]);
  close(p.pairingCoi('X', 'Y'), 1 / 16);
  close(COI_MAX_LIMIT, 1 / 16);
});

test('an inbred common ancestor raises COI: half sibs through a sire with F = 1/4 → (1/2)^3 × 1.25', () => {
  const p = new Pedigree([
    A('GS', 'male'), A('GD', 'female'),
    A('B', 'male', 'GS', 'GD'), A('C', 'female', 'GS', 'GD'),
    A('S', 'male', 'B', 'C'), // full-sib mating: F(S) = 1/4
    A('D1', 'female'), A('D2', 'female'),
    A('X', 'male', 'S', 'D1'), A('Y', 'female', 'S', 'D2'),
  ]);
  close(p.coi('S'), 1 / 4);
  close(p.pairingCoi('X', 'Y'), 0.125 * 1.25);
});

test('missing ancestors are unknown, not unrelated: a shallow pedigree is flagged', () => {
  const p = new Pedigree([A('S', 'male'), A('D', 'female'), A('X', 'male', 'S', 'D'), A('lonely', 'female')]);
  const d = p.pedigreeDepth('X');
  assert.equal(d.knownGenerations, 1);
  assert.match(shallowPedigreeWarning(d)!, /may be higher/);
  assert.match(shallowPedigreeWarning(p.pedigreeDepth('lonely'))!, /unknown, not unrelated/);
  assert.equal(p.tree('X', 2).sire!.name, 'S');
  assert.equal(p.tree('X', 2).sire!.sire!.unknown, true);
  // A record that names itself as its own parent doesn't loop.
  close(new Pedigree([A('L', 'male', 'L', 'L')]).coi('L'), 0);
});

test('COI limit: below 5% by default; raising needs acknowledgement and stops at 6.25%', () => {
  assert.equal(coiLimit(undefined), COI_DEFAULT_LIMIT);
  assert.equal(coiLimit(0.03), 0.03, 'lowering is free');
  assert.equal(coiLimit(0.06), COI_DEFAULT_LIMIT, 'raising without acknowledgement is refused');
  assert.equal(coiLimit(0.06, true), 0.06);
  assert.equal(coiLimit(0.2, true), COI_MAX_LIMIT);
});

test('suggestions: never at or above the limit, never against a mating rule, lowest COI first when merit is similar', () => {
  const goats = animalById('dairy_goats')!;
  const animals = [
    A('S', 'male'), A('D1', 'female'), A('D2', 'female'),
    A('Doe', 'female', 'S', 'D1', { traits: ['polled'] }),
    A('HalfBro', 'male', 'S', 'D2'), // half sib of Doe: 12.5%
    A('Polled', 'male', undefined, undefined, { traits: ['polled'] }),
    A('Out1', 'male'), A('Out2', 'male'),
  ];
  const p = new Pedigree(animals);
  const { suggestions, excluded } = suggestMates(p, 'Doe', animals, goats, new Map());
  assert.deepEqual(suggestions.map((s) => s.sireId).sort(), ['Out1', 'Out2'], 'only the unrelated, non-polled males');
  assert.ok(excluded.some((e) => e.sireId === 'HalfBro' && /12\.5%/.test(e.reason)));
  assert.ok(excluded.some((e) => e.sireId === 'S' && /25\.0%/.test(e.reason)));
  assert.ok(excluded.some((e) => e.sireId === 'Polled' && /polled/.test(e.reason)));
  assert.ok(suggestions.every((s) => s.coi < COI_DEFAULT_LIMIT));
  assert.match(suggestions[0]!.why, /COI 0\.0%/);
  // Never for pets.
  assert.equal(suggestMates(new Pedigree([{ ...A('Rex', 'female'), speciesId: 'household:dog' }]), 'Rex', [], undefined, new Map()).suggestions.length, 0);
});

test('merit from milk records ranks the better sire first, shown as a range with a confidence word', () => {
  const goats = animalById('dairy_goats')!;
  const trait = meritTrait(goats)!;
  assert.equal(trait.trait, 'milk yield');
  assert.equal(trait.h2, 0.18, 'the lower end of the cited heritability');
  // Two sires' daughters; Good's daughters milk 20% above the group average two years running.
  const animals = [
    A('Good', 'male'), A('Plain', 'male'), A('M1', 'female'), A('M2', 'female'),
    A('GoodDau', 'female', 'Good', 'M1'), A('PlainDau', 'female', 'Plain', 'M2'),
    A('Doe', 'female'),
  ];
  const milk = (id: string, y: string, v: number): AnimalLog => ({ id: `${id}${y}`, animalId: id, date: `${y}-06-01`, kind: 'milk', value: v, unit: 'lb' });
  const logs = [milk('GoodDau', '2025', 1200), milk('PlainDau', '2025', 800), milk('GoodDau', '2026', 1200), milk('PlainDau', '2026', 800)];
  const p = new Pedigree(animals);
  const merit = estimateMerit(p, animals, logs, trait.trait, trait.h2);
  const gd = merit.get('GoodDau')!;
  assert.ok(gd.pct > 0 && gd.low < gd.pct && gd.high > gd.pct);
  assert.match(gd.label, /very rough estimate: 2 records/);
  // GoodDau's own merit carries into her suggestions (Plain is unrelated to her; Good is her sire, 25%).
  const s = suggestMates(p, 'GoodDau', animals, goats, merit);
  assert.deepEqual(s.suggestions.map((x) => x.sireId), ['Plain']);
  assert.ok(s.suggestions.length >= 1);
  assert.match(s.suggestions[0]!.why, /Expected milk \+/);
});

test('herd trend warns when average COI rises about 1% or more per generation', () => {
  const animals = [
    A('S', 'male'), A('D1', 'female'), A('D2', 'female'), A('D3', 'female'),
    A('X1', 'male', 'S', 'D1'), A('X2', 'female', 'S', 'D2'), A('X3', 'female', 'S', 'D3'),
    A('Y1', 'female', 'X1', 'X2'), A('Y2', 'female', 'X1', 'X3'), // half-sib matings: 12.5%
  ];
  const t = herdInbreedingTrend(new Pedigree(animals), animals);
  assert.ok(t.deltaF! > 0.1);
  assert.match(t.warning!, /unrelated breeding stock/);
  const flat = [A('a', 'male'), A('b', 'female'), A('c', 'female', 'a', 'b'), A('d', 'male', 'a', 'b')];
  assert.equal(herdInbreedingTrend(new Pedigree(flat), flat).warning, null);
});
