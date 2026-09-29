/**
 * Plant library (§7.1): 76 vegetables, herbs, fruit and cover crops. With a property selected, each
 * plant shows how well it fits the property's climate (zone, season length, heat, chill, humidity);
 * bed-level fit (sun, soil) is in the bed planner.
 */
import { scorePlant, searchPlants, type PlantKind, type PlantSpec, type Suitability } from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Chip, VerdictBadge } from '../../src/components/plants';
import { Body, useTheme } from '../../src/components/ui';
import { useGarden } from '../../src/services/useGarden';

const KINDS: Array<{ key: PlantKind | 'all'; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'vegetable', label: 'Vegetables' }, { key: 'herb', label: 'Herbs' }, { key: 'berry', label: 'Berries' },
  { key: 'vine-fruit', label: 'Vines' }, { key: 'fruit-tree', label: 'Fruit trees' }, { key: 'nut-tree', label: 'Nut trees' }, { key: 'cover-crop', label: 'Cover crops' },
];

export default function PlantLibrary() {
  const { parcelId } = useLocalSearchParams<{ parcelId?: string }>();
  const t = useTheme();
  const { state } = useGarden(parcelId);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<PlantKind | 'all'>('all');

  const list = useMemo((): Array<{ p: PlantSpec; s: Suitability | null }> => {
    const base = searchPlants(q).filter((p) => kind === 'all' || p.kind === kind || (kind === 'vegetable' && p.kind === 'flower'));
    if (!state) return base.map((p) => ({ p, s: null }));
    return base
      .map((p) => ({ p, s: scorePlant(p, state.site, {}, undefined, 'your climate') }))
      .sort((a, b) => b.s.score - a.s.score || a.p.commonName.localeCompare(b.p.commonName));
  }, [q, kind, state]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <TextInput
          value={q} onChangeText={setQ} placeholder="Search plants (name, Latin name or family)" placeholderTextColor={t.muted}
          accessibilityLabel="Search plants" autoCorrect={false}
          style={[styles.search, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {KINDS.map((k) => <Chip key={k.key} label={k.label} active={kind === k.key} onPress={() => setKind(k.key)} />)}
        </ScrollView>
        {state && <Body muted>Sorted by fit to {state.parcel.name}’s climate. Sun and soil are scored per bed in the bed planner.</Body>}
      </View>
      <FlatList
        data={list}
        keyExtractor={(x) => x.p.id}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListEmptyComponent={<Body muted>No plants match “{q}”.</Body>}
        renderItem={({ item: { p, s } }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/plants/[plantId]', params: parcelId ? { plantId: p.id, parcelId } : { plantId: p.id } })}
            style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{p.commonName}</Text>
              <Text style={{ color: t.muted, fontStyle: 'italic' }}>{p.scientificName}</Text>
              <Text style={{ color: t.muted, fontSize: 13 }}>
                {p.sunHours.min}+ sun-hours · {p.frost} · {p.daysToMaturity ? `${p.daysToMaturity[0]}–${p.daysToMaturity[1]} days` : p.yearsToBearing ? `bears in ${p.yearsToBearing[0]}–${p.yearsToBearing[1]} yrs` : p.lifecycle}
              </Text>
            </View>
            {s && <VerdictBadge s={s} />}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
});
