/**
 * Every derived number shown to a user carries where it came from (§11 "Accuracy & honesty").
 * Providers return `Sourced<T>` on success or `Unavailable` with a human-readable reason,
 * so the UI can always render either a value with attribution or an explicit "unavailable" state.
 */

export type Confidence = 'high' | 'medium' | 'low';

/** How a value was obtained. Sensors (Phase 4) are `measured`; almost everything in Phase 1 is `modeled` or `reference`. */
export type Basis = 'measured' | 'modeled' | 'reference' | 'user';

export interface Attribution {
  /** Short source name shown in the UI, e.g. "USGS 3DEP (EPQS)". */
  source: string;
  /** Licence / terms summary, e.g. "Public domain (US Government work)". */
  license: string;
  /** ISO timestamp of when the app retrieved the data. */
  retrievedAt: string;
  /** Native resolution of the underlying data, e.g. "1 m", "~10 km station". */
  resolution?: string;
  confidence: Confidence;
  basis: Basis;
  /** Plain-language caveats and adjustments applied ("adjusted +120 m with lapse rate 6.5 °C/km"). */
  notes?: string[];
  /** Optional link the user can open to learn more. */
  url?: string;
}

export interface Sourced<T> {
  status: 'ok';
  value: T;
  attribution: Attribution;
}

export interface Unavailable {
  status: 'unavailable';
  /** Plain-language reason, safe to show to users. */
  reason: string;
  /** Source that was attempted, for the Data Sources screen. */
  source: string;
  /** True when retrying later might succeed (network error, rate limit). */
  retryable: boolean;
}

export type Layer<T> = Sourced<T> | Unavailable;

export function sourced<T>(value: T, attribution: Omit<Attribution, 'retrievedAt'> & { retrievedAt?: string }): Sourced<T> {
  return {
    status: 'ok',
    value,
    attribution: { ...attribution, retrievedAt: attribution.retrievedAt ?? new Date().toISOString() },
  };
}

export function unavailable(source: string, reason: string, retryable = false): Unavailable {
  return { status: 'unavailable', source, reason, retryable };
}

export function isOk<T>(layer: Layer<T>): layer is Sourced<T> {
  return layer.status === 'ok';
}
