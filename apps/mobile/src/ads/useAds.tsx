/**
 * Ad state for the app, applying the placement rules from @plotwright/core: banners on browse screens
 * only, at most one interstitial per session at a natural break (never after opening a safety alert),
 * rewarded ads only on request. Consent is gathered once per launch, after the app has loaded, and
 * only when the current plan shows ads.
 */
import { atNaturalBreak, canShowBanner, newAdSession, type AdSession, type NaturalBreak } from '@plotwright/core';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { create } from 'zustand';
import { useEntitlements } from '../billing/entitlements';
import { kvGet, kvSet } from '../db/database';
import { ads } from './provider';

interface AdState {
  ready: boolean;
  privacyOptionsRequired: boolean;
  session: AdSession;
  /** The user's opt-in to personalised ads (Settings); off by default. */
  personalised: boolean;
  setPersonalised(on: boolean): Promise<void>;
  /** Consent + SDK start. Safe to call repeatedly. */
  start(fromAlert: boolean): Promise<void>;
  showPrivacyOptions(): Promise<void>;
  naturalBreak(kind: NaturalBreak): Promise<void>;
  markFromAlert(): void;
}

export const useAds = create<AdState>((set, get) => ({
  ready: false,
  privacyOptionsRequired: false,
  session: newAdSession(Date.now()),
  personalised: false,
  markFromAlert() {
    set({ session: { ...get().session, fromAlert: true } });
  },
  async setPersonalised(want) {
    let on = want;
    // iOS: personalised ads need Apple's tracking permission. It's only ever asked for here, when the user opts in.
    if (on && Platform.OS === 'ios') on = await requestTracking();
    await kvSet('ads.personalised', on ? '1' : '0');
    ads.setPersonalised(on);
    set({ personalised: on });
    if (get().ready) ads.preloadInterstitial();
  },
  async start(fromAlert) {
    if (fromAlert) set({ session: { ...get().session, fromAlert: true } });
    // The user may have withdrawn tracking permission in iOS Settings since opting in.
    const personalised = (await kvGet('ads.personalised').catch(() => undefined)) === '1' && (Platform.OS !== 'ios' || (await trackingGranted()));
    ads.setPersonalised(personalised);
    set({ personalised });
    if (!useEntitlements.getState().entitlements.showAds) return;
    try {
      const r = await ads.start();
      set({ ready: r.canRequestAds, privacyOptionsRequired: r.privacyOptionsRequired });
      if (r.canRequestAds) ads.preloadInterstitial();
    } catch {
      set({ ready: false });
    }
  },
  async showPrivacyOptions() {
    const r = await ads.showPrivacyOptions();
    set({ ready: r.canRequestAds, privacyOptionsRequired: r.privacyOptionsRequired });
  },
  async naturalBreak(_kind) {
    const ent = useEntitlements.getState().entitlements;
    const { session, show } = atNaturalBreak(get().session, ent, Date.now(), get().ready);
    set({ session });
    if (show && !(await ads.showInterstitial())) {
      // Nothing was loaded: don't count this as the session's interstitial.
      set({ session: { ...get().session, interstitialShown: false } });
      ads.preloadInterstitial();
    }
  },
}));

/** Anchored banner for browse screens; renders nothing where the rules don't allow an ad. */
export function BrowseBanner({ screen }: { screen: 'plants' | 'plant-guide' }) {
  const ent = useEntitlements((s) => s.entitlements);
  const ready = useAds((s) => s.ready);
  const id = ads.unitId('browse-banner');
  if (!ads.Banner || !id || !canShowBanner(screen, ent, ready)) return null;
  const B = ads.Banner;
  // Its own row at the bottom, away from buttons and navigation (AdMob placement policy).
  return <View accessibilityLabel="Advertisement" style={{ alignItems: 'center', paddingVertical: 8 }}><B unitId={id} /></View>;
}

/** Count leaving a screen as a natural break (e.g. closing a plant guide). */
export function useNaturalBreakOnLeave(kind: NaturalBreak) {
  useEffect(() => () => { void useAds.getState().naturalBreak(kind); }, [kind]);
}

async function requestTracking(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const att = require('expo-tracking-transparency') as typeof import('expo-tracking-transparency');
    const r = await att.requestTrackingPermissionsAsync();
    return r.granted;
  } catch {
    return false;
  }
}

async function trackingGranted(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const att = require('expo-tracking-transparency') as typeof import('expo-tracking-transparency');
    return (await att.getTrackingPermissionsAsync()).granted;
  } catch {
    return false;
  }
}
