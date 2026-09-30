/**
 * Store records → VerifiedTransaction (§10). The native libraries (StoreKit 2 via expo-iap, Play Billing
 * via expo-iap) hand us records that already passed the platform's own checks:
 *   - iOS: expo-iap's StoreKit 2 layer drops any transaction whose JWS fails `checkVerified`, so every
 *     record we see is signed by Apple for this app and device.
 *   - Android: Play returns a subscription from queryPurchasesAsync only while the user is entitled
 *     (active, cancelled-but-not-expired, or in grace period; not on hold, paused or expired). Play gives
 *     no expiry date on the device.
 * This module decides entitlement from those records, and keeps a cached copy usable offline for a
 * bounded time. It's pure so it can be tested without a store.
 */
import { PRODUCT_IDS, type VerifiedTransaction } from '../entitlements';

export type StorePlatform = 'ios' | 'android';

/** The fields we read from expo-iap's Purchase / ActiveSubscription, normalised. Times are epoch ms. */
export interface StoreRecord {
  platform: StorePlatform;
  productId: string;
  transactionId?: string;
  /** Android: 'pending' purchases (e.g. cash payment not made yet) grant nothing until 'purchased'. */
  purchaseState?: 'pending' | 'purchased' | 'unknown';
  /** Android: must be acknowledged within 3 days or Play refunds it. */
  isAcknowledgedAndroid?: boolean;
  /** Android: paused / suspended subscription (only returned when asked for). Never entitled. */
  isSuspendedAndroid?: boolean;
  expirationDateIOS?: number | null;
  revocationDateIOS?: number | null;
  /** A transaction replaced by an upgrade within the subscription group. */
  isUpgradedIOS?: boolean;
  /** From the renewal info: the store is retrying payment and access continues until this time. */
  gracePeriodExpirationDateIOS?: number | null;
  environmentIOS?: string | null;
}

/**
 * Android gives no expiry on the device, so a cached Android subscription is trusted offline for this
 * long after the last successful check with Play. Any successful check replaces the cache.
 */
export const ANDROID_OFFLINE_DAYS = 14;
const DAY = 86_400_000;

export function toVerifiedTransaction(r: StoreRecord, checkedAt: number): VerifiedTransaction | null {
  if (!r.productId) return null;
  if (r.platform === 'android') {
    if (r.purchaseState !== 'purchased' || r.isSuspendedAndroid) return null;
    // One-time products (lifetime, remove ads) have no expiry; subscriptions get a re-check window.
    const expiresAt = isOneTime(r.productId) ? undefined : new Date(checkedAt + ANDROID_OFFLINE_DAYS * DAY).toISOString();
    return { productId: r.productId, expiresAt };
  }
  if (r.isUpgradedIOS) return null;
  const revoked = typeof r.revocationDateIOS === 'number' && r.revocationDateIOS > 0;
  const grace = typeof r.gracePeriodExpirationDateIOS === 'number' ? r.gracePeriodExpirationDateIOS : 0;
  const exp = typeof r.expirationDateIOS === 'number' && r.expirationDateIOS > 0 ? r.expirationDateIOS : undefined;
  // In grace period the transaction's own expiry may already be past; access lasts until grace ends.
  const effective = exp === undefined ? undefined : Math.max(exp, grace);
  return {
    productId: r.productId,
    expiresAt: effective === undefined ? undefined : new Date(effective).toISOString(),
    revoked: revoked || undefined,
  };
}

const ONE_TIME = new Set<string>([PRODUCT_IDS.proLifetime, PRODUCT_IDS.removeAds]);
export function isOneTime(productId: string): boolean {
  return ONE_TIME.has(productId);
}

/** Records → transactions, dropping anything that grants nothing. Duplicate products keep the latest expiry. */
export function toVerifiedTransactions(records: StoreRecord[], checkedAt: number): VerifiedTransaction[] {
  const best = new Map<string, VerifiedTransaction>();
  for (const r of records) {
    const t = toVerifiedTransaction(r, checkedAt);
    if (!t || t.revoked) continue;
    const prev = best.get(t.productId);
    const later = (a?: string, b?: string) => (a === undefined ? true : b === undefined ? false : Date.parse(a) >= Date.parse(b));
    if (!prev || later(t.expiresAt, prev.expiresAt)) best.set(t.productId, t);
  }
  return [...best.values()];
}

/** Does this purchase still need finishing (iOS) / acknowledging (Android)? */
export function needsFinish(r: StoreRecord): boolean {
  if (r.platform === 'android') return r.purchaseState === 'purchased' && r.isAcknowledgedAndroid !== true;
  return true;
}

/** What the app keeps between launches so entitlements work offline. */
export interface EntitlementCache {
  transactions: VerifiedTransaction[];
  /** Last time the store answered successfully (epoch ms). */
  checkedAt: number;
}

/**
 * Combine a store check with the cache. A successful check is authoritative (so refunds and expiries take
 * effect); a failed one (offline, store unavailable) keeps the cache, whose entries still expire on
 * their own dates.
 */
export function mergeStoreCheck(
  cache: EntitlementCache | undefined,
  result: { ok: true; records: StoreRecord[]; at: number } | { ok: false },
): EntitlementCache {
  if (result.ok) return { transactions: toVerifiedTransactions(result.records, result.at), checkedAt: result.at };
  return cache ?? { transactions: [], checkedAt: 0 };
}
