import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDb } from '../src/db/database';
import { initIdentity } from '../src/services/identity';
import { useSettings } from '../src/services/settings';
import { useEntitlements } from '../src/billing/entitlements';
import { syncNow } from '../src/sync/userCloud';
import { useTheme } from '../src/components/ui';
// Registers the background alert task at startup (the OS may launch the app headless to run it).
import { checkAlerts } from '../src/services/alerts';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const t = useTheme();

  useEffect(() => {
    (async () => {
      await getDb();
      await initIdentity();
      await Promise.all([useSettings.getState().load(), useEntitlements.getState().refresh()]);
      setReady(true);
      // Best effort; the app is fully usable without a cloud account.
      syncNow().catch(() => undefined);
      checkAlerts().catch(() => undefined);
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
        <Stack.Screen name="data-sources" options={{ title: 'Data sources' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
