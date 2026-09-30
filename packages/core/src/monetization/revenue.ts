/**
 * Revenue calculator for §12 (subscription tiers vs open-source with ads vs hybrid). Every rate is an
 * input: no eCPM, fill rate or conversion figure is built in. Use your own AdMob reports (eCPM Trends
 * peer benchmarks in the AdMob console) or a dated public benchmark, and your own store conversion data.
 * The only defaults are the store fees, which are published: 15% for Apple Small Business Program
 * members and 15% (10% service + 5% billing) on Google Play in the US for the first $1M and for
 * auto-renewing subscriptions (from 30 June 2026).
 */

export type AdFormat = 'banner' | 'interstitial' | 'rewarded' | 'native';
export const AD_FORMATS: AdFormat[] = ['banner', 'interstitial', 'rewarded', 'native'];

export interface CountryMix {
  name: string;
  /** Share of monthly active users, 0–1. */
  share: number;
  /** eCPM in USD (revenue per 1,000 impressions) by format. Required input; leave undefined if unknown. */
  ecpm: Partial<Record<AdFormat, number>>;
}

export interface AdInputs {
  mau: number;
  sessionsPerUserPerMonth: number;
  /** Ad requests per session by format (interstitial is capped at 1 per session by the placement rules). */
  requestsPerSession: Partial<Record<AdFormat, number>>;
  /** Share of requests that return an ad, 0–1, by format. */
  fillRate: Partial<Record<AdFormat, number>>;
  countries: CountryMix[];
  /** Share of MAU who don't see ads (paid tiers, or "remove ads"), 0–1. */
  adFreeShare: number;
}

export interface SubscriptionPlanInput {
  name: string;
  /** Share of MAU on this plan, 0–1. */
  share: number;
  /** Price the user pays, per month equivalent (annual ÷ 12). */
  monthlyPriceUsd: number;
}

export interface SubscriptionInputs {
  mau: number;
  plans: SubscriptionPlanInput[];
  /** Store commission, 0–1. */
  storeFee: number;
}

export interface DonationInputs {
  monthlyUsd: number;
  /** Platform + processor fee, 0–1 (GitHub Sponsors from personal accounts: 0 platform fee). */
  feeRate: number;
}

export const STORE_FEE_SMALL_BUSINESS = 0.15;

export interface AdResult {
  impressions: Record<AdFormat, number>;
  grossUsd: Record<AdFormat, number>;
  totalUsd: number;
  /** Formats that have impressions but no eCPM in some country, so their revenue is understated. */
  missing: string[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const nonNeg = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

export function adRevenue(i: AdInputs): AdResult {
  const viewers = nonNeg(i.mau) * (1 - clamp01(i.adFreeShare));
  const sessions = viewers * nonNeg(i.sessionsPerUserPerMonth);
  const impressions = {} as Record<AdFormat, number>;
  const grossUsd = {} as Record<AdFormat, number>;
  const missing: string[] = [];
  const shareSum = i.countries.reduce((a, c) => a + clamp01(c.share), 0);
  for (const f of AD_FORMATS) {
    let perSession = nonNeg(i.requestsPerSession[f] ?? 0);
    if (f === 'interstitial') perSession = Math.min(perSession, 1);
    const imps = sessions * perSession * clamp01(i.fillRate[f] ?? 0);
    impressions[f] = imps;
    let usd = 0;
    for (const c of i.countries) {
      const w = shareSum > 0 ? clamp01(c.share) / shareSum : 0;
      const e = c.ecpm[f];
      if (imps > 0 && w > 0 && (e === undefined || !Number.isFinite(e))) missing.push(`${f} eCPM for ${c.name}`);
      usd += (imps * w * nonNeg(e ?? 0)) / 1000;
    }
    grossUsd[f] = usd;
  }
  return { impressions, grossUsd, totalUsd: AD_FORMATS.reduce((a, f) => a + grossUsd[f], 0), missing };
}

export function subscriptionRevenue(s: SubscriptionInputs): { grossUsd: number; netUsd: number; payers: number } {
  let gross = 0;
  let payers = 0;
  for (const p of s.plans) {
    const n = nonNeg(s.mau) * clamp01(p.share);
    payers += n;
    gross += n * nonNeg(p.monthlyPriceUsd);
  }
  return { grossUsd: gross, netUsd: gross * (1 - clamp01(s.storeFee)), payers };
}

export function donationRevenue(d: DonationInputs): number {
  return nonNeg(d.monthlyUsd) * (1 - clamp01(d.feeRate));
}

export interface ModelComparison {
  tiers: { adsUsd: number; subscriptionsNetUsd: number; totalUsd: number };
  openSourceAds: { adsUsd: number; donationsUsd: number; totalUsd: number };
  openSourceRemoveAds: { adsUsd: number; removeAdsNetUsd: number; donationsUsd: number; totalUsd: number };
  missing: string[];
}

/**
 * Monthly revenue under the three models. In "tiers", subscribers see no ads. In "open source + remove
 * ads", buyers of the one-off purchase see no ads; its revenue is spread as a monthly amount you supply
 * (new buyers per month × price).
 */
export function compareModels(input: {
  ads: Omit<AdInputs, 'adFreeShare'>;
  subscriptions: Omit<SubscriptionInputs, 'mau'>;
  donations: DonationInputs;
  removeAds: { ownersShare: number; newBuyersPerMonth: number; priceUsd: number };
}): ModelComparison {
  const subs = subscriptionRevenue({ ...input.subscriptions, mau: input.ads.mau });
  const paidShare = input.subscriptions.plans.reduce((a, p) => a + clamp01(p.share), 0);
  const tierAds = adRevenue({ ...input.ads, adFreeShare: clamp01(paidShare) });
  const osAds = adRevenue({ ...input.ads, adFreeShare: 0 });
  const osRemove = adRevenue({ ...input.ads, adFreeShare: clamp01(input.removeAds.ownersShare) });
  const donations = donationRevenue(input.donations);
  const removeNet = nonNeg(input.removeAds.newBuyersPerMonth) * nonNeg(input.removeAds.priceUsd) * (1 - clamp01(input.subscriptions.storeFee));
  return {
    tiers: { adsUsd: tierAds.totalUsd, subscriptionsNetUsd: subs.netUsd, totalUsd: tierAds.totalUsd + subs.netUsd },
    openSourceAds: { adsUsd: osAds.totalUsd, donationsUsd: donations, totalUsd: osAds.totalUsd + donations },
    openSourceRemoveAds: { adsUsd: osRemove.totalUsd, removeAdsNetUsd: removeNet, donationsUsd: donations, totalUsd: osRemove.totalUsd + removeNet + donations },
    missing: [...new Set([...tierAds.missing, ...osAds.missing])],
  };
}
