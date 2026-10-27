/** Access codes: the fingerprint ignores case, spaces and dashes; the 90-day unlock is Pro with no ads, then lapses. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ACCESS_CODE_DAYS, accessCodeInput, accessGrantTransactions, newAccessGrant, resolveEntitlements } from '@plotwright/core';

const hash = (c: string) => createHash('sha256').update(accessCodeInput(c), 'utf8').digest('hex');

test('a code hashes the same however it is typed', () => {
  assert.equal(hash('abcd-efgh-1234 5678'), hash('ABCDEFGH12345678'));
  assert.notEqual(hash('ABCDEFGH12345678'), hash('ABCDEFGH12345679'));
});

test('an access grant unlocks Homestead Pro without ads for 90 days, then lapses', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const grant = newAccessGrant(now);
  assert.equal(Math.round((Date.parse(grant.expiresAt) - now.getTime()) / 86_400_000), ACCESS_CODE_DAYS);
  const on = resolveEntitlements(accessGrantTransactions(grant, now), { model: 'tiers', now });
  assert.equal(on.tier, 'pro');
  assert.equal(on.showAds, false);
  const later = new Date(now.getTime() + (ACCESS_CODE_DAYS + 1) * 86_400_000);
  assert.deepEqual(accessGrantTransactions(grant, later), []);
  assert.equal(resolveEntitlements(accessGrantTransactions(grant, later), { model: 'tiers', now: later }).tier, 'free');
  // Ads-only build: the grant removes ads too.
  assert.equal(resolveEntitlements(accessGrantTransactions(grant, now), { model: 'openSource', now }).showAds, false);
});
