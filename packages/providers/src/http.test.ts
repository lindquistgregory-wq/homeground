import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, HttpError, MemoryCache } from './http';
import { testClient } from './testing';

test('sends a descriptive User-Agent and caches with TTL', async () => {
  let t = 1_000;
  const cache = new MemoryCache();
  const { http, calls } = testClient([{ match: /example\.gov/, body: { a: 1 } }], { cache, now: () => t });
  const r1 = await http.json<{ a: number }>('https://example.gov/x', { ttlMs: 100 });
  assert.equal(r1.data.a, 1);
  assert.equal(r1.fromCache, false);
  assert.match(calls[0]!.headers['User-Agent']!, /^Plotwright/);
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

test('a request our timeout aborts says the host was slow, not that the network failed', async () => {
  // A fetch that never answers until it is aborted.
  const hang = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<never>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  const http = new HttpClient({ fetch: hang as never, userAgent: 'Plotwright/test', defaultTimeoutMs: 10, sleep: async () => {} });
  await assert.rejects(http.text('https://slow.gov/q', { maxAttempts: 1 }), (e: unknown) =>
    e instanceof HttpError && e.message === 'slow.gov took too long to respond' && e.retryable);
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

test('per-host concurrency cap holds when new requests race a release', async () => {
  let inFlight = 0, peak = 0;
  const gates: Array<() => void> = [];
  const http = new HttpClient({
    userAgent: 'test',
    sleep: async () => {},
    hostPolicies: { 'one.gov': { maxConcurrent: 1 } },
    fetch: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => gates.push(r));
      inFlight--;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' };
    },
  });
  void http.text('https://one.gov/1');
  void http.text('https://one.gov/2'); // queued
  await new Promise((r) => setTimeout(r, 5));
  gates.shift()!();
  // Start a new request on every microtask hop so one lands between release() and the waiter resuming.
  let k = 0;
  const spin = () => {
    if (k++ < 30) {
      void http.text(`https://one.gov/n${k}`);
      queueMicrotask(spin);
    }
  };
  queueMicrotask(spin);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(peak, 1);
  while (gates.length) gates.shift()!();
});
