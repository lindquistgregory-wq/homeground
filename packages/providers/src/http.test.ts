import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, MemoryCache } from './http';
import { testClient } from './testing';

test('sends a descriptive User-Agent and caches with TTL', async () => {
  let t = 1_000;
  const cache = new MemoryCache();
  const { http, calls } = testClient([{ match: /example\.gov/, body: { a: 1 } }], { cache, now: () => t });
  const r1 = await http.json<{ a: number }>('https://example.gov/x', { ttlMs: 100 });
  assert.equal(r1.data.a, 1);
  assert.equal(r1.fromCache, false);
  assert.match(calls[0]!.headers['User-Agent']!, /^Homeground/);
  const r2 = await http.json('https://example.gov/x', { ttlMs: 100 });
  assert.equal(r2.fromCache, true);
  assert.equal(calls.length, 1);
  t += 200; // expired
  await http.json('https://example.gov/x', { ttlMs: 100 });
  assert.equal(calls.length, 2);
});

test('retries 503 with backoff, then succeeds', async () => {
  const { http, calls, sleeps } = testClient([{ match: /flaky/, body: 'ok', failTimes: 2, failStatus: 503 }]);
  const r = await http.text('https://flaky.gov/');
  assert.equal(r.data, 'ok');
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('honours Retry-After on 429', async () => {
  const { http, sleeps } = testClient([{ match: /busy/, body: 'ok', failTimes: 1, failStatus: 429, headers: { 'retry-after': '7' } }]);
  await http.text('https://busy.gov/');
  assert.deepEqual(sleeps, [7000]);
});

test('does not retry 4xx; throws HttpError', async () => {
  const { http, calls } = testClient([{ match: /bad/, status: 400, body: 'nope' }]);
  await assert.rejects(http.text('https://bad.gov/'), (e: unknown) => e instanceof HttpError && e.status === 400 && !e.retryable);
  assert.equal(calls.length, 1);
});

test('serves stale cache when the network fails (offline)', async () => {
  let t = 0;
  const cache = new MemoryCache();
  let online = true;
  const { http } = testClient(
    [{ match: (u) => online && /api/.test(u), body: { v: 'cached' } }],
    { cache, now: () => t },
  );
  await http.json('https://api.gov/p', { ttlMs: 10 });
  online = false;
  t = 1000;
  const r = await http.json<{ v: string }>('https://api.gov/p', { ttlMs: 10, maxAttempts: 1 });
  assert.equal(r.stale, true);
  assert.equal(r.data.v, 'cached');
});

test('Nominatim requests are spaced ≥1.1 s apart', async () => {
  let t = 0;
  const { http, sleeps } = testClient([{ match: /nominatim/, body: [] }], { now: () => t });
  await http.json('https://nominatim.openstreetmap.org/search?q=a');
  t += 100;
  await http.json('https://nominatim.openstreetmap.org/search?q=b');
  assert.deepEqual(sleeps, [1000]);
});
