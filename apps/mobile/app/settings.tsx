import { DEFAULT_TRANSMITTANCE, Material, TIER_NAMES, centroid, daySunSamples, emptySurface, makeGrid, prepareSamples, PRODUCT_IDS, runShadeBenchmark, sunHours } from '@plotwright/core';
import { ShadeNativeModule } from '@plotwright/shade-native';
import { validateUserEndpoint } from '@plotwright/providers';
import { UserSync } from '@plotwright/user-sync';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, Share, StyleSheet, TextInput } from 'react-native';
import { StubBillingAdapter, billing } from '../src/billing/adapter';
import { useEntitlements } from '../src/billing/entitlements';
import { Body, Button, Card, useTheme } from '../src/components/ui';
import { deleteAllLocalData } from '../src/db/database';
import { listSensors } from '../src/db/sensors';
import { deleteSecrets } from '../src/services/secrets';
import { listParcels, saveUserEndpoint } from '../src/db/parcels';
import { http } from '../src/services/http';
import { useSettings } from '../src/services/settings';
import { alertsEnabled, setAlertsEnabled } from '../src/services/alerts';
import { cloudSyncAvailable, syncNow, wipeCloudData } from '../src/sync/userCloud';
import { useAds } from '../src/ads/useAds';
import { BUSINESS_MODEL, PRIVACY_POLICY_URL } from '../src/config';
import { clearMetrics, metricsConsent, metricsReport, setMetricsConsent } from '../src/services/metrics';
import { deleteAllPacks } from '../src/services/offlinePacks';

/**
 * A synthetic 100 m yard (sloped ground, a tree line, a house) run through both engines: times the
 * native one and reports the largest difference from the TypeScript engine (float32 vs float64
 * inputs mean tiny differences are expected).
 */
function benchNative(): { ms: number; maxDiffH: number } {
  const n = 100;
  const ground = makeGrid({ width: n, height: n, cell: 1, x0: 580000, y0: 4680100, zone: { zone: 18, hemisphere: 'N' } }, 0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ground.data[j * n + i] = 100 + 0.03 * i + 0.02 * j;
  const s = emptySurface(ground);
  for (let j = 92; j < n; j++) for (let i = 0; i < n; i++) { s.height[j * n + i] = 14; s.base[j * n + i] = 3; s.material[j * n + i] = Material.deciduous; }
  for (let j = 30; j < 40; j++) for (let i = 60; i < 72; i++) { s.height[j * n + i] = 7; s.material[j * n + i] = Material.opaque; }
  const samples = prepareSamples(daySunSamples(new Date(Date.UTC(2026, 11, 21, 12)), 42.25, -73.98, 15), { sampleHours: 0.25 });
  const smp = new Float32Array(samples.length * 4);
  samples.forEach((p, i) => smp.set([p.sx, p.sy, p.tanAlt, p.hours], i * 4));
  const heights = new Float32Array(2 * n * n);
  heights.set(s.height, 0);
  heights.set(s.base, n * n);
  const tr = DEFAULT_TRANSMITTANCE;
  const out = new Float32Array(n * n);
  const t0 = performance.now();
  ShadeNativeModule!.sunHours(ground.data, heights, s.material, smp, new Float32Array([1, tr.opaque, tr.deciduousLeafOff, tr.evergreen, tr.film]),
    new Uint8Array(n * n).fill(1), out, new Float64Array([n, n, 1, 0.3, 250]));
  const ms = performance.now() - t0;
  const js = sunHours(s, samples, { sampleHours: 0.25, leafOn: false });
  let maxDiffH = 0;
  for (let k = 0; k < out.length; k++) maxDiffH = Math.max(maxDiffH, Math.abs(out[k]! - js.data[k]!));
  return { ms, maxDiffH };
}

export default function Settings() {
  const t = useTheme();
  const { units, setUnits } = useSettings();
  const { entitlements, refresh, restore, storeError } = useEntitlements();
  const { privacyOptionsRequired, showPrivacyOptions, personalised, setPersonalised } = useAds();
  const [metricsOn, setMetricsOn] = useState(metricsConsent());
  const [cloud, setCloud] = useState<boolean | null>(null);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [bench, setBench] = useState<string | null>(null);
  const [alerts, setAlerts] = useState(false);

  useEffect(() => {
    cloudSyncAvailable().then(setCloud);
    alertsEnabled().then(setAlerts);
  }, []);

  const contribute = async () => {
    const [parcel] = await listParcels();
    if (!parcel?.countyFips) return Alert.alert('Add a property first', 'We test the link against your property location.');
    setChecking(true);
    // Test at the parcel's interior centroid; a boundary vertex is shared with neighbours.
    const v = await validateUserEndpoint(http, endpointUrl, parcel.countyFips, centroid(parcel.geometry));
    setChecking(false);
    if (v.ok && v.suggested) {
      await saveUserEndpoint(v.suggested);
      Alert.alert('Parcel service added', `It returned a parcel at your property${v.sample?.parcelId ? ` (id ${v.sample.parcelId})` : ''}. It's saved on this device only.`);
      setEndpointUrl('');
    } else Alert.alert('That link did not work', v.problems.join('\n'));
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card title="Units">
        <Button title={units === 'imperial' ? '✓ Imperial (ft, acres, °F)' : 'Imperial (ft, acres, °F)'} kind={units === 'imperial' ? 'primary' : 'secondary'} onPress={() => setUnits('imperial')} />
        <Button title={units === 'metric' ? '✓ Metric (m, ha, °C)' : 'Metric (m, ha, °C)'} kind={units === 'metric' ? 'primary' : 'secondary'} onPress={() => setUnits('metric')} />
      </Card>

      <Card title="Frost & weather alerts">
        <Body>
          Notifies you when the National Weather Service forecast threatens crops you’ve marked as planted: frost or freeze for
          tender crops, extreme heat, and strong wind for tall crops. Checked on this device (about twice a day when your phone
          allows background refresh, and whenever you open the app). No account or push server involved.
        </Body>
        <Button
          title={alerts ? '✓ Alerts on' : 'Turn on alerts'}
          kind={alerts ? 'primary' : 'secondary'}
          onPress={async () => {
            try {
              const r = await setAlertsEnabled(!alerts);
              setAlerts(r.on);
              if (r.denied) Alert.alert('Notifications are off', 'Allow notifications for Plotwright in your phone’s Settings to get frost alerts.');
              else if (r.on && !r.background) Alert.alert('Alerts on', 'Background refresh is off or restricted on this phone, so Plotwright will check the forecast each time you open it.');
            } catch (e) {
              Alert.alert('Couldn’t change alerts', (e as Error).message);
            }
          }}
        />
      </Card>

      <Card title="Sync">
        <Body>
          {cloud === null
            ? 'Checking…'
            : cloud
              ? `Syncing through your ${Platform.OS === 'ios' ? 'iCloud' : 'Google Drive'}. Plotwright has no server of its own.`
              : UserSync
                ? `${Platform.OS === 'ios' ? 'Sign in to iCloud' : 'Google Drive sync is coming soon'}. Until then your data stays on this device.`
                : 'Cloud sync is not available in this build. Your data stays on this device.'}
        </Body>
        {cloud && <Button title="Sync now" kind="secondary" onPress={() => syncNow().then((r) => Alert.alert('Sync', JSON.stringify(r)))} />}
      </Card>

      <Card title="Add your county's parcel map">
        <Body muted>
          If your county publishes parcels as an ArcGIS REST layer (…/MapServer/0 or …/FeatureServer/0), paste the link. We test it
          at your property and only ever request the parcel outline, id and acreage.
        </Body>
        <TextInput
          value={endpointUrl}
          onChangeText={setEndpointUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://…/MapServer/0"
          placeholderTextColor={t.muted}
          accessibilityLabel="Parcel service URL"
          style={[styles.input, { color: t.text, borderColor: t.border }]}
        />
        <Button title={checking ? 'Testing…' : 'Test and add'} onPress={contribute} disabled={checking || endpointUrl.length < 12} />
      </Card>

      <Card title={BUSINESS_MODEL === 'openSource' ? 'Ads' : `Plan: ${TIER_NAMES[entitlements.tier]}`}>
        {BUSINESS_MODEL === 'openSource'
          ? <Body muted>Every feature is free. {entitlements.showAds ? 'Ads support the app; a one-time purchase removes them.' : 'Ads are removed on this store account. Thank you!'}</Body>
          : <Body muted>{entitlements.tier === 'free' ? 'The free plan shows a few ads on browse screens, never on the design canvas, in the planner chat or with alerts.' : 'No ads. Thank you for supporting Plotwright.'}</Body>}
        {storeError && <Body muted>The store couldn't be reached, so your last known plan is used.</Body>}
        <Button title={entitlements.tier === 'free' || entitlements.showAds ? 'See plans' : 'Change plan'} onPress={() => router.push({ pathname: '/paywall', params: { source: 'settings' } })} />
        <Button title="Restore purchases" kind="secondary" onPress={async () => {
          const r = await restore();
          Alert.alert(r.ok ? (r.found ? 'Purchases restored' : 'Nothing to restore') : 'Couldn’t reach the store', r.ok ? (r.found ? `You're on ${TIER_NAMES[useEntitlements.getState().entitlements.tier]}.` : 'No active purchases were found for this store account.') : 'Check your connection and try again.');
        }} />
        {entitlements.tier !== 'free' && BUSINESS_MODEL === 'tiers' && <Button title="Manage subscription" kind="secondary" onPress={() => billing.manageSubscriptions()} />}
        {__DEV__ && billing instanceof StubBillingAdapter && (
          <>
            <Body muted>Development build: switch tiers to test feature gates.</Body>
            <Button title="Dev: Free" kind="secondary" onPress={async () => { await (billing as StubBillingAdapter).reset(); await refresh(); }} />
            <Button title="Dev: Grower" kind="secondary" onPress={async () => { await billing.purchase({ productId: PRODUCT_IDS.growerAnnual }); await refresh(); }} />
            <Button title="Dev: Homestead Pro" kind="secondary" onPress={async () => { await billing.purchase({ productId: PRODUCT_IDS.proAnnual }); await refresh(); }} />
          </>
        )}
      </Card>

      <Card title="Privacy">
        <Body muted>
          Your properties, designs, sensor readings and plans stay on this phone and in your own cloud account. Plotwright has no server and
          never sells or shares your data. Ads on the free plan come from Google AdMob and are not personalised unless you choose so here
          (and, in the EU and UK, agree in the consent form).
        </Body>
        {entitlements.showAds && (
          <Button title={personalised ? '✓ Personalised ads allowed' : 'Allow personalised ads'} kind={personalised ? 'primary' : 'secondary'}
            accessibilityHint="Lets Google use data about your device to choose ads. Off by default." onPress={async () => {
              await setPersonalised(!personalised);
              if (!personalised && !useAds.getState().personalised) Alert.alert('Ads stay non-personalised', 'Tracking permission is off for Plotwright. You can change it in the Settings app under Privacy & Security › Tracking.');
            }} />
        )}
        {privacyOptionsRequired && <Button title="Ad privacy choices" kind="secondary" onPress={() => showPrivacyOptions()} />}
        <Body muted>
          Usage statistics: counts of which screens and features you use, plus a log of app errors, kept on this phone only and never
          sent anywhere. Off unless you turn it on; you can read or share them yourself.
        </Body>
        <Button title={metricsOn ? '✓ Keep usage statistics on this phone' : 'Keep usage statistics on this phone'} kind={metricsOn ? 'primary' : 'secondary'}
          onPress={async () => { await setMetricsConsent(!metricsOn); setMetricsOn(!metricsOn); }} />
        {metricsOn && (
          <>
            <Button title="View or share statistics" kind="secondary" onPress={() => Share.share({ message: metricsReport() })} />
            <Button title="Clear statistics" kind="secondary" onPress={() => clearMetrics()} />
          </>
        )}
        <Button title="Privacy policy" kind="secondary" onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} />
      </Card>

      <Card title="Diagnostics">
        <Body muted>Times the sun/shade engine on this phone with a synthetic 100 m backyard (target: under 500 ms to update after moving a structure).</Body>
        <Button title={bench ?? 'Run shade benchmark'} kind="secondary" disabled={bench === 'Running…'} onPress={() => {
          setBench('Running…');
          setTimeout(() => {
            const r = runShadeBenchmark({ sizeM: 100, cellM: 1 });
            const native = ShadeNativeModule ? benchNative() : null;
            setBench(`JS: full day ${r.fullDayMs.toFixed(0)} ms, move-a-structure ${r.incrementalMs.toFixed(0)} ms${native !== null ? ` · native full day ${native.ms.toFixed(0)} ms, max difference from JS ${native.maxDiffH.toFixed(3)} h` : ' · native engine not linked'}`);
          }, 50);
        }} />
      </Card>

      <Card title="Your data">
        <Body muted>Nothing you enter is sent to a Plotwright server. You can erase everything on this device (and in your cloud sync).</Body>
        <Button
          title="Delete all my data"
          kind="secondary"
          onPress={() =>
            Alert.alert('Delete everything?', 'Removes all properties, profiles and cached data from this device and your cloud sync.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  // Station keys and bindkeys live in the keychain, not the database: remove them first.
                  await deleteSecrets((await listSensors()).map((x) => x.id));
                  await setAlertsEnabled(false).catch(() => undefined);
                  deleteAllPacks();
                  await setMetricsConsent(false).catch(() => undefined);
                  await deleteAllLocalData();
                  const cloudResult = await wipeCloudData();
                  if (cloudResult === 'deferred')
                    Alert.alert(
                      'Deleted from this device',
                      "Your cloud copy couldn't be reached. It will be deleted the next time this device connects, before anything syncs back.",
                    );
                  router.replace('/');
                },
              },
            ])
          }
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, marginVertical: 8 },
});
