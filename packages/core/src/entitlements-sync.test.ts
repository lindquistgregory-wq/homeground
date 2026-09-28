import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_IDS, canShowAdOn, resolveEntitlements, resolveTier } from './entitlements';
import {
  HybridClock, compareHlc, decodeHlc, encodeHlc, mergeRecord, syncOnce,
  type ChangeBatch, type CloudTransport, type LocalStore, type SyncRecord,
} from './sync';

const NOW = new Date('2026-10-01T00:00:00Z');

test('tier resolution picks the highest active product', () => {
  assert.equal(resolveTier([], NOW), 'free');
  assert.equal(resolveTier([{ productId: PRODUCT_IDS.growerAnnual, expiresAt: '2027-01-01T00:00:00Z' }], NOW), 'grower');
  assert.equal(
    resolveTier([
      { productId: PRODUCT_IDS.growerAnnual, expiresAt: '2027-01-01T00:00:00Z' },
      { productId: PRODUCT_IDS.proLifetime },
    ], NOW),
    'pro',
  );
  assert.equal(resolveTier([{ productId: PRODUCT_IDS.proMonthly, expiresAt: '2026-09-01T00:00:00Z' }], NOW), 'free', 'expired');
  assert.equal(resolveTier([{ productId: PRODUCT_IDS.proMonthly, expiresAt: '2026-09-01T00:00:00Z', inGracePeriod: true }], NOW), 'pro', 'grace');
  assert.equal(resolveTier([{ productId: PRODUCT_IDS.proLifetime, revoked: true }], NOW), 'free', 'refunded');
  assert.equal(resolveTier([{ productId: 'unknown.product' }], NOW), 'free');
});

test('feature gates, limits and ad rules', () => {
  const free = resolveEntitlements([], { now: NOW });
  assert.equal(free.showAds, true);
  assert.equal(free.limits.parcels, 1);
  assert.equal(free.has('sun.heatmaps'), false);
  assert.equal(canShowAdOn('plant-library', free), true);
  assert.equal(canShowAdOn('design', free), false, 'never on the design canvas');
  assert.equal(canShowAdOn('planner-chat', free), false, 'never in AI chat');

  const grower = resolveEntitlements([{ productId: PRODUCT_IDS.growerMonthly, expiresAt: '2026-11-01T00:00:00Z' }], { now: NOW });
  assert.equal(grower.showAds, false);
  assert.equal(grower.has('sun.heatmaps'), true);
  assert.equal(grower.has('layers.canopyShade'), false);

  const pro = resolveEntitlements([{ productId: PRODUCT_IDS.proAnnual, expiresAt: '2027-10-01T00:00:00Z' }], { now: NOW });
  assert.equal(pro.has('planner.income'), true);
  assert.equal(pro.limits.bleSensors, Infinity);
});

test('rewarded unlock grants one feature for its window only', () => {
  const ent = resolveEntitlements([], {
    now: NOW,
    rewarded: [
      { feature: 'export.pdf', expiresAt: '2026-10-01T12:00:00Z' },
      { feature: 'sun.heatmaps', expiresAt: '2026-09-30T12:00:00Z' },
    ],
  });
  assert.equal(ent.has('export.pdf'), true);
  assert.equal(ent.has('sun.heatmaps'), false);
});

test('open-source model: everything unlocked, ads unless removed', () => {
  const os = resolveEntitlements([], { model: 'openSource', now: NOW });
  assert.equal(os.has('planner.income'), true);
  assert.equal(os.showAds, true);
  const paid = resolveEntitlements([{ productId: PRODUCT_IDS.removeAds }], { model: 'openSource', now: NOW });
  assert.equal(paid.showAds, false);
});

test('HLC stamps are monotonic and sortable', () => {
  let t = 1000;
  const clock = new HybridClock('A', () => t);
  const a = clock.tick();
  const b = clock.tick(); // same ms → counter bump
  t = 999; // wall clock goes backwards
  const c = clock.tick();
  assert.ok(compareHlc(a, b) < 0 && compareHlc(b, c) < 0);
  assert.deepEqual(decodeHlc(encodeHlc({ ms: 5, counter: 40, node: 'x:y' })), { ms: 5, counter: 40, node: 'x:y' });
  clock.receive(encodeHlc({ ms: 5000, counter: 3, node: 'B' }));
  assert.ok(decodeHlc(clock.tick()).ms >= 5000);
});

test('last-writer-wins merge with tombstones', () => {
  const older: SyncRecord = { collection: 'parcels', id: 'p1', hlc: encodeHlc({ ms: 1, counter: 0, node: 'A' }), deleted: false, data: { name: 'old' } };
  const newer: SyncRecord = { ...older, hlc: encodeHlc({ ms: 2, counter: 0, node: 'B' }), deleted: true, data: null };
  assert.equal(mergeRecord(older, newer), newer);
  assert.equal(mergeRecord(newer, older), newer);
  assert.equal(mergeRecord(undefined, older), older);
});

class MemStore implements LocalStore {
  records = new Map<string, SyncRecord>();
  pending = new Map<string, SyncRecord>();
  cursor: string | null = null;
  key = (c: string, id: string) => `${c}/${id}`;
  async get(c: SyncRecord['collection'], id: string) { return this.records.get(this.key(c, id)); }
  async applyRemote(r: SyncRecord) { this.records.set(this.key(r.collection, r.id), r); }
  localWrite(r: SyncRecord) { this.records.set(this.key(r.collection, r.id), r); this.pending.set(this.key(r.collection, r.id), r); }
  async pendingChanges() { return [...this.pending.values()]; }
  async markUploaded(rs: SyncRecord[]) { for (const r of rs) this.pending.delete(this.key(r.collection, r.id)); }
  async getCursor() { return this.cursor; }
  async setCursor(c: string | null) { this.cursor = c; }
}

class MemCloud implements CloudTransport {
  batches: ChangeBatch[] = [];
  async isAvailable() { return true; }
  async upload(b: ChangeBatch) { this.batches.push(b); }
  async listSince(cursor: string | null) {
    const start = cursor ? Number(cursor) : 0;
    return { batches: this.batches.slice(start), cursor: String(this.batches.length) };
  }
}

test('two devices converge through the user cloud', async () => {
  const cloud = new MemCloud();
  let t = 100;
  const clockA = new HybridClock('A', () => t), clockB = new HybridClock('B', () => t);
  const a = new MemStore(), b = new MemStore();
  let n = 0;
  const id = () => `batch-${n++}`;

  a.localWrite({ collection: 'parcels', id: 'p1', hlc: clockA.tick(), deleted: false, data: { name: 'Home' } });
  assert.deepEqual(await syncOnce('A', clockA, a, cloud, id), { uploaded: 1, applied: 0, skipped: 0 });

  const rb = await syncOnce('B', clockB, b, cloud, id);
  assert.deepEqual(rb, { uploaded: 0, applied: 1, skipped: 0 });
  assert.deepEqual((await b.get('parcels', 'p1'))?.data, { name: 'Home' });
  assert.equal((await b.pendingChanges()).length, 0, 'remote records must not be re-uploaded');

  // Concurrent edits: B's edit happens later in HLC order and should win on both devices.
  t = 200;
  a.localWrite({ collection: 'parcels', id: 'p1', hlc: clockA.tick(), deleted: false, data: { name: 'A-edit' } });
  t = 201;
  b.localWrite({ collection: 'parcels', id: 'p1', hlc: clockB.tick(), deleted: false, data: { name: 'B-edit' } });
  await syncOnce('A', clockA, a, cloud, id);
  await syncOnce('B', clockB, b, cloud, id);
  await syncOnce('A', clockA, a, cloud, id);
  assert.deepEqual((await a.get('parcels', 'p1'))?.data, { name: 'B-edit' });
  assert.deepEqual((await b.get('parcels', 'p1'))?.data, { name: 'B-edit' });
});
