import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OBJECT_LIBRARY, objectType } from '../design/library';
import { newObject, type DesignObject } from '../design/design';
import { localFrame, unproject } from '../geo/measure';
import { PLANTS } from '../plants/index';
import { IN_GROUND_KINDS, SAFETY_NOTES, TOXICITY, safetyNotesFor, safetyProximity, toxicityFor, type SafetyNote } from './index';

test('every safety note is complete and never calls anything safe', () => {
  for (const n of Object.values(SAFETY_NOTES) as SafetyNote[]) {
    assert.ok(n.headline.length > 10 && n.headline.length <= 140, n.id);
    assert.ok(!/\bsafe\b/i.test([n.headline, ...n.details].join(' ').replace(/safety/gi, '')), `${n.id} must not promise safety`);
    for (const s of n.sources) assert.match(s.url, /^https:\/\//, n.id);
  }
});

test('in-ground objects carry 811 first; the highest hazards ask for one acknowledgement', () => {
  for (const kind of IN_GROUND_KINDS) assert.ok(objectType(kind), `${kind} is a library object`);
  assert.equal(safetyNotesFor('pond')[0]!.id, 'dig811');
  assert.deepEqual(safetyNotesFor('pond').map((n) => n.id).sort(), ['dig811', 'drainage', 'pond']);
  assert.ok(safetyNotesFor('fence-electric').some((n) => n.id === 'electricFence'));
  assert.ok(safetyNotesFor('chicken-coop').some((n) => n.id === 'poultry'));
  assert.deepEqual(safetyNotesFor('raised-bed'), [], 'a raised bed sits on the ground: no note');
  assert.ok(safetyNotesFor('rain-barrel', { stateFips: '08' }).some((n) => n.id === 'coloradoRain'));
  assert.ok(!safetyNotesFor('rain-barrel', { stateFips: '37' }).some((n) => n.id === 'coloradoRain'));
  // Cautions come before notes.
  const levels = safetyNotesFor('greenhouse-hoop').map((n) => n.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => (a === b ? 0 : a === 'caution' ? -1 : 1)));
});

const frame = localFrame({ lat: 35.7, lon: -79.8 });
const at = (kind: string, x: number, y: number, id: string, patch: Partial<DesignObject> = {}): DesignObject => {
  const [lon, lat] = unproject(frame, [x, y]);
  return { ...newObject(kind, { lat: lat!, lon: lon! }, id), ...patch };
};

test('proximity: animals, manure and compost within 200 ft of a well are flagged', () => {
  const well = at('well', 0, 0, 'w');
  const near = safetyProximity([well, at('chicken-coop', 40, 0, 'c'), at('compost-bays', 0, 55, 'k'), at('chicken-coop', 80, 0, 'far'), at('beehive', 5, 5, 'b')], frame);
  const ids = near.filter((w) => w.kind === 'near-well').map((w) => w.objectId).sort();
  assert.deepEqual(ids, ['c', 'k'], 'the far coop (80 m) and the hive are not flagged');
  assert.match(near.find((w) => w.objectId === 'c')!.message, /200 ft/);
});

test('proximity: fences and structures near the boundary, trees that outgrow their spot, ponds in flood zones', () => {
  const ring = [[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]].map((p) => unproject(frame, p as [number, number]));
  const boundary = { type: 'Polygon', coordinates: [ring] } as const;
  const shed = at('tool-shed', 18, 0, 'shed');
  const tree = at('fruit-tree-std', 0, 0, 'tree');
  const house = at('building', 4, 0, 'house', { existing: true });
  const pond = at('pond', -10, -10, 'pond');
  const w = safetyProximity([shed, tree, house, pond], frame, { boundary: boundary as never, parcelInFloodZone: true });
  assert.ok(w.some((x) => x.objectId === 'shed' && x.kind === 'boundary-survey'));
  assert.ok(!w.some((x) => x.objectId === 'house' && x.kind === 'boundary-survey'), 'existing buildings are not flagged');
  assert.ok(w.some((x) => x.objectId === 'tree' && x.kind === 'tree-reach'));
  assert.ok(w.some((x) => x.objectId === 'pond' && x.kind === 'pond-flood'));
  assert.equal(safetyProximity([pond], frame, { parcelInFloodZone: false }).length, 0);
});

test('toxicity: every entry is a real plant with a source, and lines merge per animal', () => {
  const ids = new Set(PLANTS.map((p) => p.id));
  for (const [id, entries] of Object.entries(TOXICITY)) {
    assert.ok(ids.has(id), id);
    for (const e of entries) assert.ok(e.to.length && e.source, id);
  }
  const onion = toxicityFor('onion');
  assert.deepEqual(onion.map((l) => l.to), ['dogs', 'cats', 'horses']);
  assert.deepEqual(onion.find((l) => l.to === 'dogs')!.sources, ['aspca-dogs', 'aspca-foods']);
  assert.equal(toxicityFor('lettuce').length, 0);
  assert.equal(toxicityFor('rhubarb')[0]!.to, 'people');
  assert.ok(OBJECT_LIBRARY.some((o) => o.kind === 'well'));
});
