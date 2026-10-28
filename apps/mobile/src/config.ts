/**
 * App-wide constants. NWS and Nominatim ask API users for a way to reach
 * the app's maintainer if requests misbehave. It is sent in the User-Agent, never any user data.
 */
import appJson from '../app.json';

/** The version people see in the store, from app.json, so it can't drift from the release. */
export const APP_VERSION: string = appJson.expo.version;
export const CONTACT_EMAIL = 'handlenterprises1988@gmail.com';
export const PROJECT_URL = 'https://github.com/lindquistgregory-wq/homeground';
/** NWS asks for contact info in the User-Agent; Nominatim accepts an email parameter. */
export const USER_AGENT = `Plotwright/${APP_VERSION} (+${PROJECT_URL}; ${CONTACT_EMAIL})`;

/** Business model while §12 is undecided; flip to 'openSource' to evaluate the ads-only build. */
export const BUSINESS_MODEL: 'tiers' | 'openSource' = 'tiers';

/**
 * AdMob ad unit ids for release builds (the owner's own AdMob account; unit ids are public identifiers,
 * not secrets). Debug builds always use Google's test units. A slot left null shows no ad.
 * The AdMob *app* ids live in app.json (react-native-google-mobile-ads plugin). Android uses the owner's
 * own app id; iOS still has Google's sample id until an iOS release.
 */
export const ADMOB_UNITS: Record<'ios' | 'android', Partial<Record<'browse-banner' | 'interstitial' | 'rewarded', string | null>>> = {
  ios: { 'browse-banner': null, interstitial: null, rewarded: null },
  android: { 'browse-banner': 'ca-app-pub-3127748525980986/3766503469', interstitial: null, rewarded: null },
};

/**
 * Fingerprints of the owner's access codes (for app reviewers and the owner's own phones): each unlocks
 * every paid feature on a phone for 90 days. Make one with `pnpm access-code-hash`; never put the code
 * itself here (this repository is public). Empty = the access-code field isn't shown.
 */
export const ACCESS_CODE_HASHES: string[] = ['67c3ba2ecc37f9ad0a20941347acea0b54595181302c7e6b1322bd3c5f7de366'];

/** Shown on the paywall (App Review 3.1.2 needs both in the app and the store listing). */
export const PRIVACY_POLICY_URL = `${PROJECT_URL}/blob/main/docs/PRIVACY.md`;
/** iOS: Apple's standard licence agreement (App Store Connect default). */
export const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
/** Android: the app's own terms. */
export const TERMS_URL_ANDROID = `${PROJECT_URL}/blob/main/docs/TERMS.md`;
/** Plotwright's own terms (assumption of risk, limits), agreed to at first launch on every platform. */
export const APP_TERMS_URL = TERMS_URL_ANDROID;
