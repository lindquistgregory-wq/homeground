import { formatArea } from '@plotwright/core';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, useTheme } from '../src/components/ui';
import { listParcels, type ParcelRecord } from '../src/db/parcels';
import { useSettings } from '../src/services/settings';
import { useEntitlements } from '../src/billing/entitlements';

export default function Home() {
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const limits = useEntitlements((s) => s.entitlements.limits);
  const [parcels, setParcels] = useState<ParcelRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      listParcels().then(setParcels);
    }, []),
  );

  const atLimit = parcels.length >= limits.parcels;

  return (
    <View style={styles.screen}>
      <FlatList
        data={parcels}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Card title="Welcome">
            <Body>
              Plotwright builds a profile of your actual land (elevation, soils, frost dates, flood zones and water) from free
              public data, so every recommendation fits your parcel rather than just your ZIP code.
            </Body>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
            onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.id } })}
          >
            <Card title={item.name}>
              <Body muted>{formatArea(item.areaM2, units)} · boundary {item.boundarySource}</Body>
            </Card>
          </Pressable>
        )}
        ListFooterComponent={
          <View>
            <Button
              title={parcels.length ? 'Add another property' : 'Find your property'}
              onPress={() => router.push('/locate')}
              disabled={atLimit}
              accessibilityHint="Search an address, use GPS, or tap the map"
            />
            {atLimit && <Body muted>Your plan includes {limits.parcels} propert{limits.parcels === 1 ? 'y' : 'ies'}.</Body>}
            <View style={styles.links}>
              <Link href="/settings" style={[styles.link, { color: t.accent }]}>Settings</Link>
              <Link href="/data-sources" style={[styles.link, { color: t.accent }]}>Data sources</Link>
            </View>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 16 },
  link: { fontSize: 16, padding: 8 },
});
