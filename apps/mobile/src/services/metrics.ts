/**
 * On-device usage metrics and error log (§10 analytics, consent-gated). Off until the user opts in in
 * Settings. Nothing is sent anywhere: the counts and the error log stay on this phone, and the user can
 * view, share (system share sheet) or clear them. Crash reports beyond this come only from the OS's own
 * opt-in reports to App Store Connect / Play Console.
 */
import { appendError, countEvent, errorEntry, sanitizeEvent, type AnalyticsEvent, type ErrorLogEntry, type MetricCounts } from '@plotwright/core';
import { kvGet, kvSet } from '../db/database';

const CONSENT_KEY = 'metrics.consent';
const COUNTS_KEY = 'metrics.counts';
const ERRORS_KEY = 'metrics.errors';

let consent: boolean | undefined;
let counts: MetricCounts = {};
let errors: ErrorLogEntry[] = [];
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const today = () => new Date().toISOString().slice(0, 10);

function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushMetrics();
  }, 5000);
}

export async function flushMetrics(): Promise<void> {
  if (!dirty || !consent) return;
  dirty = false;
  await kvSet(COUNTS_KEY, JSON.stringify(counts)).catch(() => undefined);
  await kvSet(ERRORS_KEY, JSON.stringify(errors)).catch(() => undefined);
}

export async function initMetrics(): Promise<void> {
  consent = (await kvGet(CONSENT_KEY)) === 'granted';
  if (!consent) return;
  try {
    counts = JSON.parse((await kvGet(COUNTS_KEY)) ?? '{}') as MetricCounts;
    errors = JSON.parse((await kvGet(ERRORS_KEY)) ?? '[]') as ErrorLogEntry[];
  } catch {
    counts = {};
    errors = [];
  }
  installErrorHandler();
  track('app_open');
}

export const metricsConsent = () => consent === true;

export async function setMetricsConsent(on: boolean): Promise<void> {
  consent = on;
  await kvSet(CONSENT_KEY, on ? 'granted' : 'denied');
  if (!on) await clearMetrics();
  else installErrorHandler();
}

export async function clearMetrics(): Promise<void> {
  counts = {};
  errors = [];
  dirty = false;
  await kvSet(COUNTS_KEY, '{}');
  await kvSet(ERRORS_KEY, '[]');
}

/** Record an allowlisted event. Does nothing without consent or for events/values off the allowlist. */
export function track(name: AnalyticsEvent, params: Record<string, unknown> = {}): void {
  if (!consent) return;
  const ev = sanitizeEvent(name, params);
  if (!ev) return;
  counts = countEvent(counts, ev, today());
  scheduleFlush();
}

export function recordError(e: unknown, fatal = false): void {
  if (!consent) return;
  errors = appendError(errors, errorEntry(e, new Date(), fatal));
  track('error', { kind: e instanceof Error ? e.name : 'Error' });
  scheduleFlush();
  if (fatal) void flushMetrics();
}

let installed = false;
function installErrorHandler() {
  if (installed) return;
  const EU = (globalThis as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } }).ErrorUtils;
  if (!EU) return;
  installed = true;
  const prev = EU.getGlobalHandler();
  EU.setGlobalHandler((e, fatal) => {
    try { recordError(e, !!fatal); } catch { /* never let logging crash the app */ }
    prev(e, fatal);
  });
}

/** A plain-text report the user can read or share. */
export function metricsReport(): string {
  const days = Object.keys(counts).sort().reverse();
  const lines = ['Plotwright on-device usage statistics (never sent automatically)', ''];
  for (const d of days) {
    lines.push(d);
    for (const [k, n] of Object.entries(counts[d]!).sort()) lines.push(`  ${k}: ${n}`);
  }
  lines.push('', `Errors (last ${errors.length})`);
  for (const e of [...errors].reverse()) lines.push(`${e.at} ${e.fatal ? 'FATAL ' : ''}${e.kind}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`);
  return lines.join('\n');
}
