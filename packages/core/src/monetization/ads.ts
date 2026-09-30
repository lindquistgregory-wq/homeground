/**
 * Ad placement rules (§10), kept pure so they can be tested and so any AdProvider (AdMob today, other
 * free mediation SDKs later) follows the same rules:
 *   - banners only on browse screens (plant library and plant guides);
 *   - never on the design canvas, in the AI chat, on alerts, onboarding or the paywall;
 *   - at most one interstitial per session, only at a natural break, never at launch, and never when
 *     the user arrived from a frost/heat alert;
 *   - rewarded ads are opt-in and unlock one premium layer or export for 24 hours.
 * AdMob policy adds: interstitials not on app load or exit and not more often than every second user
 * action; banners not next to navigation buttons.
 */
import { AD_FREE_SCREENS, type Entitlements, type Feature, type RewardedUnlock } from '../entitlements';

/** Screens that may carry a banner (browse screens only). */
export const BANNER_SCREENS = new Set(['plants', 'plant-guide']);

export function canShowBanner(screen: string, ent: Entitlements, adsReady: boolean): boolean {
  return adsReady && ent.showAds && BANNER_SCREENS.has(screen) && !AD_FREE_SCREENS.has(screen);
}

/** Natural breaks where one interstitial may appear (after finishing something, never mid-task). */
export type NaturalBreak = 'plant-guide-closed' | 'calendar-closed' | 'sensor-list-closed';

export interface AdSession {
  startedAt: number;
  interstitialShown: boolean;
  naturalBreaks: number;
  /** Set when the app was opened from a safety alert: no interstitial for the rest of the session. */
  fromAlert: boolean;
}

export const newAdSession = (now: number, fromAlert = false): AdSession => ({ startedAt: now, interstitialShown: false, naturalBreaks: 0, fromAlert });

/** Minimum time into a session before an interstitial (never on app load). */
export const INTERSTITIAL_MIN_SESSION_MS = 120_000;

/** Record a natural break; returns the updated session and whether an interstitial may show now. */
export function atNaturalBreak(s: AdSession, ent: Entitlements, now: number, adsReady: boolean): { session: AdSession; show: boolean } {
  const session = { ...s, naturalBreaks: s.naturalBreaks + 1 };
  const show =
    adsReady && ent.showAds && !s.fromAlert && !s.interstitialShown &&
    session.naturalBreaks >= 2 && // not more often than every second user action
    now - s.startedAt >= INTERSTITIAL_MIN_SESSION_MS;
  return { session: show ? { ...session, interstitialShown: true } : session, show };
}

/** Features one rewarded ad can unlock for 24 hours: premium layers and exports (§10). */
export const REWARDABLE_FEATURES: Feature[] = ['sun.heatmaps', 'layers.canopyShade', 'layers.advancedTerrain', 'export.pdf', 'export.gis'];
export const REWARD_HOURS = 24;

export function canOfferReward(feature: Feature, ent: Entitlements, adsReady: boolean): boolean {
  return adsReady && ent.model === 'tiers' && ent.tier === 'free' && REWARDABLE_FEATURES.includes(feature) && !ent.has(feature);
}

/** Add (or renew) a 24-hour unlock for one feature, dropping expired ones. */
export function grantReward(unlocks: RewardedUnlock[], feature: Feature, now: number): RewardedUnlock[] {
  if (!REWARDABLE_FEATURES.includes(feature)) return unlocks.filter((u) => Date.parse(u.expiresAt) > now);
  const live = unlocks.filter((u) => Date.parse(u.expiresAt) > now && u.feature !== feature);
  return [...live, { feature, expiresAt: new Date(now + REWARD_HOURS * 3_600_000).toISOString() }];
}

/**
 * Global ad request settings. Plotwright is a general-audience app, not directed at children (the
 * Gemini Nano terms also require users to be 18+), so it isn't tagged child-directed; content is capped
 * at PG. Personalisation needs the user's opt-in (adRequestOptions) and, in the EEA/UK, their UMP/TCF
 * consent, which the SDK reads itself; on iOS also Apple's tracking permission.
 */
export const AD_REQUEST_CONFIG = {
  maxAdContentRating: 'PG',
  tagForChildDirectedTreatment: false,
  tagForUnderAgeOfConsent: false,
} as const;

/**
 * Per-request options. §11: ads are personalised only with consent. Where UMP collects consent (EEA/UK
 * TCF) the SDK also applies it; everywhere else Plotwright asks the user itself and defaults to
 * non-personalised ads until they opt in.
 */
export function adRequestOptions(personalisedOptIn: boolean): { requestNonPersonalizedAdsOnly: boolean } {
  return { requestNonPersonalizedAdsOnly: !personalisedOptIn };
}
