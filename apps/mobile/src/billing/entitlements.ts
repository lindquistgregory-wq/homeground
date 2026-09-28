import { create } from 'zustand';
import { resolveEntitlements, type Entitlements, type VerifiedTransaction } from '@homeground/core';
import { billing } from './adapter';
import { BUSINESS_MODEL } from '../config';

interface EntitlementState {
  transactions: VerifiedTransaction[];
  entitlements: Entitlements;
  refresh(): Promise<void>;
  purchase(productId: string): Promise<void>;
}

export const useEntitlements = create<EntitlementState>((set) => ({
  transactions: [],
  entitlements: resolveEntitlements([], { model: BUSINESS_MODEL }),
  async refresh() {
    const transactions = await billing.getVerifiedTransactions();
    set({ transactions, entitlements: resolveEntitlements(transactions, { model: BUSINESS_MODEL }) });
  },
  async purchase(productId) {
    const transactions = await billing.purchase(productId);
    set({ transactions, entitlements: resolveEntitlements(transactions, { model: BUSINESS_MODEL }) });
  },
}));
