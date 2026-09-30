import { centroid, PRODUCT_IDS } from '@plotwright/core';
import { validateUserEndpoint } from '@plotwright/providers';
import { UserSync } from '@plotwright/user-sync';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, TextInput } from 'react-native';
import { StubBillingAdapter, billing } from '../src/billing/adapter';
import { useEntitlements } from '../src/billing/entitlements';
import { Body, Button, Card, useTheme } from '../src/components/ui';
import { deleteAllLocalData } from '../src/db/database';
import { listParcels, saveUserEndpoint } from '../src/db/parcels';
import { http } from '../src/services/http';
import { useSettings } from '../src/services/settings';
import { cloudSyncAvailable, syncNow, wipeCloudData } from '../src/sync/userCloud';

export default function Settings() {
  const t = useTheme();
  const { units, setUnits } = useSettings();
  const { entitlements, refresh, purchase } = useEntitlements();
  const [cloud, setCloud] = useState<boolean | null>(null);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    cloudSyncAvailable().then(setCloud);
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

      <Card title={`Plan: ${entitlements.tier === 'free' ? 'Free' : entitlements.tier === 'grower' ? 'Grower' : 'Homestead Pro'}`}>
        <Body muted>Store billing arrives in a later phase. In development builds you can switch tiers here to test feature gates.</Body>
        {__DEV__ && billing instanceof StubBillingAdapter && (
          <>
            <Button title="Dev: Free" kind="secondary" onPress={async () => { await (billing as StubBillingAdapter).reset(); await refresh(); }} />
            <Button title="Dev: Grower" kind="secondary" onPress={() => purchase(PRODUCT_IDS.growerAnnual)} />
            <Button title="Dev: Homestead Pro" kind="secondary" onPress={() => purchase(PRODUCT_IDS.proAnnual)} />
          </>
        )}
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
