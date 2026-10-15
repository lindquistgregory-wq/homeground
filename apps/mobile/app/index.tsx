import { formatArea } from '@plotwright/core';
import type { SiteProfile } from '@plotwright/providers';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/components/Text';
import { Body, Button, Card, useTheme } from '../src/components/ui';
import { ParcelMap } from '../src/components/ParcelMap';
import { FactChips } from '../src/components/facts';
import { Icon, type IconName } from '../src/components/Icon';
import { getSiteProfile, listParcels, type ParcelRecord } from '../src/db/parcels';
import { useSettings } from '../src/services/settings';
import { useEntitlements } from '../src/billing/entitlements';

export default function Home() {
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const limits = useEntitlements((s) => s.entitlements.limits);
  const [parcels, setParcels] = useState<ParcelRecord[]>([]);
  const [profiles, setProfiles] = useState<Record<string, SiteProfile | undefined>>({});

  useFocusEffect(
    useCallback(() => {
      listParcels().then(async (ps) => {
        setParcels(ps);
        const entries = await Promise.all(ps.map(async (p) => [p.id, await getSiteProfile(p.id)] as const));
        setProfiles(Object.fromEntries(entries));
      });
    }, []),
  );

  const atLimit = parcels.length >= limits.parcels;
  const open = (pathname: '/profile/[id]' | '/design/[id]' | '/calendar/[id]' | '/planner/[id]', id: string) => router.push({ pathname, params: { id } });

  return (
    <View style={styles.screen}>
      <FlatList
        data={parcels}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Card title="Welcome" icon="sprout">
            <Body>
              Plotwright builds a profile of your actual land (elevation, soils, frost dates, flood zones and water) from free
              public data, so every recommendation fits your parcel rather than just your ZIP code.
            </Body>
          </Card>
        }
        renderItem={({ item }) => {
          const profile = profiles[item.id];
          return (
            <View style={[styles.property, { backgroundColor: t.card }, t.dark ? { borderColor: t.border, borderWidth: 1 } : styles.shadow]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open the site profile for ${item.name}`} onPress={() => open('/profile/[id]', item.id)}>
                {/* The map is a picture here: touches go to the card, not to panning the map. */}
                <View pointerEvents="none" style={styles.thumb}>
                  <ParcelMap boundary={item.geometry} style={StyleSheet.absoluteFill} />
                </View>
                <View style={styles.propertyBody}>
                  <Text style={[styles.propertyName, { color: t.text }]}>{item.name}</Text>
                  <Body muted>
                    {formatArea(item.areaM2, units)}
                    {profile?.place.countyName ? ` · ${profile.place.countyName}` : ''}
                  </Body>
                  <FactChips profile={profile} />
                </View>
              </Pressable>
              <View style={[styles.actions, { borderTopColor: t.border }]}>
                {([['Design', '/design/[id]', 'pencil-ruler'], ['Calendar', '/calendar/[id]', 'calendar-month'], ['Planner', '/planner/[id]', 'lightbulb-on-outline']] as const).map(([label, path, icon]) => (
                  <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} for ${item.name}`} onPress={() => open(path, item.id)}
                    style={({ pressed }) => [styles.action, { backgroundColor: pressed ? t.surface : 'transparent' }]}>
                    <View style={[styles.actionIcon, { backgroundColor: t.accentSoft }]}>
                      <Icon name={icon as IconName} size={22} color={t.accent} />
                    </View>
                    <Text style={[styles.actionText, { color: t.text }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <View>
            {atLimit ? (
              // At the plan's limit: a quiet line instead of a large disabled button.
              <Text style={[styles.limit, { color: t.muted }]}>
                Your plan includes {limits.parcels} propert{limits.parcels === 1 ? 'y' : 'ies'} ·{' '}
                <Text accessibilityRole="link" style={{ color: t.accent, fontWeight: '600' }} onPress={() => router.push({ pathname: '/paywall', params: { source: 'home' } })}>
                  See plans
                </Text>
              </Text>
            ) : (
              <Button
                icon={parcels.length ? 'map-marker-plus-outline' : 'map-search-outline'}
                title={parcels.length ? 'Add another property' : 'Find your property'}
                onPress={() => router.push('/locate')}
                accessibilityHint="Search an address, use GPS, or tap the map"
              />
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  property: { borderRadius: 20, overflow: 'hidden', marginBottom: 16 },
  shadow: { elevation: 3, shadowColor: '#1b2a1e', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  thumb: { height: 170 },
  propertyBody: { padding: 16, gap: 4 },
  propertyName: { fontSize: 22, fontWeight: '700' },
  actions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  action: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 4, borderRadius: 14, marginHorizontal: 4 },
  actionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 14, fontWeight: '600' },
  limit: { fontSize: 15, textAlign: 'center', marginTop: 4 },
});
