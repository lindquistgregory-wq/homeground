/**
 * Paywall content (§10): plans built from the store's own localized prices, the annual plan selected by
 * default, and the disclosure text App Review guideline 3.1.2 asks for. Prices are never hard-coded here:
 * the store's price tiers localize them, and a plan without a store price isn't shown.
 */
import { PRODUCT_IDS, type Tier } from '../entitlements';

export type PlanPeriod = 'month' | 'year' | 'lifetime';

/** A store offer, normalised from expo-iap's SubscriptionOffer. */
export interface StoreOffer {
  paymentMode: 'free-trial' | 'pay-as-you-go' | 'pay-up-front' | 'unknown';
  period?: { unit: 'day' | 'week' | 'month' | 'year'; value: number };
  periodCount?: number;
  /** Android only: the token Play needs to buy this offer. */
  offerTokenAndroid?: string;
  basePlanIdAndroid?: string;
  id?: string;
}

/** A store product, normalised from expo-iap's Product / ProductSubscription. */
export interface StoreProduct {
  id: string;
  displayPrice: string;
  price: number;
  currency: string;
  offers?: StoreOffer[];
  /** iOS: subscription group id (for intro-offer eligibility). */
  groupIdIOS?: string;
}

export interface PaywallPlan {
  productId: string;
  tier: Exclude<Tier, 'free'>;
  period: PlanPeriod;
  displayPrice: string;
  price: number;
  currency: string;
  /** Free-trial length in days when the store offers one to this user (approximate for months). */
  trialDays?: number;
  /** The trial length to show: "14 days", "1 month". */
  trialLength?: string;
  /** Android: the offer token to buy (trial offer if eligible, else the base plan). */
  offerTokenAndroid?: string;
  /** "Save 30%" versus 12 × the monthly price of the same tier, from store prices. */
  savingsPct?: number;
}

const PLAN_META: Record<string, { tier: Exclude<Tier, 'free'>; period: PlanPeriod }> = {
  [PRODUCT_IDS.growerMonthly]: { tier: 'grower', period: 'month' },
  [PRODUCT_IDS.growerAnnual]: { tier: 'grower', period: 'year' },
  [PRODUCT_IDS.proMonthly]: { tier: 'pro', period: 'month' },
  [PRODUCT_IDS.proAnnual]: { tier: 'pro', period: 'year' },
  [PRODUCT_IDS.proLifetime]: { tier: 'pro', period: 'lifetime' },
};

/** Approximate length in days (for ordering only; never shown for month/year periods). */
export function offerDays(o: StoreOffer): number | undefined {
  if (!o.period || !(o.period.value > 0)) return undefined;
  const per = { day: 1, week: 7, month: 30, year: 365 }[o.period.unit];
  return per * o.period.value * Math.max(1, o.periodCount ?? 1);
}

/**
 * The trial length as the store defines it: days and weeks in days ("14 days"), months and years in
 * their own unit ("1 month"), since the stores run those by calendar month.
 */
export function offerLength(o: StoreOffer): string | undefined {
  if (!o.period || !(o.period.value > 0)) return undefined;
  const n = o.period.value * Math.max(1, o.periodCount ?? 1);
  if (o.period.unit === 'day' || o.period.unit === 'week') {
    const d = n * (o.period.unit === 'week' ? 7 : 1);
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  return `${n} ${o.period.unit}${n === 1 ? '' : 's'}`;
}

/**
 * The free trial the store is offering this user. Matches on paymentMode only: on Android a trial comes
 * back as a 'promotional' offer, not 'introductory', and Play only returns offers the user is eligible for.
 * On iOS StoreKit applies the introductory offer automatically, so `iosEligible` must come from
 * isEligibleForIntroOfferIOS.
 */
export function trialOffer(p: StoreProduct, platform: 'ios' | 'android', iosEligible = false): StoreOffer | undefined {
  const trial = (p.offers ?? []).find((o) => o.paymentMode === 'free-trial' && (offerDays(o) ?? 0) > 0);
  if (!trial) return undefined;
  if (platform === 'android') return trial.offerTokenAndroid ? trial : undefined;
  return iosEligible ? trial : undefined;
}

/** Android base-plan token (the offer whose id is the base plan id), used when there's no trial. */
export function basePlanToken(p: StoreProduct): string | undefined {
  const offers = p.offers ?? [];
  return (offers.find((o) => o.basePlanIdAndroid && o.id === o.basePlanIdAndroid) ?? offers.find((o) => o.paymentMode !== 'free-trial'))?.offerTokenAndroid;
}

export function buildPlans(products: StoreProduct[], platform: 'ios' | 'android', iosTrialEligible: Record<string, boolean> = {}): PaywallPlan[] {
  const plans: PaywallPlan[] = [];
  for (const p of products) {
    const meta = PLAN_META[p.id];
    if (!meta || !p.displayPrice || !(p.price > 0)) continue;
    const trial = meta.period === 'lifetime' ? undefined : trialOffer(p, platform, !!(p.groupIdIOS && iosTrialEligible[p.groupIdIOS]));
    plans.push({
      productId: p.id, tier: meta.tier, period: meta.period, displayPrice: p.displayPrice, price: p.price, currency: p.currency,
      trialDays: trial ? offerDays(trial) : undefined,
      trialLength: trial ? offerLength(trial) : undefined,
      offerTokenAndroid: platform === 'android' && meta.period !== 'lifetime' ? trial?.offerTokenAndroid ?? basePlanToken(p) : undefined,
    });
  }
  for (const pl of plans) {
    if (pl.period !== 'year') continue;
    const monthly = plans.find((m) => m.tier === pl.tier && m.period === 'month' && m.currency === pl.currency);
    if (monthly) {
      const pct = Math.round((1 - pl.price / (monthly.price * 12)) * 100);
      if (pct > 0) pl.savingsPct = pct;
    }
  }
  const order = (p: PaywallPlan) => (p.tier === 'pro' ? 0 : 10) + { year: 0, month: 1, lifetime: 2 }[p.period];
  return plans.sort((a, b) => order(a) - order(b));
}

/** Default selection (§10): Pro annual, else any annual plan, else the first. */
export function defaultPlan(plans: PaywallPlan[], wanted: Exclude<Tier, 'free'> = 'pro'): PaywallPlan | undefined {
  return plans.find((p) => p.tier === wanted && p.period === 'year') ?? plans.find((p) => p.period === 'year') ?? plans[0];
}

export const TIER_NAMES: Record<Tier, string> = { free: 'Free', grower: 'Grower', pro: 'Homestead Pro' };

/**
 * Required disclosure next to the buy button (Apple 3.1.2; Play's subscription policy asks for the same
 * facts): what it is, the length, the full renewal price, the trial and what's charged after it, and how
 * to cancel.
 */
export function disclosure(plan: PaywallPlan, platform: 'ios' | 'android'): string {
  const name = TIER_NAMES[plan.tier];
  if (plan.period === 'lifetime') return `${name}, one-time purchase of ${plan.displayPrice}. No subscription; it doesn't renew.`;
  const per = plan.period === 'year' ? 'year' : 'month';
  const store = platform === 'ios' ? 'your Apple Account settings' : 'Google Play › Payments & subscriptions';
  const trial = plan.trialLength ? `Free for ${plan.trialLength}, then ${plan.displayPrice} per ${per}. ` : '';
  const renew = platform === 'ios'
    ? 'Renews automatically unless cancelled at least 24 hours before the end of the current period.'
    : 'Renews automatically until you cancel.';
  const trialCancel = plan.trialLength ? ' Cancel before the trial ends and you won’t be charged.' : '';
  return `${name}, ${plan.displayPrice} per ${per}. ${trial}${renew} Manage or cancel any time in ${store}.${trialCancel}`;
}

/** Tier comparison rows for the paywall (§10 table, abridged). */
export const TIER_COMPARISON: Array<{ label: string; free: string; grower: string; pro: string }> = [
  { label: 'Ads', free: 'Yes', grower: 'None', pro: 'None' },
  { label: 'Parcels', free: '1', grower: '2', pro: 'Unlimited' },
  { label: 'Site Profile', free: 'Core layers', grower: 'All standard layers', pro: '+ 1 m terrain, cold air, water flow, tree shade' },
  { label: 'Sun and shade', free: 'Sun path, parcel sun hours', grower: 'Heatmaps, seasonal sun', pro: '+ insolation, solar estimates' },
  { label: 'Design', free: '100 objects, full library', grower: 'Unlimited, versions, PDF', pro: '+ GIS export, offline packs, season scenarios' },
  { label: 'Planting', free: 'Full calendar', grower: 'Bed scoring, succession', pro: '+ sensor-driven timing, yield and storage' },
  { label: 'Sensors', free: '1', grower: '5 + 1 station', pro: 'Unlimited, greenhouse alerts, local network' },
  { label: 'AI planner', free: 'Interview + basic plan', grower: 'Full planner', pro: '+ income, budgets, 5-year plan' },
];
