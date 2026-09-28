/**
 * Store billing plumbing (§10). Phase 1 ships the interface and a stub; Phase 6 adds the real adapters:
 *  - iOS: StoreKit 2 (transactions verified on-device via signed JWS)
 *  - Android: Google Play Billing Library (on-device purchase state)
 * Both go straight to the stores — no subscription SaaS and no receipt server.
 * Everything above this interface only sees `VerifiedTransaction[]`, so tier logic stays in @homeground/core.
 */
import { PRODUCT_IDS, type VerifiedTransaction } from '@homeground/core';
import { kvGet, kvSet } from '../db/database';

export interface BillingAdapter {
  readonly name: string;
  /** Verified, currently known transactions (restores on reinstall come from the store, not from us). */
  getVerifiedTransactions(): Promise<VerifiedTransaction[]>;
  purchase(productId: string): Promise<VerifiedTransaction[]>;
  restore(): Promise<VerifiedTransaction[]>;
}

/** Development stub: lets you switch tiers from Settings to exercise every gate before billing exists. */
export class StubBillingAdapter implements BillingAdapter {
  readonly name = 'stub';
  async getVerifiedTransactions(): Promise<VerifiedTransaction[]> {
    const raw = await kvGet('dev.transactions');
    return raw ? (JSON.parse(raw) as VerifiedTransaction[]) : [];
  }
  async purchase(productId: string): Promise<VerifiedTransaction[]> {
    const lifetime = productId === PRODUCT_IDS.proLifetime || productId === PRODUCT_IDS.removeAds;
    const expiresAt = lifetime ? undefined : new Date(Date.now() + 365 * 86_400_000).toISOString();
    const txs = [{ productId, expiresAt }];
    await kvSet('dev.transactions', JSON.stringify(txs));
    return txs;
  }
  async restore(): Promise<VerifiedTransaction[]> {
    return this.getVerifiedTransactions();
  }
  async reset(): Promise<void> {
    await kvSet('dev.transactions', '[]');
  }
}

export const billing: BillingAdapter = new StubBillingAdapter();
