import { formatArea, formatDoy } from '@plotwright/core';
import type { SiteProfile } from '@plotwright/providers';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, useTheme } from '../src/components/ui';
import { ParcelMap } from '../src/components/ParcelMap';
import { getSiteProfile, listParcels, type ParcelRecord } from '../src/db/parcels';
import { useSettings } from '../src/services/settings';
import { useEntitlements } from '../src/billing/entitlements';

/** The few facts worth seeing at a glance, from the saved Site Profile (skipped when a layer is unavailable). */
function keyFacts(p: SiteProfile | undefined): string[] {
  if (!p) return [];
  const facts: string[] = [];
  if (p.hardiness.status === 'ok') facts.push(`Zone ${p.hardiness.value.zone}`);
  if (p.climate.status === 'ok' && !p.climate.value.frost.dates.freezeRare) {
    const last = p.climate.value.frost.dates.lastSpring[32][50];
    const first = p.climate.value.frost.dates.firstFall[32][50];
    if (last !== null) facts.push(`Last frost ${formatDoy(last)}`);
    if (first !== null) facts.push(`First frost ${formatDoy(first)}`);
  }
  const soil = p.soils.status === 'ok' ? p.soils.value.units[0]?.name : undefined;
  if (soil) facts.push(soil.split(',')[0]!);
  return facts;
}

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
          <Card title="Welcome">
            <Body>
              Plotwright builds a profile of your actual land (elevation, soils, frost dates, flood zones and water) from free
              public data, so every recommendation fits your parcel rather than just your ZIP code.
            </Body>
          </Card>
        }
        renderItem={({ item }) => {
          const profile = profiles[item.id];
          const facts = keyFacts(profile);
          return (
            <View style={[styles.property, { backgroundColor: t.card, borderColor: t.border }]}>
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
                  {facts.length > 0 && (
                    <View style={styles.facts}>
                      {facts.map((f) => (
                        <Text key={f} style={[styles.fact, { color: t.text, borderColor: t.border }]}>{f}</Text>
                      ))}
                    </View>
                  )}
                </View>
              </Pressable>
              <View style={[styles.actions, { borderTopColor: t.border }]}>
                {([['Design', '/design/[id]'], ['Calendar', '/calendar/[id]'], ['Planner', '/planner/[id]']] as const).map(([label, path]) => (
                  <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} for ${item.name}`} onPress={() => open(path, item.id)} style={styles.action}>
                    <Text style={[styles.actionText, { color: t.accent }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        }}
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
              {([['Plants', '/plants'], ['Settings', '/settings'], ['Data sources', '/data-sources']] as const).map(([label, href]) => (
                <Pressable key={label} accessibilityRole="button" onPress={() => router.push(href)} style={[styles.link, { borderColor: t.border }]}>
                  <Text style={[styles.linkText, { color: t.accent }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  property: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  thumb: { height: 160 },
  propertyBody: { padding: 14, gap: 4 },
  propertyName: { fontSize: 20, fontWeight: '700' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  fact: { fontSize: 13, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  actions: { flexDirection: 'row', borderTopWidth: 1 },
  action: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  actionText: { fontSize: 16, fontWeight: '600' },
  links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  link: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  linkText: { fontSize: 15, fontWeight: '600' },
});
