/**
 * App-wide constants. Set CONTACT before release: NWS and Nominatim ask API users for a way to reach
 * the app's maintainer if requests misbehave. It is sent in the User-Agent, never any user data.
 */
export const APP_VERSION = '0.1.0';
export const CONTACT = 'https://github.com/lindquistgregory-wq/homeground';
export const USER_AGENT = `Homeground/${APP_VERSION} (+${CONTACT})`;

/** Business model while §12 is undecided; flip to 'openSource' to evaluate the ads-only build. */
export const BUSINESS_MODEL: 'tiers' | 'openSource' = 'tiers';
