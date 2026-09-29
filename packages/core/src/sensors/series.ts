/**
 * Time-series handling for sensor readings: daily and hourly aggregates in the parcel's local time,
 * rolling-mean smoothing, rain-counter increments, stale-sensor detection, and blending measured soil
 * temperature into the modeled soil curve used by the planting calendar.
 */
import type { Metric, Reading } from './types';

export interface MetricDay {
  min: number;
  max: number;
  mean: number;
  n: number;
  last: number;
  /** Bitmask of local hours (bit h = hour h) with at least one reading: how much of the day is covered. */
  hm?: number;
}

export interface DayAggregate {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Day of year in local time (1–366). */
  doy: number;
  metrics: Partial<Record<Metric, MetricDay>>;
}

/** Minutes east of UTC: a fixed number, or a function of the UTC time (for daylight saving). */
export type Offset = number | ((utcMs: number) => number);
export const offsetAt = (o: Offset, t: number): number => (typeof o === 'number' ? o : o(t));

/** Number of distinct local hours covered. */
export function hoursCovered(m: MetricDay | undefined): number {
  let x = m?.hm ?? 0, n = 0;
  while (x) (n += x & 1), (x >>>= 1);
  return n;
}

/**
 * A day summary good enough to use as that day's min/max: ≥ 18 local hours with readings, including
 * the small hours (2–7 am) when the minimum usually happens.
 */
export function fullDay(m: MetricDay | undefined): boolean {
  return !!m && hoursCovered(m) >= 18 && ((m.hm ?? 0) & 0b11111100) !== 0;
}

/** Combine partial summaries of the same day (e.g. from two phones that each heard a sensor). */
export function mergeMetricDays(parts: MetricDay[]): MetricDay | undefined {
  if (!parts.length) return undefined;
  const n = parts.reduce((s, p) => s + p.n, 0);
  return {
    min: Math.min(...parts.map((p) => p.min)), max: Math.max(...parts.map((p) => p.max)),
    mean: n ? parts.reduce((s, p) => s + p.mean * p.n, 0) / n : parts[0]!.mean, n,
    last: parts[parts.length - 1]!.last, hm: parts.reduce((s, p) => s | (p.hm ?? 0), 0),
  };
}

export function mergeDayMetrics(parts: Array<DayAggregate['metrics']>): DayAggregate['metrics'] {
  const out: DayAggregate['metrics'] = {};
  const keys = new Set(parts.flatMap((p) => Object.keys(p))) as Set<Metric>;
  for (const k of keys) out[k] = mergeMetricDays(parts.map((p) => p[k]).filter((x): x is MetricDay => !!x));
  return out;
}

const DAY = 86_400_000;

/** Local date parts for a UTC time and an offset (minutes east of UTC, e.g. −240 for EDT). */
export function localDate(t: number, offset: Offset): { date: string; doy: number; hour: number } {
  const d = new Date(t + offsetAt(offset, t) * 60_000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const doy = Math.floor((Date.UTC(y, m, day) - Date.UTC(y, 0, 0)) / DAY);
  return { date: `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, doy, hour: d.getUTCHours() };
}

/** Daily min/max/mean per metric, with hour coverage. Suspect readings are left out. */
export function dailyAggregates(readings: Reading[], offset: Offset): DayAggregate[] {
  const days = new Map<string, DayAggregate>();
  const sorted = [...readings].sort((a, b) => a.t - b.t);
  for (const r of sorted) {
    if (r.quality === 'suspect') continue;
    const { date, doy, hour } = localDate(r.t, offset);
    const agg = days.get(date) ?? { date, doy, metrics: {} };
    days.set(date, agg);
    const m = agg.metrics[r.metric];
    if (!m) agg.metrics[r.metric] = { min: r.value, max: r.value, mean: r.value, n: 1, last: r.value, hm: 1 << hour };
    else {
      m.min = Math.min(m.min, r.value);
      m.max = Math.max(m.max, r.value);
      m.mean += (r.value - m.mean) / ++m.n;
      m.last = r.value;
      m.hm = (m.hm ?? 0) | (1 << hour);
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Hourly means for one metric, as [hourStartUtcMs, mean]. */
export function hourlyMeans(readings: Reading[], metric: Metric): Array<[number, number]> {
  const b = new Map<number, [number, number]>();
  for (const r of readings) {
    if (r.metric !== metric || r.quality === 'suspect') continue;
    const h = Math.floor(r.t / 3_600_000) * 3_600_000;
    const x = b.get(h) ?? [0, 0];
    x[0] += r.value; x[1]++;
    b.set(h, x);
  }
  return [...b.entries()].sort((a, c) => a[0] - c[0]).map(([h, [s, n]]) => [h, s / n]);
}

/** Trailing rolling mean over `windowMs` (smooths humidity sensors' jitter). Input must be one metric. */
export function rollingMean(readings: Reading[], windowMs = 15 * 60_000): Reading[] {
  const s = [...readings].sort((a, b) => a.t - b.t);
  const out: Reading[] = [];
  let lo = 0, sum = 0;
  for (let i = 0; i < s.length; i++) {
    sum += s[i]!.value;
    while (s[lo]!.t < s[i]!.t - windowMs) sum -= s[lo++]!.value;
    out.push({ ...s[i]!, value: sum / (i - lo + 1) });
  }
  return out;
}

/** Positive increments of a cumulative rain counter; a drop means the counter reset (new value is the increment). */
export function counterIncrements(readings: Reading[]): Reading[] {
  const s = [...readings].sort((a, b) => a.t - b.t);
  const out: Reading[] = [];
  for (let i = 1; i < s.length; i++) {
    const d = s[i]!.value - s[i - 1]!.value;
    out.push({ ...s[i]!, value: d >= 0 ? d : s[i]!.value });
  }
  return out;
}

export type Freshness = 'fresh' | 'late' | 'stale' | 'never';

/**
 * How current a sensor is. `expectedMs` is its normal reporting interval: stations every 1–5 min;
 * Bluetooth sensors only when the app scans, so their interval is how often the user opens it.
 */
export function freshness(lastT: number | undefined, now: number, expectedMs: number): Freshness {
  if (lastT === undefined) return 'never';
  const age = now - lastT;
  return age <= 3 * expectedMs ? 'fresh' : age <= 24 * expectedMs ? 'late' : 'stale';
}

// ---------------- Soil temperature: measured → regional → modeled ----------------

/**
 * Soil temperature function (°F by day of year) for the calendar: measured daily means on measured
 * days; for the days just after the last measurement, the model shifted by the recent measured-minus-
 * model bias, fading back to the model over `fadeDays`; the model everywhere else. `measured` must be
 * in chronological order (it may wrap past New Year); only the recent window should be passed.
 */
export function blendSoilCurve(modelF: (doy: number) => number, measured: Array<{ doy: number; meanF: number }>, fadeDays = 30): (doy: number) => number {
  if (!measured.length) return modelF;
  const byDoy = new Map(measured.map((m) => [m.doy, m.meanF]));
  const last = measured[measured.length - 1]!.doy;
  const recent = measured.slice(-14);
  const bias = recent.reduce((s, m) => s + (m.meanF - modelF(m.doy)), 0) / recent.length;
  return (doy: number) => {
    const m = byDoy.get(doy);
    if (m !== undefined) return m;
    const ahead = (doy - last + 365) % 365; // days after the last measurement, around the year
    return modelF(doy) + bias * Math.max(0, 1 - ahead / fadeDays);
  };
}

// ---------------- Frost at your own low spot ----------------

/**
 * How much colder a sensor runs than the forecast on nights both exist: median of (observed overnight
 * minimum − forecast low), °C. Needs at least `minNights`; negative means the spot is colder.
 */
export function forecastOffsetC(pairs: Array<{ forecastLowC: number; observedMinC: number }>, minNights = 5): number | null {
  if (pairs.length < minNights) return null;
  const d = pairs.map((p) => p.observedMinC - p.forecastLowC).sort((a, b) => a - b);
  const mid = Math.floor(d.length / 2);
  return d.length % 2 ? d[mid]! : (d[mid - 1]! + d[mid]!) / 2;
}

// ---------------- Threshold alerts (greenhouse, cold frame, frost at a sensor) ----------------

export interface Thresholds {
  minC?: number;
  maxC?: number;
  maxRhPct?: number;
  minSoilMoisturePct?: number;
}

export interface ThresholdBreach {
  metric: Metric;
  value: number;
  limit: number;
  kind: 'below' | 'above';
}

export function checkThresholds(latest: Partial<Record<Metric, number>>, th: Thresholds): ThresholdBreach[] {
  const out: ThresholdBreach[] = [];
  const t = latest.temperature, rh = latest.humidity, sm = latest.soilMoisture;
  if (t !== undefined && th.minC !== undefined && t < th.minC) out.push({ metric: 'temperature', value: t, limit: th.minC, kind: 'below' });
  if (t !== undefined && th.maxC !== undefined && t > th.maxC) out.push({ metric: 'temperature', value: t, limit: th.maxC, kind: 'above' });
  if (rh !== undefined && th.maxRhPct !== undefined && rh > th.maxRhPct) out.push({ metric: 'humidity', value: rh, limit: th.maxRhPct, kind: 'above' });
  if (sm !== undefined && th.minSoilMoisturePct !== undefined && sm < th.minSoilMoisturePct) out.push({ metric: 'soilMoisture', value: sm, limit: th.minSoilMoisturePct, kind: 'below' });
  return out;
}
