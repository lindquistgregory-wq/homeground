/**
 * AdProvider (§10): the app talks to ads only through this interface, so the ads SDK can be swapped
 * (another free mediation SDK) or left out entirely (an F-Droid / open-source build without ads).
 * Today's implementation is Google AdMob via react-native-google-mobile-ads (Apache-2.0) with Google's
 * UMP consent SDK for GDPR/TCF and US state privacy. Apple's tracking (ATT) prompt is shown only when
 * the user turns on personalised ads in Settings (useAds.setPersonalised). Owner setup: do NOT enable
 * UMP's "IDFA explainer" message in AdMob's Privacy & messaging, or UMP would show ATT at launch too.
 */
import { AD_REQUEST_CONFIG, adRequestOptions } from '@plotwright/core';
import { createElement, type ReactElement } from 'react';
import { Platform } from 'react-native';
import { ADMOB_UNITS } from '../config';

export type AdSlot = 'browse-banner' | 'interstitial' | 'rewarded';

export interface AdStartResult {
  /** Consent (or its absence where none is required) allows ad requests. */
  canRequestAds: boolean;
  /** A "Privacy choices" entry point must be shown (GDPR, US states). */
  privacyOptionsRequired: boolean;
}

export interface AdProvider {
  readonly name: string;
  /** Gather consent (shows the UMP form when required), then initialise the SDK if ads are allowed. */
  start(): Promise<AdStartResult>;
  showPrivacyOptions(): Promise<AdStartResult>;
  /** Unit id for a slot, or null when ads are off for this slot/build. */
  unitId(slot: AdSlot): string | null;
  /** Load (if needed) and show an interstitial. Resolves false if none was ready. */
  showInterstitial(): Promise<boolean>;
  preloadInterstitial(): void;
  /** Show a rewarded ad on the user's request; resolves 'earned' only when the reward was granted. */
  showRewarded(): Promise<'earned' | 'dismissed' | 'unavailable'>;
  /** The user's own opt-in to personalised ads (off by default). */
  setPersonalised(on: boolean): void;
  /** The banner component, or null when ads are off. */
  readonly Banner: null | ((p: { unitId: string }) => ReactElement);
}

type Gma = typeof import('react-native-google-mobile-ads');

class AdMobProvider implements AdProvider {
  readonly name = 'admob';
  private started = false;
  private interstitial?: ReturnType<Gma['InterstitialAd']['createForAdRequest']>;
  private interstitialLoaded = false;
  private personalised = false;
  readonly Banner: AdProvider['Banner'];

  constructor(private readonly gma: Gma) {
    const { BannerAd, BannerAdSize } = gma;
    this.Banner = ({ unitId }) => createElement(BannerAd, { unitId, size: BannerAdSize.ANCHORED_ADAPTIVE_BANNER, requestOptions: adRequestOptions(this.personalised) });
  }

  setPersonalised(on: boolean): void {
    if (on !== this.personalised) { this.personalised = on; this.interstitial = undefined; this.interstitialLoaded = false; }
  }

  unitId(slot: AdSlot): string | null {
    if (__DEV__) {
      const T = this.gma.TestIds;
      return slot === 'browse-banner' ? T.ADAPTIVE_BANNER : slot === 'interstitial' ? T.INTERSTITIAL : T.REWARDED;
    }
    const units = Platform.OS === 'ios' ? ADMOB_UNITS.ios : ADMOB_UNITS.android;
    return units[slot] ?? null;
  }

  private async consentState(): Promise<AdStartResult> {
    const info = await this.gma.AdsConsent.getConsentInfo();
    return {
      canRequestAds: info.canRequestAds,
      privacyOptionsRequired: info.privacyOptionsRequirementStatus === this.gma.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
    };
  }

  async start(): Promise<AdStartResult> {
    try {
      await this.gma.AdsConsent.gatherConsent();
    } catch {
      // Offline or form error: UMP falls back to the consent from the previous session.
    }
    const state = await this.consentState();
    if (state.canRequestAds && !this.started) {
      this.started = true;
      await this.gma.default().setRequestConfiguration({
        maxAdContentRating: this.gma.MaxAdContentRating[AD_REQUEST_CONFIG.maxAdContentRating],
        tagForChildDirectedTreatment: AD_REQUEST_CONFIG.tagForChildDirectedTreatment,
        tagForUnderAgeOfConsent: AD_REQUEST_CONFIG.tagForUnderAgeOfConsent,
      });
      await this.gma.default().initialize();
    }
    return state;
  }

  async showPrivacyOptions(): Promise<AdStartResult> {
    await this.gma.AdsConsent.showPrivacyOptionsForm().catch(() => undefined);
    return this.start();
  }

  preloadInterstitial(): void {
    const id = this.unitId('interstitial');
    if (!this.started || !id || this.interstitial) return;
    const ad = this.gma.InterstitialAd.createForAdRequest(id, adRequestOptions(this.personalised));
    this.interstitial = ad;
    ad.addAdEventListener(this.gma.AdEventType.LOADED, () => { this.interstitialLoaded = true; });
    ad.addAdEventListener(this.gma.AdEventType.ERROR, () => { this.interstitial = undefined; this.interstitialLoaded = false; });
    ad.addAdEventListener(this.gma.AdEventType.CLOSED, () => { this.interstitial = undefined; this.interstitialLoaded = false; });
    ad.load();
  }

  async showInterstitial(): Promise<boolean> {
    if (!this.interstitial || !this.interstitialLoaded) return false;
    try {
      await this.interstitial.show();
      return true;
    } catch {
      return false;
    }
  }

  showRewarded(): Promise<'earned' | 'dismissed' | 'unavailable'> {
    const id = this.unitId('rewarded');
    if (!this.started || !id) return Promise.resolve('unavailable');
    const { RewardedAd, RewardedAdEventType, AdEventType } = this.gma;
    return new Promise((resolve) => {
      const ad = RewardedAd.createForAdRequest(id, adRequestOptions(this.personalised));
      let earned = false;
      const timeout = setTimeout(() => { cleanup(); resolve('unavailable'); }, 15_000);
      const subs = [
        ad.addAdEventListener(RewardedAdEventType.LOADED, () => { clearTimeout(timeout); ad.show().catch(() => { cleanup(); resolve('unavailable'); }); }),
        ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; }),
        ad.addAdEventListener(AdEventType.CLOSED, () => { cleanup(); resolve(earned ? 'earned' : 'dismissed'); }),
        ad.addAdEventListener(AdEventType.ERROR, () => { clearTimeout(timeout); cleanup(); resolve('unavailable'); }),
      ];
      function cleanup() { for (const s of subs) s(); }
      ad.load();
    });
  }
}

/** No ads: the open-source/F-Droid flavour, paid-only builds, or a build without the ads module. */
class NoAds implements AdProvider {
  readonly name = 'none';
  readonly Banner = null;
  setPersonalised(): void {}
  async start(): Promise<AdStartResult> { return { canRequestAds: false, privacyOptionsRequired: false }; }
  async showPrivacyOptions(): Promise<AdStartResult> { return this.start(); }
  unitId(): string | null { return null; }
  async showInterstitial(): Promise<boolean> { return false; }
  preloadInterstitial(): void {}
  async showRewarded(): Promise<'unavailable'> { return 'unavailable'; }
}

function makeProvider(): AdProvider {
  if (process.env.EXPO_PUBLIC_ADS === 'off') return new NoAds();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gma = require('react-native-google-mobile-ads') as Gma;
    if (gma?.AdsConsent) return new AdMobProvider(gma);
  } catch { /* module not in this build */ }
  return new NoAds();
}

export const ads: AdProvider = makeProvider();
