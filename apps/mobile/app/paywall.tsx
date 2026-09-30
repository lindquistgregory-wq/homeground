/**
 * Paywall (§10). Prices come from the store (localized), Homestead Pro annual is selected by default,
 * a store-managed free trial is shown when the store offers one to this user, and the required
 * disclosure, Restore Purchases, and Terms / Privacy links sit next to the buy button. No ads here.
 * When opened for a locked layer or export on the free plan, it also offers an opt-in rewarded ad that
 * unlocks just that feature for 24 hours.
 * In the open-source model it offers the single "remove ads" purchase instead.
 */
import {
  PRODUCT_IDS, REWARD_HOURS, TIER_COMPARISON, TIER_NAMES, buildPlans, canOfferReward, defaultPlan, disclosure,
  type Feature, type PaywallPlan, type StoreProduct,
} from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ads } from '../src/ads/provider';
import { useAds } from '../src/ads/useAds';
import { billing } from '../src/billing/adapter';
import { useEntitlements } from '../src/billing/entitlements';
import { Body, Button, Card, useTheme } from '../src/components/ui';
import { BUSINESS_MODEL, PRIVACY_POLICY_URL, TERMS_URL, TERMS_URL_ANDROID } from '../src/config';
import { track } from '../src/services/metrics';

const FEATURE_NAMES: Partial<Record<Feature, string>> = {
  'sun.heatmaps': 'sun-hour heatmaps', 'layers.canopyShade': 'tree shade from canopy heights', 'layers.advancedTerrain': 'advanced terrain tools',
  'export.pdf': 'PDF export', 'export.gis': 'GIS export (GeoJSON, KML, DXF)',
};

const PERIOD: Record<PaywallPlan['period'], string> = { year: 'per year', month: 'per month', lifetime: 'one time' };

export default function Paywall() {
  const { feature, source } = useLocalSearchParams<{ feature?: Feature; source?: string }>();
  const t = useTheme();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const { entitlements, purchase, restore, addReward, cache } = useEntitlements();
  const owned = new Set((cache?.transactions ?? []).map((t) => t.productId));
  const subscribed = [...owned].some((id) => id !== PRODUCT_IDS.proLifetime && id !== PRODUCT_IDS.removeAds);
  const adsReady = useAds((s) => s.ready);
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [eligible, setEligible] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    track('paywall_view', { source: source ?? 'settings' });
    (async () => {
      try {
        const ps = await billing.loadProducts();
        const groups = [...new Set(ps.map((p) => p.groupIdIOS).filter((g): g is string => !!g))];
        setEligible(await billing.trialEligibilityIOS(groups));
        setProducts(ps);
      } catch {
        setProducts([]);
      }
    })();
  }, [source]);

  const plans = useMemo(() => (products ? buildPlans(products, platform, eligible) : []), [products, platform, eligible]);
  const removeAds = products?.find((p) => p.id === PRODUCT_IDS.removeAds);
  const chosen = plans.find((p) => p.productId === selected) ?? defaultPlan(plans);
  const reward = feature && canOfferReward(feature, entitlements, adsReady) ? feature : undefined;

  const buy = async (plan: Pick<PaywallPlan, 'productId' | 'offerTokenAndroid'>) => {
    // A one-time purchase doesn't end a subscription: say so before charging.
    if (plan.productId === PRODUCT_IDS.proLifetime && subscribed) {
      const go = await new Promise<boolean>((resolve) => Alert.alert('You still have a subscription', 'Buying Pro Lifetime doesn’t cancel it. After buying, cancel the subscription in your store account so it doesn’t renew.', [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ]));
      if (!go) return;
    }
    setBusy(plan.productId);
    const r = await purchase(plan);
    setBusy(null);
    if (r === 'purchased') {
      const cancelSub = plan.productId === PRODUCT_IDS.proLifetime && subscribed;
      Alert.alert('Thank you!', cancelSub ? 'Pro Lifetime is active. Now cancel your subscription so it doesn’t renew.' : 'Your purchase is active on this device and any device signed in to the same store account.',
        cancelSub ? [{ text: 'Manage subscription', onPress: () => billing.manageSubscriptions() }, { text: 'Later' }] : undefined);
      router.back();
    }
    else if (r === 'pending') Alert.alert('Payment pending', 'The store is waiting for your payment to complete. Your plan will switch on when it does.');
    else if (r === 'failed') Alert.alert('Purchase didn’t go through', 'Nothing was charged. Please try again later.');
  };

  const doRestore = async () => {
    setBusy('restore');
    const r = await restore();
    setBusy(null);
    if (!r.ok) Alert.alert('Couldn’t reach the store', 'Check your connection and try again.');
    else Alert.alert(r.found ? 'Purchases restored' : 'Nothing to restore', r.found ? `You're on ${TIER_NAMES[useEntitlements.getState().entitlements.tier]}.` : 'No active purchases were found for this store account.');
  };

  const watchAd = async () => {
    if (!reward) return;
    setBusy('reward');
    const r = await ads.showRewarded();
    setBusy(null);
    if (r === 'earned') { await addReward(reward); Alert.alert('Unlocked', `${FEATURE_NAMES[reward] ?? 'This feature'} is unlocked for ${REWARD_HOURS} hours.`); router.back(); }
    else if (r === 'unavailable') Alert.alert('No ad available right now', 'Please try again later.');
  };

  if (BUSINESS_MODEL === 'openSource') {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Card title="Every feature is free">
          <Body>Plotwright is open source and every feature is free. Ads keep it going. If you’d rather not see them, a one-time purchase removes them on this store account.</Body>
          {removeAds ? (
            <Button title={busy ? 'Working…' : `Remove ads · ${removeAds.displayPrice}`} disabled={!!busy || !entitlements.showAds} onPress={() => buy({ productId: removeAds.id })} />
          ) : <Body muted>{products ? 'The store isn’t available right now.' : 'Loading…'}</Body>}
          <Button title="Restore purchases" kind="secondary" disabled={!!busy} onPress={doRestore} />
        </Card>
        <Legal />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {feature && FEATURE_NAMES[feature] && <Body>{capitalize(FEATURE_NAMES[feature]!)} is part of {feature === 'sun.heatmaps' || feature === 'export.pdf' ? 'Grower and Homestead Pro' : 'Homestead Pro'}.</Body>}

      <Card title="Compare plans">
        <View style={styles.row}>
          <Text style={[styles.cellLabel, { color: t.muted }]} />
          {(['free', 'grower', 'pro'] as const).map((k) => <Text key={k} style={[styles.cellHead, { color: entitlements.tier === k ? t.accent : t.text }]}>{TIER_NAMES[k]}</Text>)}
        </View>
        {TIER_COMPARISON.map((r) => (
          <View key={r.label} style={[styles.row, { borderTopColor: t.border }]} accessible accessibilityLabel={`${r.label}: Free ${r.free}; Grower ${r.grower}; Homestead Pro ${r.pro}`}>
            <Text style={[styles.cellLabel, { color: t.text }]}>{r.label}</Text>
            <Text style={[styles.cell, { color: t.muted }]}>{r.free}</Text>
            <Text style={[styles.cell, { color: t.muted }]}>{r.grower}</Text>
            <Text style={[styles.cell, { color: t.text }]}>{r.pro}</Text>
          </View>
        ))}
      </Card>

      <Card title={entitlements.tier === 'free' ? 'Choose a plan' : `You're on ${TIER_NAMES[entitlements.tier]}`}>
        {products === null && <ActivityIndicator accessibilityLabel="Loading prices" />}
        {products !== null && plans.length === 0 && <Body muted>Prices aren’t available right now. Check your connection, or that you’re signed in to the {platform === 'ios' ? 'App Store' : 'Play Store'}.</Body>}
        {plans.map((p) => {
          const on = chosen?.productId === p.productId;
          return (
            <Pressable key={p.productId} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setSelected(p.productId)}
              style={[styles.plan, { borderColor: on ? t.accent : t.border, backgroundColor: t.card }]}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{TIER_NAMES[p.tier]} · {p.displayPrice} {PERIOD[p.period]}</Text>
              <Text style={{ color: t.muted }}>
                {[p.trialLength ? `free trial: ${p.trialLength}` : null, p.savingsPct ? `save ${p.savingsPct}% vs monthly` : null, p.period === 'lifetime' ? 'no subscription' : null].filter(Boolean).join(' · ') || ' '}
              </Text>
            </Pressable>
          );
        })}
        {chosen && (
          <>
            <Button
              title={busy === chosen.productId ? 'Opening the store…' : owned.has(chosen.productId) ? 'Your current plan' : chosen.trialLength ? `Start free trial (${chosen.trialLength})` : `Continue · ${chosen.displayPrice}`}
              disabled={!!busy || owned.has(chosen.productId) || owned.has(PRODUCT_IDS.proLifetime) || rank(chosen.tier) < rank(entitlements.tier)}
              onPress={() => buy(chosen)}
            />
            <Body muted>{disclosure(chosen, platform)}</Body>
          </>
        )}
        <Button title={busy === 'restore' ? 'Restoring…' : 'Restore purchases'} kind="secondary" disabled={!!busy} onPress={doRestore} />
        {entitlements.tier !== 'free' && <Button title="Manage subscription" kind="secondary" onPress={() => billing.manageSubscriptions()} />}
      </Card>

      {reward && (
        <Card title="Just need it today?">
          <Body>Watch a short ad to unlock {FEATURE_NAMES[reward]} for {REWARD_HOURS} hours. Entirely optional.</Body>
          <Button title={busy === 'reward' ? 'Loading ad…' : 'Watch an ad to unlock'} kind="secondary" disabled={!!busy} onPress={watchAd} />
        </Card>
      )}

      <Legal />
    </ScrollView>
  );
}

const rank = (tier: string) => ({ free: 0, grower: 1, pro: 2 })[tier] ?? 0;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Legal() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginVertical: 16 }}>
      <Text accessibilityRole="link" style={{ color: t.accent, padding: 8 }} onPress={() => Linking.openURL(Platform.OS === 'ios' ? TERMS_URL : TERMS_URL_ANDROID)}>Terms of Use</Text>
      <Text accessibilityRole="link" style={{ color: t.accent, padding: 8 }} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>Privacy Policy</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'transparent' },
  cellLabel: { flex: 1.1, fontWeight: '600', fontSize: 13 },
  cellHead: { flex: 1, fontWeight: '700', fontSize: 13 },
  cell: { flex: 1, fontSize: 13 },
  plan: { borderWidth: 2, borderRadius: 12, padding: 12, marginVertical: 6, minHeight: 56 },
});
