/**
 * Store billing (§10): StoreKit 2 on iOS and Google Play Billing (Library 9) on Android, both through
 * expo-iap (MIT), which talks to the stores directly. No subscription SaaS, no receipt server, and none
 * of expo-iap's optional hosted services (IAPKit / verifyPurchaseWithProvider) are used.
 *   - iOS: expo-iap only passes on transactions that pass StoreKit 2's JWS verification.
 *   - Android: Play's on-device purchase state; purchases are acknowledged within Play's 3-day window.
 * Everything above this interface sees StoreRecord / StoreProduct, and tier logic stays in @plotwright/core.
 */
import {
  PRODUCT_IDS, isOneTime, needsFinish, type PaywallPlan, type StoreProduct, type StoreRecord, type StoreOffer,
} from '@plotwright/core';
import { Linking, Platform } from 'react-native';
import { kvGet, kvSet } from '../db/database';

export type StoreCheck = { ok: true; records: StoreRecord[]; at: number } | { ok: false; error?: string };
export type PurchaseOutcome = 'purchased' | 'pending' | 'cancelled' | 'failed';

export interface BillingAdapter {
  readonly name: 'store' | 'stub' | 'unavailable';
  /** Connect and start listening for purchases (including ones completed while the app was closed). */
  start(onChange: () => void): Promise<void>;
  loadProducts(): Promise<StoreProduct[]>;
  /** iOS: which subscription groups still have an introductory (trial) offer for this Apple Account. */
  trialEligibilityIOS(groupIds: string[]): Promise<Record<string, boolean>>;
  /** What the store says the user owns right now. */
  check(): Promise<StoreCheck>;
  purchase(plan: Pick<PaywallPlan, 'productId' | 'offerTokenAndroid'>): Promise<PurchaseOutcome>;
  /** Restore Purchases (App Review 3.1.1): re-syncs with the store, then checks. */
  restore(): Promise<StoreCheck>;
  manageSubscriptions(): Promise<void>;
}

const SUBS = [PRODUCT_IDS.growerMonthly, PRODUCT_IDS.growerAnnual, PRODUCT_IDS.proMonthly, PRODUCT_IDS.proAnnual];
const ONE_TIME = [PRODUCT_IDS.proLifetime, PRODUCT_IDS.removeAds];
const PACKAGE = 'app.plotwright.planner';

const ms = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v) { const n = Number(v); return Number.isFinite(n) ? n : Date.parse(v) || null; }
  return null;
};

type Iap = typeof import('expo-iap');

/** expo-iap Purchase / ActiveSubscription → StoreRecord. */
export function recordFrom(p: Record<string, unknown>): StoreRecord {
  const renewal = (p.renewalInfoIOS ?? {}) as Record<string, unknown>;
  return {
    platform: p.platform === 'android' || Platform.OS === 'android' ? 'android' : 'ios',
    productId: String(p.productId ?? p.id ?? ''),
    transactionId: typeof p.transactionId === 'string' ? p.transactionId : undefined,
    purchaseState: (p.purchaseState as StoreRecord['purchaseState']) ?? undefined,
    isAcknowledgedAndroid: p.isAcknowledgedAndroid === true,
    isSuspendedAndroid: p.isSuspendedAndroid === true,
    expirationDateIOS: ms(p.expirationDateIOS),
    revocationDateIOS: ms(p.revocationDateIOS),
    isUpgradedIOS: p.isUpgradedIOS === true,
    gracePeriodExpirationDateIOS: ms(renewal.gracePeriodExpirationDate),
    environmentIOS: typeof p.environmentIOS === 'string' ? p.environmentIOS : null,
  };
}

function productFrom(p: Record<string, unknown>): StoreProduct {
  const offers = ((p.subscriptionOffers as Array<Record<string, unknown>> | undefined) ?? []).map<StoreOffer>((o) => ({
    id: typeof o.id === 'string' ? o.id : undefined,
    paymentMode: (o.paymentMode as StoreOffer['paymentMode']) ?? 'unknown',
    period: o.period as StoreOffer['period'],
    periodCount: typeof o.periodCount === 'number' ? o.periodCount : undefined,
    offerTokenAndroid: typeof o.offerTokenAndroid === 'string' ? o.offerTokenAndroid : undefined,
    basePlanIdAndroid: typeof o.basePlanIdAndroid === 'string' ? o.basePlanIdAndroid : undefined,
  }));
  return {
    id: String(p.id), displayPrice: String(p.displayPrice ?? ''), price: Number(p.price ?? 0), currency: String(p.currency ?? ''),
    offers, groupIdIOS: typeof p.subscriptionGroupIdIOS === 'string' ? p.subscriptionGroupIdIOS : undefined,
  };
}

export class StoreBillingAdapter implements BillingAdapter {
  readonly name = 'store' as const;
  private connected = false;
  private pending = new Map<string, (o: PurchaseOutcome) => void>();
  constructor(private readonly iap: Iap) {}

  private async connect(): Promise<void> {
    if (!this.connected) this.connected = await this.iap.initConnection();
    if (!this.connected) throw new Error('The store is unavailable.');
  }

  async start(onChange: () => void): Promise<void> {
    await this.connect();
    this.iap.purchaseUpdatedListener(async (purchase) => {
      const rec = recordFrom(purchase as unknown as Record<string, unknown>);
      const settle = this.pending.get(rec.productId);
      if (rec.platform === 'android' && rec.purchaseState === 'pending') {
        settle?.('pending');
        this.pending.delete(rec.productId);
        return;
      }
      // Grant first (the check reads the store's verified state), then finish/acknowledge.
      onChange();
      try {
        if (needsFinish(rec)) await this.iap.finishTransaction({ purchase, isConsumable: false });
      } catch { /* retried on the next launch: unfinished transactions are redelivered */ }
      settle?.('purchased');
      this.pending.delete(rec.productId);
      onChange();
    });
    this.iap.purchaseErrorListener((e) => {
      const outcome: PurchaseOutcome = e.code === this.iap.ErrorCode.UserCancelled ? 'cancelled' : 'failed';
      for (const [, settle] of this.pending) settle(outcome);
      this.pending.clear();
    });
    if (Platform.OS === 'android') this.iap.showInAppMessagesAndroid?.().catch?.(() => undefined);
    // Acknowledge anything bought while the app was closed (Play refunds unacknowledged purchases after 3 days).
    const owned = await this.iap.getAvailablePurchases().catch(() => []);
    for (const p of owned) {
      const rec = recordFrom(p as unknown as Record<string, unknown>);
      if (rec.platform === 'android' && needsFinish(rec)) await this.iap.finishTransaction({ purchase: p, isConsumable: false }).catch(() => undefined);
    }
  }

  async loadProducts(): Promise<StoreProduct[]> {
    await this.connect();
    const [subs, once] = await Promise.all([
      this.iap.fetchProducts({ skus: SUBS, type: 'subs' }),
      this.iap.fetchProducts({ skus: ONE_TIME, type: 'in-app' }),
    ]);
    return [...(subs ?? []), ...(once ?? [])].map((p) => productFrom(p as unknown as Record<string, unknown>));
  }

  async trialEligibilityIOS(groupIds: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    if (Platform.OS !== 'ios') return out;
    for (const g of groupIds) out[g] = await this.iap.isEligibleForIntroOfferIOS(g).catch(() => false);
    return out;
  }

  async check(): Promise<StoreCheck> {
    try {
      await this.connect();
      const at = Date.now();
      const owned = await this.iap.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
      const records = owned.map((p) => recordFrom(p as unknown as Record<string, unknown>));
      if (Platform.OS === 'ios') {
        // Renewal info (billing grace period) comes with the active-subscription view.
        const active = await this.iap.getActiveSubscriptions(SUBS).catch(() => []);
        for (const a of active) {
          const r = recordFrom(a as unknown as Record<string, unknown>);
          const same = records.find((x) => x.productId === r.productId);
          if (same) same.gracePeriodExpirationDateIOS = r.gracePeriodExpirationDateIOS ?? same.gracePeriodExpirationDateIOS;
          else records.push(r);
        }
      }
      return { ok: true, records, at };
    } catch (e) {
      // One unverified entitlement makes the whole StoreKit call fail: keep the cached state.
      return { ok: false, error: (e as Error).message };
    }
  }

  async purchase(plan: Pick<PaywallPlan, 'productId' | 'offerTokenAndroid'>): Promise<PurchaseOutcome> {
    await this.connect();
    const sub = !isOneTime(plan.productId);
    const done = new Promise<PurchaseOutcome>((resolve) => this.pending.set(plan.productId, resolve));
    try {
      await this.iap.requestPurchase({
        type: sub ? 'subs' : 'in-app',
        request: {
          apple: { sku: plan.productId },
          // Always name the offer: without one, Play silently uses the first offer it returns.
          google: sub && plan.offerTokenAndroid
            ? { skus: [plan.productId], subscriptionOffers: [{ sku: plan.productId, offerToken: plan.offerTokenAndroid }] }
            : { skus: [plan.productId] },
        },
      });
    } catch (e) {
      this.pending.delete(plan.productId);
      return (e as { code?: string }).code === this.iap.ErrorCode.UserCancelled ? 'cancelled' : 'failed';
    }
    return done;
  }

  async restore(): Promise<StoreCheck> {
    try {
      await this.connect();
      await this.iap.restorePurchases();
    } catch { /* fall through to a plain check */ }
    return this.check();
  }

  async manageSubscriptions(): Promise<void> {
    try {
      await this.iap.deepLinkToSubscriptions({ skuAndroid: PRODUCT_IDS.proAnnual, packageNameAndroid: PACKAGE });
    } catch {
      await Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : `https://play.google.com/store/account/subscriptions?package=${PACKAGE}`);
    }
  }
}

/** Development stub: switch tiers from Settings to exercise every gate without a store. */
export class StubBillingAdapter implements BillingAdapter {
  readonly name = 'stub' as const;
  async start(): Promise<void> {}
  async loadProducts(): Promise<StoreProduct[]> {
    // Clearly fake prices so a dev build can't be mistaken for the store.
    const p = (id: string, price: number): StoreProduct => ({ id, displayPrice: `DEV $${price.toFixed(2)}`, price, currency: 'USD', offers: [] });
    return [p(PRODUCT_IDS.growerMonthly, 2.99), p(PRODUCT_IDS.growerAnnual, 24.99), p(PRODUCT_IDS.proMonthly, 9.99), p(PRODUCT_IDS.proAnnual, 79.99), p(PRODUCT_IDS.proLifetime, 199), p(PRODUCT_IDS.removeAds, 4.99)];
  }
  async trialEligibilityIOS(): Promise<Record<string, boolean>> { return {}; }
  async check(): Promise<StoreCheck> {
    const raw = await kvGet('dev.transactions');
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    const platform = Platform.OS === 'android' ? 'android' : 'ios';
    const year = Date.now() + 365 * 86_400_000;
    return { ok: true, at: Date.now(), records: ids.map((productId) => ({ platform, productId, purchaseState: 'purchased', expirationDateIOS: isOneTime(productId) ? null : year })) };
  }
  async purchase(plan: Pick<PaywallPlan, 'productId'>): Promise<PurchaseOutcome> {
    await kvSet('dev.transactions', JSON.stringify([plan.productId]));
    return 'purchased';
  }
  async restore(): Promise<StoreCheck> { return this.check(); }
  async manageSubscriptions(): Promise<void> {}
  async reset(): Promise<void> { await kvSet('dev.transactions', '[]'); }
}

/** A build without the store module (shouldn't ship): everything reports the store as unavailable. */
class UnavailableBilling implements BillingAdapter {
  readonly name = 'unavailable' as const;
  async start(): Promise<void> {}
  async loadProducts(): Promise<StoreProduct[]> { return []; }
  async trialEligibilityIOS(): Promise<Record<string, boolean>> { return {}; }
  async check(): Promise<StoreCheck> { return { ok: false, error: 'Store billing is not available in this build.' }; }
  async purchase(): Promise<PurchaseOutcome> { return 'failed'; }
  async restore(): Promise<StoreCheck> { return this.check(); }
  async manageSubscriptions(): Promise<void> {}
}

function makeBilling(): BillingAdapter {
  try {
    // Loaded lazily: the native module is absent in a build without the config plugin.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const iap = require('expo-iap') as Iap;
    if (typeof iap?.initConnection === 'function' && !(__DEV__ && process.env.EXPO_PUBLIC_BILLING_STUB === '1')) return new StoreBillingAdapter(iap);
  } catch { /* fall through */ }
  return __DEV__ ? new StubBillingAdapter() : new UnavailableBilling();
}

export const billing: BillingAdapter = makeBilling();
