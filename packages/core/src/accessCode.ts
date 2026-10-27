/**
 * Access codes: the owner gives a code to app reviewers (Google Play's App access instructions) and
 * uses it on their own phones. Entering it unlocks every paid feature, with no ads, on that phone for
 * 90 days. No accounts or server: the app ships only a salted SHA-256 fingerprint of each code
 * (`ACCESS_CODE_HASHES` in the app's config), so the public source doesn't reveal the code.
 *
 * The owner makes a fingerprint with `pnpm access-code-hash` and picks a long random code (16+
 * characters), since a fingerprint in public source can be guessed at offline if the code is short.
 */
import { PRODUCT_IDS, type VerifiedTransaction } from './entitlements';

export const ACCESS_CODE_SALT = 'plotwright-access-v1:';
export const ACCESS_CODE_DAYS = 90;
export const ACCESS_CODE_MIN_LENGTH = 12;

/** The text that gets hashed: case, spaces and dashes don't matter when typing a code. */
export function accessCodeInput(code: string): string {
  return ACCESS_CODE_SALT + code.replace(/[\s-]+/g, '').toUpperCase();
}

export interface AccessGrant {
  grantedAt: string;
  expiresAt: string;
}

export function newAccessGrant(now: Date): AccessGrant {
  return { grantedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ACCESS_CODE_DAYS * 86_400_000).toISOString() };
}

/** A grant as store purchases (Homestead Pro and remove-ads) that lapse when it does; none once expired. */
export function accessGrantTransactions(grant: AccessGrant | undefined, now: Date): VerifiedTransaction[] {
  if (!grant || Date.parse(grant.expiresAt) <= now.getTime()) return [];
  return [
    { productId: PRODUCT_IDS.proLifetime, expiresAt: grant.expiresAt },
    { productId: PRODUCT_IDS.removeAds, expiresAt: grant.expiresAt },
  ];
}
