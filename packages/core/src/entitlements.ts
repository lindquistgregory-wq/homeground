/**
 * Tier & entitlement logic (§10), kept in one pure module so the StoreKit 2 / Play Billing adapters
 * only have to report verified transactions. Supports both business models while §12 is undecided:
 *   - 'tiers'      : Free (ads) / Grower / Homestead Pro
 *   - 'openSource' : every feature free; ads unless the one-off "remove ads" purchase is owned
 */

export type Tier = 'free' | 'grower' | 'pro';
export type BusinessModel = 'tiers' | 'openSource';

export const PRODUCT_IDS = {
  growerMonthly: 'plotwright.grower.monthly',
  growerAnnual: 'plotwright.grower.annual',
  proMonthly: 'plotwright.pro.monthly',
  proAnnual: 'plotwright.pro.annual',
  proLifetime: 'plotwright.pro.lifetime',
  removeAds: 'plotwright.removeads',
} as const;

const PRODUCT_TIER: Record<string, Tier> = {
  [PRODUCT_IDS.growerMonthly]: 'grower',
  [PRODUCT_IDS.growerAnnual]: 'grower',
  [PRODUCT_IDS.proMonthly]: 'pro',
  [PRODUCT_IDS.proAnnual]: 'pro',
  [PRODUCT_IDS.proLifetime]: 'pro',
};

/** A transaction already verified on-device (StoreKit 2 JWS / Play purchase state) by the platform adapter. */
export interface VerifiedTransaction {
  productId: string;
  /** ISO time; undefined for non-expiring purchases (lifetime, remove ads). */
  expiresAt?: string;
  revoked?: boolean;
  /** Store grace/billing-retry period: keep access while the store retries payment. */
  inGracePeriod?: boolean;
}

export interface Limits {
  parcels: number;
  designObjects: number;
  bleSensors: number;
  stationAccounts: number;
}

export type Feature =
  | 'layers.core' // elevation, zone, frost dates, soils summary, sun path — every tier
  | 'layers.standard' // all standard Site Profile layers
  | 'layers.advancedTerrain' // 1 m DEM analysis, cold-air drainage, keyline/water flow
  | 'layers.canopyShade'
  | 'sun.heatmaps'
  | 'sun.insolation'
  | 'sun.pvEstimate'
  | 'design.fullLibrary'
  | 'design.versions'
  | 'export.pdf'
  | 'export.gis' // GeoJSON / KML / DXF
  | 'offline.parcelPacks'
  | 'design.multiSeason'
  | 'planting.bedScoring'
  | 'planting.successionRotation'
  | 'planting.dynamicScheduling'
  | 'planting.yieldStorage'
  | 'sensors.greenhouseAlerts'
  | 'sensors.localNetwork'
  | 'planner.full'
  | 'planner.income'
  | 'planner.multiYear'; // budgets and years 2–5 of the phased plan

const FREE_FEATURES: Feature[] = ['layers.core'];
const GROWER_FEATURES: Feature[] = [
  ...FREE_FEATURES,
  'layers.standard',
  'sun.heatmaps',
  'design.fullLibrary',
  'design.versions',
  'export.pdf',
  'planting.bedScoring',
  'planting.successionRotation',
  'planner.full',
];
const PRO_ONLY: Feature[] = [
  'layers.advancedTerrain',
  'layers.canopyShade',
  'sun.insolation',
  'sun.pvEstimate',
  'export.gis',
  'offline.parcelPacks',
  'design.multiSeason',
  'planting.dynamicScheduling',
  'planting.yieldStorage',
  'sensors.greenhouseAlerts',
  'sensors.localNetwork',
  'planner.income',
  'planner.multiYear',
];

export const TIER_FEATURES: Record<Tier, ReadonlySet<Feature>> = {
  free: new Set<Feature>(FREE_FEATURES),
  grower: new Set<Feature>(GROWER_FEATURES),
  pro: new Set<Feature>([...GROWER_FEATURES, ...PRO_ONLY]),
};

export const TIER_LIMITS: Record<Tier, Limits> = {
  free: { parcels: 1, designObjects: 25, bleSensors: 1, stationAccounts: 0 },
  grower: { parcels: 2, designObjects: Infinity, bleSensors: 5, stationAccounts: 1 },
  pro: { parcels: Infinity, designObjects: Infinity, bleSensors: Infinity, stationAccounts: Infinity },
};

const TIER_RANK: Record<Tier, number> = { free: 0, grower: 1, pro: 2 };

/** A 24-hour unlock earned by watching a rewarded ad (§10), for a single feature. */
export interface RewardedUnlock {
  feature: Feature;
  expiresAt: string;
}

export interface Entitlements {
  model: BusinessModel;
  tier: Tier;
  showAds: boolean;
  limits: Limits;
  has(feature: Feature): boolean;
}

function isActive(t: VerifiedTransaction, now: Date): boolean {
  if (t.revoked) return false;
  if (!t.expiresAt) return true;
  return t.inGracePeriod === true || Date.parse(t.expiresAt) > now.getTime();
}

export function resolveTier(transactions: VerifiedTransaction[], now = new Date()): Tier {
  let tier: Tier = 'free';
  for (const t of transactions) {
    const candidate = PRODUCT_TIER[t.productId];
    if (candidate && isActive(t, now) && TIER_RANK[candidate] > TIER_RANK[tier]) tier = candidate;
  }
  return tier;
}

export function resolveEntitlements(
  transactions: VerifiedTransaction[],
  opts: { model?: BusinessModel; rewarded?: RewardedUnlock[]; now?: Date } = {},
): Entitlements {
  const now = opts.now ?? new Date();
  const model = opts.model ?? 'tiers';

  if (model === 'openSource') {
    const removedAds = transactions.some((t) => t.productId === PRODUCT_IDS.removeAds && isActive(t, now));
    return { model, tier: 'pro', showAds: !removedAds, limits: TIER_LIMITS.pro, has: () => true };
  }

  const tier = resolveTier(transactions, now);
  const unlocked = new Set(
    (opts.rewarded ?? []).filter((r) => Date.parse(r.expiresAt) > now.getTime()).map((r) => r.feature),
  );
  const features = TIER_FEATURES[tier];
  return {
    model,
    tier,
    showAds: tier === 'free',
    limits: TIER_LIMITS[tier],
    has: (f) => features.has(f) || unlocked.has(f),
  };
}

/** Screens where ads must never appear, regardless of tier (§10 placement rules). */
export const AD_FREE_SCREENS = new Set(['design', 'planner-chat', 'alerts', 'onboarding', 'paywall']);

export function canShowAdOn(screen: string, ent: Entitlements): boolean {
  return ent.showAds && !AD_FREE_SCREENS.has(screen);
}

/**
 * Safety alerts (greenhouse thresholds) run in the background, where the store can't be asked. They
 * fail open: a plan that lapsed less than this long ago in the cached state still counts, so a renewal
 * the phone hasn't seen yet never silences an alert.
 */
export const SAFETY_ALERT_GRACE_DAYS = 45;

export function safetyEntitlements(transactions: VerifiedTransaction[], opts: { model?: BusinessModel; now?: Date } = {}): Entitlements {
  const now = (opts.now ?? new Date()).getTime();
  return resolveEntitlements(transactions, { model: opts.model, now: new Date(now - SAFETY_ALERT_GRACE_DAYS * 86_400_000) });
}
