/**
 * The single HTTP path for every free public API (§0 rule 5 "be a good citizen"):
 *  - descriptive User-Agent with contact info (NWS, Nominatim require it)
 *  - per-host minimum spacing and concurrency (Nominatim ≤1 req/s; SDA is a single-threaded server)
 *  - retries with exponential backoff on network errors, 429 and 5xx, honouring Retry-After
 *  - on-device cache with TTL, and stale-if-error so cached Site Profiles work offline
 * `fetch` is injected so tests use recorded fixtures and the app uses React Native's fetch.
 */

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export interface CacheEntry {
  value: string;
  storedAt: number;
  expiresAt: number;
}
export interface KeyValueCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

export class MemoryCache implements KeyValueCache {
  private map = new Map<string, CacheEntry>();
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, entry: CacheEntry) {
    this.map.set(key, entry);
  }
  get size() {
    return this.map.size;
  }
}

export interface HostPolicy {
  /** Minimum milliseconds between request starts to this host. */
  minIntervalMs?: number;
  /** Maximum simultaneous in-flight requests to this host. */
  maxConcurrent?: number;
}

/** Defaults that encode each service's published usage policy. */
export const DEFAULT_HOST_POLICIES: Record<string, HostPolicy> = {
  'nominatim.openstreetmap.org': { minIntervalMs: 1100, maxConcurrent: 1 },
  'sdmdataaccess.sc.egov.usda.gov': { minIntervalMs: 250, maxConcurrent: 1 },
  'sdmdataaccess.nrcs.usda.gov': { minIntervalMs: 250, maxConcurrent: 1 },
  'epqs.nationalmap.gov': { maxConcurrent: 2 },
  'www.ncei.noaa.gov': { maxConcurrent: 2 },
  'api.weather.gov': { maxConcurrent: 2 },
  'hazards.fema.gov': { maxConcurrent: 2 },
};

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Cache lifetime. 0 or undefined = do not cache. */
  ttlMs?: number;
  /** Override the cache key (defaults to method + url + body). */
  cacheKey?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Validate a body before it is returned or cached; throw to reject it. */
  accept?: (body: string) => void;
}

export interface HttpResult<T> {
  data: T;
  /** True when served from cache (fresh or stale). */
  fromCache: boolean;
  /** True when the network failed and an expired cache entry was used. */
  stale: boolean;
  storedAt: number;
}

export interface HttpClientOptions {
  fetch: FetchLike;
  /** e.g. "Homeground/0.1 (+https://github.com/…; contact@…)" */
  userAgent: string;
  cache?: KeyValueCache;
  hostPolicies?: Record<string, HostPolicy>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  defaultTimeoutMs?: number;
}

interface HostState {
  lastStart: number;
  inFlight: number;
  queue: Array<() => void>;
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return (m?.[1] ?? '').toLowerCase();
}

export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly cache?: KeyValueCache;
  private readonly policies: Record<string, HostPolicy>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly hosts = new Map<string, HostState>();
  readonly userAgent: string;
  private readonly defaultTimeoutMs: number;

  constructor(opts: HttpClientOptions) {
    this.fetchImpl = opts.fetch;
    this.userAgent = opts.userAgent;
    this.cache = opts.cache;
    this.policies = { ...DEFAULT_HOST_POLICIES, ...(opts.hostPolicies ?? {}) };
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 20_000;
  }

  /**
   * A view of this client that skips *fresh* cache entries (used by "Refresh") but still writes the
   * cache and shares the same per-host rate limits.
   */
  fresh(): HttpClient {
    const view = Object.create(this) as HttpClient;
    (view as unknown as { ignoreFreshCache: boolean }).ignoreFreshCache = true;
    return view;
  }
  private ignoreFreshCache = false;

  /**
   * GET/POST expecting JSON. The body is validated *before* it is cached: invalid JSON, and ArcGIS-style
   * `{"error": …}` payloads that arrive with HTTP 200, are rejected and never stored.
   */
  async json<T>(url: string, opts: RequestOptions = {}): Promise<HttpResult<T>> {
    let parsed: T | undefined;
    const res = await this.text(url, {
      ...opts,
      accept: (body) => {
        let d: unknown;
        try {
          d = JSON.parse(body);
        } catch {
          throw new HttpError(`Invalid JSON from ${hostOf(url)}`, null, true, url);
        }
        if (d && typeof d === 'object' && !Array.isArray(d) && 'error' in d && (d as { error: unknown }).error) {
          const e = (d as { error: { message?: string; code?: number } | string }).error;
          const msg = typeof e === 'string' ? e : e?.message ?? `code ${e?.code ?? '?'}`;
          throw new HttpError(`${hostOf(url)} reported an error: ${msg}`, null, true, url);
        }
        opts.accept?.(body);
        parsed = d as T;
      },
    });
    return { ...res, data: parsed ?? (JSON.parse(res.data) as T) };
  }

  async text(url: string, opts: RequestOptions = {}): Promise<HttpResult<string>> {
    const method = opts.method ?? 'GET';
    const key = opts.cacheKey ?? `${method} ${url} ${opts.body ?? ''}`;
    const ttl = opts.ttlMs ?? 0;
    const cached = ttl > 0 && this.cache ? await this.cache.get(key) : undefined;
    if (cached && cached.expiresAt > this.now() && !this.ignoreFreshCache) {
      try {
        opts.accept?.(cached.value);
        return { data: cached.value, fromCache: true, stale: false, storedAt: cached.storedAt };
      } catch {
        /* a bad entry from an older app version: refetch */
      }
    }
    try {
      const body = await this.fetchWithRetry(url, method, opts);
      opts.accept?.(body); // throws before anything is cached
      if (ttl > 0 && this.cache) {
        const storedAt = this.now();
        await this.cache.set(key, { value: body, storedAt, expiresAt: storedAt + ttl });
      }
      return { data: body, fromCache: false, stale: false, storedAt: this.now() };
    } catch (err) {
      if (cached) {
        try {
          opts.accept?.(cached.value);
          return { data: cached.value, fromCache: true, stale: true, storedAt: cached.storedAt };
        } catch {
          /* fall through */
        }
      }
      throw err;
    }
  }

  private async fetchWithRetry(url: string, method: string, opts: RequestOptions): Promise<string> {
    const attempts = opts.maxAttempts ?? 3;
    let lastErr: HttpError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.fetchOnce(url, method, opts);
      } catch (e) {
        lastErr = e instanceof HttpError ? e : new HttpError(String((e as Error)?.message ?? e), null, true, url);
        if (!lastErr.retryable || attempt === attempts) break;
        const retryAfter = (lastErr as HttpError & { retryAfterMs?: number }).retryAfterMs;
        await this.sleep(retryAfter ?? 1000 * 2 ** (attempt - 1));
      }
    }
    throw lastErr!;
  }

  private async fetchOnce(url: string, method: string, opts: RequestOptions): Promise<string> {
    const host = hostOf(url);
    const release = await this.acquire(host);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? this.defaultTimeoutMs) : undefined;
    try {
      const headers: Record<string, string> = { 'User-Agent': this.userAgent, Accept: 'application/json', ...opts.headers };
      let res: FetchResponseLike;
      try {
        res = await this.fetchImpl(url, { method, headers, body: opts.body, signal: controller?.signal });
      } catch (e) {
        throw new HttpError(`Network error contacting ${host}`, null, true, url);
      }
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const err = new HttpError(`${host} returned HTTP ${res.status}`, res.status, retryable, url) as HttpError & {
          retryAfterMs?: number;
        };
        const ra = res.headers.get('retry-after');
        if (ra && /^\d+$/.test(ra)) err.retryAfterMs = Math.min(60_000, Number(ra) * 1000);
        throw err;
      }
      return await res.text();
    } finally {
      if (timer) clearTimeout(timer);
      release();
    }
  }

  private async acquire(host: string): Promise<() => void> {
    const policy = this.policies[host] ?? {};
    let st = this.hosts.get(host);
    if (!st) this.hosts.set(host, (st = { lastStart: -Infinity, inFlight: 0, queue: [] }));
    const state = st;
    const maxConc = policy.maxConcurrent ?? 4;
    if (state.inFlight >= maxConc) {
      // The releasing request hands its slot straight to us (inFlight is not decremented), so no
      // newcomer can slip in between the release and this waiter resuming.
      await new Promise<void>((resolve) => state.queue.push(resolve));
    } else {
      state.inFlight++;
    }
    const interval = policy.minIntervalMs ?? 0;
    if (interval > 0) {
      // Reserve our start time before sleeping so concurrent waiters space themselves correctly.
      const start = Math.max(this.now(), state.lastStart + interval);
      state.lastStart = start;
      const wait = start - this.now();
      if (wait > 0) await this.sleep(wait);
    } else state.lastStart = this.now();
    return () => {
      const next = state.queue.shift();
      if (next) next();
      else state.inFlight--;
    };
  }
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** Cache lifetimes by data kind (§11 "Caching & courtesy"). */
export const TTL = {
  static: 365 * DAY, // climate normals, zone table
  terrain: 180 * DAY, // DEM, soils, canopy, hydrography
  regulatory: 30 * DAY, // flood maps change with LOMRs
  parcel: 30 * DAY,
  geocode: 90 * DAY,
  forecast: 1 * HOUR,
} as const;
