/**
 * Consent-gated, on-device-only usage metrics (§10, §11). Nothing leaves the phone: counts are kept
 * locally, and the user can look at them or share them. Firebase Analytics/Crashlytics would need a
 * project API key shipped inside the app, which the no-shared-keys rule forbids, so crash reports come
 * from the stores' own opt-in reports (App Store Connect / Xcode Organizer, Play Console Android vitals)
 * plus a local error log the user can export.
 *
 * Only allowlisted events and parameter values are recorded: never location, parcel, sensor or
 * free text.
 */

export const ANALYTICS_EVENTS = {
  app_open: [],
  screen_view: ['screen'],
  paywall_view: ['source'],
  purchase_started: ['product'],
  purchase_completed: ['product'],
  purchase_failed: ['reason'],
  restore: ['result'],
  feature_gate: ['feature'],
  rewarded_unlock: ['feature'],
  plan_built: [],
  export: ['format'],
  offline_pack: ['result'],
  scenario_created: [],
  error: ['kind'],
} as const satisfies Record<string, readonly string[]>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;

/** Screen names (route segments without ids). */
export const SCREENS = new Set([
  'home', 'locate', 'boundary', 'profile', 'design', 'sun', 'plants', 'plant-guide', 'garden', 'calendar',
  'sensors', 'sensor', 'sensor-scan', 'sensor-import', 'station', 'planner', 'settings', 'paywall', 'data-sources', 'offline',
]);

/** A value is a short identifier: letters, digits, dot, dash, underscore; no numbers that could be coordinates. */
const SAFE_VALUE = /^[a-z][a-z0-9._-]{0,47}$/i;

export function sanitizeEvent(name: string, params: Record<string, unknown> = {}): { name: AnalyticsEvent; params: Record<string, string> } | null {
  if (!(name in ANALYTICS_EVENTS)) return null;
  const allowed = ANALYTICS_EVENTS[name as AnalyticsEvent] as readonly string[];
  const out: Record<string, string> = {};
  for (const k of allowed) {
    const v = params[k];
    if (typeof v !== 'string' || !SAFE_VALUE.test(v) || /\d+\.\d+/.test(v)) continue;
    if (k === 'screen' && !SCREENS.has(v)) continue;
    out[k] = v;
  }
  return { name: name as AnalyticsEvent, params: out };
}

/** Local daily counters: { 'YYYY-MM-DD': { 'screen_view:plants': 3, ... } }. */
export type MetricCounts = Record<string, Record<string, number>>;

export const METRIC_RETENTION_DAYS = 90;

export function countEvent(counts: MetricCounts, ev: { name: string; params: Record<string, string> }, day: string): MetricCounts {
  const key = [ev.name, ...Object.keys(ev.params).sort().map((k) => ev.params[k])].join(':');
  const today = { ...(counts[day] ?? {}) };
  today[key] = (today[key] ?? 0) + 1;
  const next: MetricCounts = { ...counts, [day]: today };
  // Keep only the most recent days.
  const days = Object.keys(next).sort();
  for (const d of days.slice(0, Math.max(0, days.length - METRIC_RETENTION_DAYS))) delete next[d];
  return next;
}

/**
 * Remove anything personal from an error message or stack before it's stored: emails, URLs' query
 * strings, coordinate-like decimals, long digit runs (ids, phone numbers) and file paths' user folders.
 */
export function scrubText(s: string, max = 500): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, '$1?[…]')
    .replace(/-?\d{1,3}\.\d{3,}/g, '[num]')
    .replace(/\d{6,}/g, '[num]')
    .replace(/\/(Users|home|var\/mobile\/Containers\/Data\/Application)\/[^/\s]+/g, '/$1/[…]')
    .slice(0, max);
}

export interface ErrorLogEntry {
  at: string;
  kind: string;
  message: string;
  stack?: string;
  fatal?: boolean;
}

export const ERROR_LOG_MAX = 50;

export function errorEntry(e: unknown, at: Date, fatal = false): ErrorLogEntry {
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'Unknown error');
  const stack = err.stack ? scrubText(err.stack.split('\n').slice(0, 6).join('\n'), 800) : undefined;
  return { at: at.toISOString(), kind: scrubText(err.name || 'Error', 40), message: scrubText(err.message || ''), stack, fatal: fatal || undefined };
}

export function appendError(log: ErrorLogEntry[], e: ErrorLogEntry): ErrorLogEntry[] {
  return [...log, e].slice(-ERROR_LOG_MAX);
}
