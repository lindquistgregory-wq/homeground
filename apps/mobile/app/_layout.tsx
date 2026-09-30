import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { usePathname } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDb } from '../src/db/database';
import { initIdentity } from '../src/services/identity';
import { useSettings } from '../src/services/settings';
import { firstStoreCheck, useEntitlements } from '../src/billing/entitlements';
import { syncNow } from '../src/sync/userCloud';
import { useTheme } from '../src/components/ui';
// Registers the background alert task at startup (the OS may launch the app headless to run it).
import { checkAlerts } from '../src/services/alerts';
import { collectOnOpen } from '../src/services/ble';
import { localOffsetMin } from '../src/services/sensorInsights';
import { refreshAllStations } from '../src/services/stations';
import { initMetrics, track } from '../src/services/metrics';
import { useAds } from '../src/ads/useAds';
import { onAlertOpened, openedFromAlert } from '../src/services/alerts';
import { configureMapCache } from '../src/services/offlinePacks';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const t = useTheme();
  const path = usePathname();
  useEffect(() => { if (ready) track('screen_view', { screen: screenName(path) }); }, [path, ready]);
  // Tapping a frost/heat alert while the app is running: no interstitial for the rest of this session.
  useEffect(() => onAlertOpened(() => useAds.getState().markFromAlert()), []);

  useEffect(() => {
    (async () => {
      await getDb();
      await initIdentity();
      // Entitlements resolve from the on-device cache; the store is asked in the background.
      await Promise.all([useSettings.getState().load(), useEntitlements.getState().init(), initMetrics()]);
      setReady(true);
      configureMapCache();
      // Ads (free plan only): consent first, after the first screen is up; never around a safety alert.
      // Wait briefly for the store so a paid user reinstalling (empty cache) never loads the ads SDK.
      Promise.race([firstStoreCheck(), new Promise((r) => setTimeout(r, 5000))])
        .then(() => openedFromAlert())
        .then((fromAlert) => useAds.getState().start(fromAlert))
        .catch(() => undefined);
      // Best effort; the app is fully usable without a cloud account.
      syncNow().catch(() => undefined);
      // "Collect on open": Bluetooth sensors only report while the app runs; stations refresh too.
      // Alerts run after both, so greenhouse thresholds see the readings just collected.
      Promise.allSettled([collectOnOpen(localOffsetMin()), refreshAllStations(localOffsetMin(), true)])
        .then(() => checkAlerts())
        .catch(() => undefined);
    })();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator accessibilityLabel="Loading Plotwright" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: t.bg }, headerTintColor: t.accent }}>
        <Stack.Screen name="index" options={{ title: 'Plotwright' }} />
        <Stack.Screen name="locate" options={{ title: 'Find your property' }} />
        <Stack.Screen name="boundary" options={{ title: 'Property boundary' }} />
        <Stack.Screen name="profile/[id]" options={{ title: 'Site profile' }} />
        <Stack.Screen name="design/[id]" options={{ title: 'Design' }} />
        <Stack.Screen name="sun/[id]" options={{ title: 'Sun path' }} />
        <Stack.Screen name="plants/index" options={{ title: 'Plants' }} />
        <Stack.Screen name="plants/[plantId]" options={{ title: 'Plant' }} />
        <Stack.Screen name="garden/[id]" options={{ title: 'Bed planner' }} />
        <Stack.Screen name="calendar/[id]" options={{ title: 'Planting calendar' }} />
        <Stack.Screen name="sensors/index" options={{ title: 'Sensors' }} />
        <Stack.Screen name="sensors/scan" options={{ title: 'Find Bluetooth sensors' }} />
        <Stack.Screen name="sensors/station" options={{ title: 'Connect a weather station' }} />
        <Stack.Screen name="sensors/import" options={{ title: 'Import CSV' }} />
        <Stack.Screen name="sensors/[id]" options={{ title: 'Sensor' }} />
        <Stack.Screen name="planner/[id]" options={{ title: 'Homestead planner' }} />
        <Stack.Screen name="data-sources" options={{ title: 'Data sources' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="paywall" options={{ title: 'Plans', presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

/** Route → screen name for local usage counts (ids are dropped). */
function screenName(path: string): string {
  const seg = path.split('/').filter(Boolean);
  if (!seg.length) return 'home';
  if (seg[0] === 'plants') return seg.length > 1 ? 'plant-guide' : 'plants';
  if (seg[0] === 'sensors') return seg[1] === 'scan' ? 'sensor-scan' : seg[1] === 'import' ? 'sensor-import' : seg[1] === 'station' ? 'station' : seg.length > 1 ? 'sensor' : 'sensors';
  return seg[0]!;
}
