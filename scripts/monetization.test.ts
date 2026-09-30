/** Phase 6: store records → entitlements, paywall, ad placement, analytics allowlist, revenue calculator, offline packs, scenarios. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_OFFLINE_DAYS, PRODUCT_IDS, REWARD_HOURS, adRevenue, atNaturalBreak, buildPlans, canOfferReward, canShowBanner,
  compareModels, compareScenarios, copyObjects, countEvent, defaultPlan, disclosure, errorEntry, frameForBoundary, grantReward, mergeStoreCheck,
  needsFinish, newAdSession, newObject, objectType, parseScenarioMeta, planPack, resolveEntitlements, sanitizeEvent, scenarioLabel, scrubText, subscriptionRevenue,
  tileCount, tilesFor, toVerifiedTransactions, INTERSTITIAL_MIN_SESSION_MS, type StoreProduct, type StoreRecord,
} from '@plotwright/core';
import { OFFLINE_PACK_LAYERS } from '@plotwright/providers';
const USGS_PACK_LAYERS_FOR_TEST = OFFLINE_PACK_LAYERS;

const NOW = Date.parse('2026-09-29T12:00:00Z');
const DAY = 86_400_000;

// ---------- store records ----------

test('store: iOS verified subscription maps to its expiry; upgraded, revoked and expired grant nothing', () => {
  const recs: StoreRecord[] = [
    { platform: 'ios', productId: PRODUCT_IDS.proAnnual, expirationDateIOS: NOW + 30 * DAY },
    { platform: 'ios', productId: PRODUCT_IDS.growerMonthly, expirationDateIOS: NOW + 3 * DAY, isUpgradedIOS: true },
    { platform: 'ios', productId: PRODUCT_IDS.proLifetime, revocationDateIOS: NOW - DAY },
  ];
  const txs = toVerifiedTransactions(recs, NOW);
  assert.deepEqual(txs.map((t) => t.productId), [PRODUCT_IDS.proAnnual]);
  assert.equal(resolveEntitlements(txs, { now: new Date(NOW) }).tier, 'pro');
  const expired = toVerifiedTransactions([{ platform: 'ios', productId: PRODUCT_IDS.proMonthly, expirationDateIOS: NOW - DAY }], NOW);
  assert.equal(resolveEntitlements(expired, { now: new Date(NOW) }).tier, 'free');
});

test('store: iOS billing grace period keeps access until grace ends, even with a past expiry', () => {
  const txs = toVerifiedTransactions([{ platform: 'ios', productId: PRODUCT_IDS.growerAnnual, expirationDateIOS: NOW - DAY, gracePeriodExpirationDateIOS: NOW + 5 * DAY }], NOW);
  assert.equal(resolveEntitlements(txs, { now: new Date(NOW) }).tier, 'grower');
  assert.equal(resolveEntitlements(txs, { now: new Date(NOW + 6 * DAY) }).tier, 'free');
});

test('store: Android — purchased counts, pending and suspended don\'t; subscriptions need a re-check within the offline window', () => {
  const recs: StoreRecord[] = [
    { platform: 'android', productId: PRODUCT_IDS.proMonthly, purchaseState: 'pending' },
    { platform: 'android', productId: PRODUCT_IDS.growerMonthly, purchaseState: 'purchased', isSuspendedAndroid: true },
    { platform: 'android', productId: PRODUCT_IDS.growerAnnual, purchaseState: 'purchased' },
    { platform: 'android', productId: PRODUCT_IDS.removeAds, purchaseState: 'purchased' },
  ];
  const txs = toVerifiedTransactions(recs, NOW);
  assert.deepEqual(txs.map((t) => t.productId).sort(), [PRODUCT_IDS.growerAnnual, PRODUCT_IDS.removeAds].sort());
  assert.equal(txs.find((t) => t.productId === PRODUCT_IDS.removeAds)!.expiresAt, undefined);
  assert.equal(resolveEntitlements(txs, { now: new Date(NOW + (ANDROID_OFFLINE_DAYS - 1) * DAY) }).tier, 'grower');
  assert.equal(resolveEntitlements(txs, { now: new Date(NOW + (ANDROID_OFFLINE_DAYS + 1) * DAY) }).tier, 'free');
});

test('store: a successful check replaces the cache (refunds take effect); a failed one keeps it', () => {
  const cache = mergeStoreCheck(undefined, { ok: true, at: NOW, records: [{ platform: 'android', productId: PRODUCT_IDS.proAnnual, purchaseState: 'purchased' }] });
  assert.equal(cache.transactions.length, 1);
  assert.equal(mergeStoreCheck(cache, { ok: false }), cache);
  assert.equal(mergeStoreCheck(cache, { ok: true, at: NOW + DAY, records: [] }).transactions.length, 0);
});

test('store: Android purchases need acknowledging once; iOS transactions are always finished', () => {
  assert.equal(needsFinish({ platform: 'android', productId: 'x', purchaseState: 'purchased' }), true);
  assert.equal(needsFinish({ platform: 'android', productId: 'x', purchaseState: 'purchased', isAcknowledgedAndroid: true }), false);
  assert.equal(needsFinish({ platform: 'android', productId: 'x', purchaseState: 'pending' }), false);
  assert.equal(needsFinish({ platform: 'ios', productId: 'x' }), true);
});

// ---------- paywall ----------

const products: StoreProduct[] = [
  { id: PRODUCT_IDS.proMonthly, displayPrice: '$9.99', price: 9.99, currency: 'USD', offers: [{ id: 'base', basePlanIdAndroid: 'base', paymentMode: 'pay-as-you-go', offerTokenAndroid: 'tok-pm' }] },
  { id: PRODUCT_IDS.proAnnual, displayPrice: '$79.99', price: 79.99, currency: 'USD', groupIdIOS: 'g1', offers: [
    { id: 'base', basePlanIdAndroid: 'base', paymentMode: 'pay-up-front', offerTokenAndroid: 'tok-base' },
    { id: 'trial', basePlanIdAndroid: 'base', paymentMode: 'free-trial', period: { unit: 'week', value: 2 }, periodCount: 1, offerTokenAndroid: 'tok-trial' },
  ] },
  { id: PRODUCT_IDS.growerAnnual, displayPrice: '$24.99', price: 24.99, currency: 'USD' },
  { id: PRODUCT_IDS.proLifetime, displayPrice: '$199.99', price: 199.99, currency: 'USD' },
  { id: 'unknown.product', displayPrice: '$1', price: 1, currency: 'USD' },
  { id: PRODUCT_IDS.growerMonthly, displayPrice: '', price: 0, currency: 'USD' },
];

test('paywall: plans from store prices only; Pro annual selected by default with its trial and savings', () => {
  const plans = buildPlans(products, 'android');
  assert.deepEqual(plans.map((p) => p.productId), [PRODUCT_IDS.proAnnual, PRODUCT_IDS.proMonthly, PRODUCT_IDS.proLifetime, PRODUCT_IDS.growerAnnual]);
  const d = defaultPlan(plans)!;
  assert.equal(d.productId, PRODUCT_IDS.proAnnual);
  assert.equal(d.trialDays, 14);
  assert.equal(d.offerTokenAndroid, 'tok-trial');
  assert.equal(d.savingsPct, 33);
  assert.equal(plans.find((p) => p.productId === PRODUCT_IDS.proMonthly)!.offerTokenAndroid, 'tok-pm');
});

test('paywall: iOS shows the trial only when the user is eligible for the intro offer', () => {
  assert.equal(buildPlans(products, 'ios').find((p) => p.productId === PRODUCT_IDS.proAnnual)!.trialDays, undefined);
  assert.equal(buildPlans(products, 'ios', { g1: true }).find((p) => p.productId === PRODUCT_IDS.proAnnual)!.trialDays, 14);
});

test('paywall: disclosure states price, length, trial terms, renewal and how to cancel', () => {
  const plan = buildPlans(products, 'ios', { g1: true })[0]!;
  const text = disclosure(plan, 'ios');
  for (const s of ['$79.99 per year', 'Free for 14 days', '24 hours', 'Apple Account', 'won’t be charged']) assert.ok(text.includes(s), s);
  assert.ok(disclosure(buildPlans(products, 'android').find((p) => p.period === 'lifetime')!, 'android').includes("doesn't renew"));
});

// ---------- ads ----------

const free = resolveEntitlements([], { now: new Date(NOW) });
const grower = resolveEntitlements([{ productId: PRODUCT_IDS.growerAnnual }], { now: new Date(NOW) });

test('ads: banners only on browse screens, only for ad tiers, only when ads are ready', () => {
  assert.equal(canShowBanner('plants', free, true), true);
  assert.equal(canShowBanner('plant-guide', free, true), true);
  for (const s of ['design', 'planner-chat', 'alerts', 'paywall', 'onboarding', 'calendar']) assert.equal(canShowBanner(s, free, true), false, s);
  assert.equal(canShowBanner('plants', grower, true), false);
  assert.equal(canShowBanner('plants', free, false), false);
});

test('ads: one interstitial per session, at the second natural break at the earliest, never early or after an alert', () => {
  let s = newAdSession(NOW);
  let r = atNaturalBreak(s, free, NOW + INTERSTITIAL_MIN_SESSION_MS, true);
  assert.equal(r.show, false); // first break
  r = atNaturalBreak(r.session, free, NOW + INTERSTITIAL_MIN_SESSION_MS, true);
  assert.equal(r.show, true);
  for (let i = 0; i < 5; i++) { r = atNaturalBreak(r.session, free, NOW + 10 * INTERSTITIAL_MIN_SESSION_MS, true); assert.equal(r.show, false); }
  s = newAdSession(NOW);
  r = atNaturalBreak(atNaturalBreak(s, free, NOW + 1000, true).session, free, NOW + 2000, true);
  assert.equal(r.show, false, 'too soon after launch');
  s = newAdSession(NOW, true);
  r = atNaturalBreak(atNaturalBreak(s, free, NOW + 1e6, true).session, free, NOW + 1e6, true);
  assert.equal(r.show, false, 'opened from a frost/heat alert');
  r = atNaturalBreak(atNaturalBreak(newAdSession(NOW), grower, NOW + 1e6, true).session, grower, NOW + 1e6, true);
  assert.equal(r.show, false, 'paid tier');
});

test('ads: rewarded ad unlocks one premium layer or export for 24 hours', () => {
  assert.equal(canOfferReward('sun.heatmaps', free, true), true);
  assert.equal(canOfferReward('planner.income', free, true), false);
  assert.equal(canOfferReward('export.pdf', grower, true), false);
  const unlocks = grantReward([], 'export.gis', NOW);
  const ent = resolveEntitlements([], { rewarded: unlocks, now: new Date(NOW + (REWARD_HOURS - 1) * 3_600_000) });
  assert.equal(ent.has('export.gis'), true);
  assert.equal(ent.has('export.pdf'), false);
  assert.equal(resolveEntitlements([], { rewarded: unlocks, now: new Date(NOW + (REWARD_HOURS + 1) * 3_600_000) }).has('export.gis'), false);
  assert.equal(grantReward(unlocks, 'planner.income', NOW).length, 1, 'non-rewardable features are ignored');
  assert.equal(grantReward(grantReward(unlocks, 'export.gis', NOW + 1000), 'sun.heatmaps', NOW + 2000).length, 2);
});

// ---------- analytics ----------

test('analytics: only allowlisted events and identifier-like values; no coordinates, emails or ids', () => {
  assert.equal(sanitizeEvent('parcel_viewed', { id: 'x' }), null);
  assert.deepEqual(sanitizeEvent('screen_view', { screen: 'plants', lat: 40.1 }), { name: 'screen_view', params: { screen: 'plants' } });
  assert.deepEqual(sanitizeEvent('screen_view', { screen: 'parcel-123' })!.params, {});
  assert.deepEqual(sanitizeEvent('export', { format: '40.123,-105.2' })!.params, {});
  assert.deepEqual(sanitizeEvent('purchase_started', { product: 'plotwright.pro.annual' })!.params, { product: 'plotwright.pro.annual' });
  assert.deepEqual(sanitizeEvent('error', { kind: 'me@example.com' })!.params, {});
  let c = countEvent({}, sanitizeEvent('screen_view', { screen: 'plants' })!, '2026-09-29');
  c = countEvent(c, sanitizeEvent('screen_view', { screen: 'plants' })!, '2026-09-29');
  assert.equal(c['2026-09-29']!['screen_view:plants'], 2);
});

test('analytics: error log scrubs emails, coordinates, query strings and user folders', () => {
  const s = scrubText('Failed for bob@example.com at 40.12345,-105.98765 GET https://x.gov/q?lat=40.1&lon=-105 /Users/greg/app 1234567890');
  for (const bad of ['bob@', '40.12345', '-105.98765', 'lat=40', 'greg', '1234567890']) assert.ok(!s.includes(bad), bad);
  const e = errorEntry(new TypeError('parcel 40.55555 failed'), new Date(NOW));
  assert.equal(e.kind, 'TypeError');
  assert.ok(!e.message.includes('40.55555'));
});

// ---------- revenue calculator ----------

test('revenue: ad revenue = sessions × requests × fill × eCPM, interstitials capped at one per session, missing eCPMs reported', () => {
  const r = adRevenue({
    mau: 10_000, sessionsPerUserPerMonth: 10, adFreeShare: 0.1,
    requestsPerSession: { banner: 2, interstitial: 3 }, fillRate: { banner: 0.5, interstitial: 1 },
    countries: [{ name: 'US', share: 1, ecpm: { banner: 1, interstitial: 10 } }],
  });
  assert.equal(r.impressions.banner, 9000 * 10 * 2 * 0.5);
  assert.equal(r.impressions.interstitial, 9000 * 10 * 1);
  assert.equal(Math.round(r.totalUsd), Math.round(90 + 900));
  const missing = adRevenue({ mau: 100, sessionsPerUserPerMonth: 1, adFreeShare: 0, requestsPerSession: { rewarded: 1 }, fillRate: { rewarded: 1 }, countries: [{ name: 'DE', share: 1, ecpm: {} }] });
  assert.deepEqual(missing.missing, ['rewarded eCPM for DE']);
});

test('revenue: subscriptions net of store fee; model comparison treats subscribers as ad-free', () => {
  const s = subscriptionRevenue({ mau: 1000, storeFee: 0.15, plans: [{ name: 'Pro annual', share: 0.02, monthlyPriceUsd: 79.99 / 12 }] });
  assert.equal(s.payers, 20);
  assert.ok(Math.abs(s.netUsd - 20 * (79.99 / 12) * 0.85) < 1e-9);
  const cmp = compareModels({
    ads: { mau: 1000, sessionsPerUserPerMonth: 10, requestsPerSession: { banner: 1 }, fillRate: { banner: 1 }, countries: [{ name: 'US', share: 1, ecpm: { banner: 1 } }] },
    subscriptions: { storeFee: 0.15, plans: [{ name: 'Grower', share: 0.5, monthlyPriceUsd: 2 }] },
    donations: { monthlyUsd: 10, feeRate: 0 },
    removeAds: { ownersShare: 0, newBuyersPerMonth: 0, priceUsd: 0 },
  });
  assert.equal(cmp.tiers.adsUsd, 5);
  assert.equal(cmp.openSourceAds.adsUsd, 10);
  assert.equal(cmp.openSourceAds.totalUsd, 20);
  assert.equal(cmp.tiers.subscriptionsNetUsd, 500 * 2 * 0.85);
});

// ---------- offline packs ----------

test('offline packs: tile math matches the XYZ scheme and packs stay under the tile limit', () => {
  // A single point is one tile per zoom.
  assert.equal(tileCount([-105, 40, -105, 40], 12, 16), 5);
  const t = [...tilesFor([-105, 40, -105, 40], 16, 16)][0]!;
  assert.deepEqual(t, { z: 16, x: 13653, y: 24810 });
  const parcel: [number, number, number, number] = [-105.01, 39.995, -105.0, 40.0];
  const plan = planPack(parcel, USGS_PACK_LAYERS_FOR_TEST);
  assert.ok(plan.totalTiles > 0 && plan.totalTiles <= 3000);
  assert.equal(plan.trimmed, false);
  const big = planPack([-106, 39, -105, 40], USGS_PACK_LAYERS_FOR_TEST);
  assert.ok(big.trimmed && big.totalTiles <= 3000);
  assert.ok(big.layers.every((l) => l.maxZoom >= 12));
});

// ---------- scenarios ----------

test('scenarios: copies get new ids; comparison finds added, removed and moved objects and area by category', () => {
  const ring: Array<[number, number]> = [[-105.01, 40], [-105, 40], [-105, 40.005], [-105.01, 40.005], [-105.01, 40]];
  const frame = frameForBoundary({ type: 'Polygon', coordinates: [ring] });
  const bed = newObject('raised-bed', { lat: 40.002, lon: -105.005 }, 'a1');
  const coop = newObject('chicken-coop', { lat: 40.003, lon: -105.006 }, 'a2');
  let n = 0;
  const copy = copyObjects([bed, coop], () => `b${++n}`);
  assert.deepEqual(copy.map((o) => o.id), ['b1', 'b2']);
  const moved = { ...copy[0]!, center: [-105.00495, 40.002] as [number, number] };
  const tunnel = newObject('high-tunnel', { lat: 40.001, lon: -105.004 }, 'b3');
  const d = compareScenarios([bed, coop], [moved, tunnel], frame);
  assert.equal(d.moved.length, 1);
  assert.ok(d.moved[0]!.distanceM > 3 && d.moved[0]!.distanceM < 6);
  assert.deepEqual(d.removed.map((o) => o.kind), ['chicken-coop']);
  assert.deepEqual(d.added.map((o) => o.kind), ['high-tunnel']);
  const cat = d.areaByCategory.find((c) => c.category === objectType('high-tunnel')!.category)!;
  assert.ok(cat.b > cat.a);
});

test('scenarios: metadata parsing is strict and labels read naturally', () => {
  assert.deepEqual(parseScenarioMeta('{"season":"fall","year":2027}'), { season: 'fall', year: 2027, basedOn: undefined });
  assert.equal(parseScenarioMeta('{"season":"monsoon"}'), undefined);
  assert.equal(parseScenarioMeta('not json'), undefined);
  assert.equal(parseScenarioMeta(null), undefined);
  assert.equal(scenarioLabel({ season: 'winter', year: 2028 }), 'Winter 2028');
});
