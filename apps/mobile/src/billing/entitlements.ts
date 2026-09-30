/**
 * Entitlement state for the app. Resolves immediately from the on-device cache (so the app works
 * offline and at launch), then asks the store; a successful store answer replaces the cache.
 * Rewarded-ad unlocks (24 h, one feature each) are kept on the device only.
 */
import { create } from 'zustand';
import {
  grantReward, mergeStoreCheck, resolveEntitlements,
  type EntitlementCache, type Entitlements, type Feature, type PaywallPlan, type RewardedUnlock,
} from '@plotwright/core';
import { billing, type PurchaseOutcome } from './adapter';
import { BUSINESS_MODEL } from '../config';
import { kvGet, kvSet } from '../db/database';
import { track } from '../services/metrics';

const CACHE_KEY = 'billing.cache';
const REWARD_KEY = 'ads.rewarded';

interface EntitlementState {
  cache: EntitlementCache | undefined;
  rewarded: RewardedUnlock[];
  entitlements: Entitlements;
  /** Last store error (shown in Settings), if the most recent check failed. */
  storeError?: string;
  /** Load the cached state (fast, offline) and start a store check in the background. */
  init(): Promise<void>;
  /** Cache only, no store connection (background tasks). */
  loadCached(): Promise<void>;
  refresh(): Promise<void>;
  purchase(plan: Pick<PaywallPlan, 'productId' | 'offerTokenAndroid'>): Promise<PurchaseOutcome>;
  restore(): Promise<{ ok: boolean; found: number }>;
  addReward(feature: Feature): Promise<void>;
}

let last: { key: string; ent: Entitlements } | undefined;
/**
 * Resolve, but hand back the previous object when nothing changed, so screens that depend on
 * `entitlements` don't reload after every background store check.
 */
function resolve(cache: EntitlementCache | undefined, rewarded: RewardedUnlock[]): Entitlements {
  const now = Date.now();
  const ent = resolveEntitlements(cache?.transactions ?? [], { model: BUSINESS_MODEL, rewarded, now: new Date(now) });
  const live = rewarded.filter((r) => Date.parse(r.expiresAt) > now).map((r) => r.feature).sort().join(',');
  const key = `${ent.model}|${ent.tier}|${ent.showAds}|${live}`;
  if (last?.key === key) return last.ent;
  last = { key, ent };
  return ent;
}

async function readJson<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await kvGet(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** One store connection + listener per app run; retried on the next refresh if it failed. */
let starting: Promise<void> | undefined;

export const useEntitlements = create<EntitlementState>((set, get) => ({
  cache: undefined,
  rewarded: [],
  entitlements: resolveEntitlements([], { model: BUSINESS_MODEL }),

  async init() {
    await get().loadCached();
    void get().refresh().catch(() => undefined);
  },

  async loadCached() {
    const cache = await readJson<EntitlementCache>(CACHE_KEY);
    const rewarded = (await readJson<RewardedUnlock[]>(REWARD_KEY)) ?? [];
    set({ cache, rewarded, entitlements: resolve(cache, rewarded) });
  },

  async refresh() {
    const cache = get().cache ?? (await readJson<EntitlementCache>(CACHE_KEY));
    const rewarded = (await readJson<RewardedUnlock[]>(REWARD_KEY)) ?? get().rewarded;
    set({ cache, rewarded, entitlements: resolve(cache, rewarded) });
    starting ??= billing.start(() => void get().refresh()).catch(() => { starting = undefined; });
    await starting;
    const result = await billing.check();
    const next = mergeStoreCheck(cache, result);
    if (result.ok) await kvSet(CACHE_KEY, JSON.stringify(next));
    set({ cache: next, entitlements: resolve(next, get().rewarded), storeError: result.ok ? undefined : result.error });
  },

  async purchase(plan) {
    track('purchase_started', { product: plan.productId });
    const outcome = await billing.purchase(plan);
    if (outcome === 'purchased') track('purchase_completed', { product: plan.productId });
    else if (outcome !== 'cancelled') track('purchase_failed', { reason: outcome });
    await get().refresh();
    return outcome;
  },

  async restore() {
    const result = await billing.restore();
    const next = mergeStoreCheck(get().cache, result);
    if (result.ok) await kvSet(CACHE_KEY, JSON.stringify(next));
    set({ cache: next, entitlements: resolve(next, get().rewarded), storeError: result.ok ? undefined : result.error });
    track('restore', { result: result.ok ? (next.transactions.length ? 'found' : 'none') : 'error' });
    return { ok: result.ok, found: next.transactions.length };
  },

  async addReward(feature) {
    const rewarded = grantReward(get().rewarded, feature, Date.now());
    await kvSet(REWARD_KEY, JSON.stringify(rewarded));
    set({ rewarded, entitlements: resolve(get().cache, rewarded) });
    track('rewarded_unlock', { feature });
  },
}));
