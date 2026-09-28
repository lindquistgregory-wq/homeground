/**
 * App-wide constants. NWS and Nominatim ask API users for a way to reach
 * the app's maintainer if requests misbehave. It is sent in the User-Agent, never any user data.
 */
export const APP_VERSION = '0.1.0';
export const CONTACT_EMAIL = 'handlenterprises1988@gmail.com';
export const PROJECT_URL = 'https://github.com/lindquistgregory-wq/homeground';
/** NWS asks for contact info in the User-Agent; Nominatim accepts an email parameter. */
export const USER_AGENT = `Homeground/${APP_VERSION} (+${PROJECT_URL}; ${CONTACT_EMAIL})`;

/** Business model while §12 is undecided; flip to 'openSource' to evaluate the ads-only build. */
export const BUSINESS_MODEL: 'tiers' | 'openSource' = 'tiers';
