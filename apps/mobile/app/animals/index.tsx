/**
 * Animals library (prompt §5): its own screen, never part of the plant library (owner decision 2).
 * Search with aliases, kind filters, a drawing per species, and a fit badge for the property.
 */
import { scoreAnimal, searchAnimals, spacePerHeadSqFt, type AnimalKind, type AnimalSpec, type AnimalSuitability } from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/components/Text';
import { AnimalArt } from '../../src/components/AnimalArt';
import { Chip, VerdictBadge } from '../../src/components/plants';
import { EmptyState, SearchField } from '../../src/components/kit';
import { Body, useTheme } from '../../src/components/ui';
import { useGarden } from '../../src/services/useGarden';
import { useSettings } from '../../src/services/settings';
import { siteForAnimals } from '../../src/services/animals';
import { useCustomAnimals } from '../../src/services/customAnimals';

const KINDS: Array<{ key: AnimalKind | 'all' | 'stock'; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'poultry', label: 'Poultry' }, { key: 'waterfowl', label: 'Ducks & geese' },
  { key: 'small-stock', label: 'Rabbits' }, { key: 'ruminant', label: 'Goats & sheep' }, { key: 'stock', label: 'Pigs & cattle' },
  { key: 'pollinator', label: 'Bees' }, { key: 'working', label: 'Guardians & fiber' },
];


export default function AnimalLibrary() {
  const { parcelId } = useLocalSearchParams<{ parcelId?: string }>();
  const t = useTheme();
  const { animals, setAnimals, showProcessing } = useSettings();
  // Re-read the list when the user's own animals change.
  const customVersion = useCustomAnimals((s) => s.version);
  const { state } = useGarden(parcelId);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('all');

  const list = useMemo((): Array<{ a: AnimalSpec; s: AnimalSuitability | null }> => {
    const base = searchAnimals(q).filter((a) => kind === 'all' || (kind === 'stock' ? a.kind === 'pig' || a.kind === 'cattle' : a.kind === kind));
    if (!state) return base.map((a) => ({ a, s: null }));
    const site = siteForAnimals(state);
    return base.map((a) => ({ a, s: scoreAnimal(a, site) })).sort((x, y) => y.s!.score - x.s!.score || x.a.commonName.localeCompare(y.a.commonName));
  }, [q, kind, state, customVersion]);

  if (animals !== 'yes')
    return (
      <View style={{ padding: 16 }}>
        <EmptyState icon="paw" title="Animal features are off" text="Plotwright can help you plan for livestock and bees: where they live on your land, care dates and heat alerts. Turn them on to see the animal library." action="Show animal features" onAction={() => setAnimals('yes')} />
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search animals" accessibilityLabel="Search animals by name or breed" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {KINDS.map((k) => <Chip key={k.key} label={k.label} active={kind === k.key} onPress={() => setKind(k.key)} />)}
        </ScrollView>
        {state && <Body muted>Sorted by fit to {state.parcel.name}’s climate and size.</Body>}
        <Chip label="Add your own animal" active={false} onPress={() => router.push('/animals/edit')} />
      </View>
      <FlatList
        data={list}
        keyExtractor={(x) => x.a.id}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListEmptyComponent={<Body muted>No animals match “{q}”.</Body>}
        renderItem={({ item: { a, s } }) => {
          const space = spacePerHeadSqFt(a, 'indoor');
          const meta = [space ? `${space} sq ft each` : a.pastureAcresPerHead ? `${Math.max(...a.pastureAcresPerHead)} acre each` : null, a.purposes.map((x) => (showProcessing || x !== 'meat' ? x : 'raised for meat')).slice(0, 2).join(', '), a.minGroupSize && a.minGroupSize > 1 ? `keep ${a.minGroupSize}+` : null].filter(Boolean).join(' · ');
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/animals/[animalId]', params: parcelId ? { animalId: a.id, parcelId } : { animalId: a.id } })}
              style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}
            >
              <AnimalArt animalId={a.id} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{a.commonName}</Text>
                <Text style={{ color: t.muted, fontStyle: 'italic' }}>{a.scientificName}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>{meta}</Text>
              </View>
              {s && <VerdictBadge s={s} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 10, marginBottom: 8 },
});
