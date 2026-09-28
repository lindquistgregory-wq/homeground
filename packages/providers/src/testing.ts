/** Test helpers: a routed fake `fetch` that records calls. Not exported from the package index. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HttpClient, MemoryCache, type FetchLike } from './http';

export interface Route {
  match: RegExp | ((url: string, body?: string) => boolean);
  status?: number;
  /** Response body, or a function producing one per call. */
  body: unknown | ((url: string, body?: string) => unknown);
  headers?: Record<string, string>;
  /** Number of times this route should fail with `failStatus` before succeeding. */
  failTimes?: number;
  failStatus?: number;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export function fakeFetch(routes: Route[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fails = new Map<Route, number>();
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const route = routes.find((r) => (typeof r.match === 'function' ? r.match(url, init.body) : r.match.test(url)));
    if (!route) return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'not found' };
    const failed = fails.get(route) ?? 0;
    if (route.failTimes && failed < route.failTimes) {
      fails.set(route, failed + 1);
      const status = route.failStatus ?? 503;
      return { ok: false, status, headers: { get: (h) => route.headers?.[h.toLowerCase()] ?? null }, text: async () => '' };
    }
    const status = route.status ?? 200;
    const raw = typeof route.body === 'function' ? (route.body as (u: string, b?: string) => unknown)(url, init.body) : route.body;
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return { ok: status < 400, status, headers: { get: (h) => route.headers?.[h.toLowerCase()] ?? null }, text: async () => text };
  };
  return { fetch, calls };
}

export function testClient(routes: Route[], opts: { cache?: MemoryCache; now?: () => number } = {}) {
  const { fetch, calls } = fakeFetch(routes);
  const sleeps: number[] = [];
  const http = new HttpClient({
    fetch,
    userAgent: 'Plotwright-test/0.0 (+https://example.invalid)',
    cache: opts.cache ?? new MemoryCache(),
    now: opts.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { http, calls, sleeps };
}

const here = dirname(fileURLToPath(import.meta.url));
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(here, '__fixtures__', name), 'utf8'));
}
