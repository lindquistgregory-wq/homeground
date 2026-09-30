/**
 * App-wide constants. NWS and Nominatim ask API users for a way to reach
 * the app's maintainer if requests misbehave. It is sent in the User-Agent, never any user data.
 */
export const APP_VERSION = '0.1.0';
export const CONTACT_EMAIL = 'handlenterprises1988@gmail.com';
export const PROJECT_URL = 'https://github.com/lindquistgregory-wq/homeground';
/** NWS asks for contact info in the User-Agent; Nominatim accepts an email parameter. */
export const USER_AGENT = `Plotwright/${APP_VERSION} (+${PROJECT_URL}; ${CONTACT_EMAIL})`;

/** Business model while §12 is undecided; flip to 'openSource' to evaluate the ads-only build. */
export const BUSINESS_MODEL: 'tiers' | 'openSource' = 'tiers';

/**
 * AdMob ad unit ids for release builds (the owner's own AdMob account; unit ids are public identifiers,
 * not secrets). Debug builds always use Google's test units. A slot left null shows no ad.
 * The AdMob *app* ids live in app.json (react-native-google-mobile-ads plugin); they are Google's
 * sample app ids until the owner replaces them.
 */
export const ADMOB_UNITS: Record<'ios' | 'android', Partial<Record<'browse-banner' | 'interstitial' | 'rewarded', string | null>>> = {
  ios: { 'browse-banner': null, interstitial: null, rewarded: null },
  android: { 'browse-banner': null, interstitial: null, rewarded: null },
};

/** Shown on the paywall (App Review 3.1.2 needs both in the app and the store listing). */
export const PRIVACY_POLICY_URL = `${PROJECT_URL}/blob/main/docs/PRIVACY.md`;
/** iOS: Apple's standard licence agreement (App Store Connect default). */
export const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
/** Android: the app's own terms. */
export const TERMS_URL_ANDROID = `${PROJECT_URL}/blob/main/docs/TERMS.md`;
