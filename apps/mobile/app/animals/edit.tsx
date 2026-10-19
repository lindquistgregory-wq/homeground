/**
 * Add or edit one of the user's own animals (prompt §5, phase 7; free), mirroring plants/edit.tsx:
 * start blank or copy a library species, enter what you know, pick a drawing, and validate before
 * saving. Copying keeps the library's safety figures (heat onset, space, groups), which is usually
 * the safer start. Unknown figures stay empty rather than guessed.
 */
import {
  HOUSING_KINDS, allAnimals, blankAnimalSpec, copyAnimalSpec, objectType, searchAnimals, validateAnimalSpec,
  type AnimalKind, type AnimalSpec, type Purpose, type Tolerance,
} from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../src/components/Text';
import { AnimalArt } from '../../src/components/AnimalArt';
import { ANIMAL_SHAPES, artForAnimal, type AnimalArtSpec } from '../../src/components/animalArtMap';
import { ART_COLORS } from '../../src/components/plantArtMap';
import { Chip } from '../../src/components/plants';
import { SearchField } from '../../src/components/kit';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { recordsUsingSpecies } from '../../src/db/customAnimals';
import { newCustomAnimalId, useCustomAnimals } from '../../src/services/customAnimals';

const KINDS: Array<[AnimalKind, string]> = [
  ['poultry', 'Poultry'], ['waterfowl', 'Ducks & geese'], ['small-stock', 'Rabbits & small stock'], ['ruminant', 'Goats & sheep'],
  ['pig', 'Pigs'], ['cattle', 'Cattle'], ['equine', 'Horses & donkeys'], ['pollinator', 'Bees'], ['working', 'Guardian, cat or fiber'],
  ['aquatic', 'Fish'], ['invertebrate', 'Worms'],
];
const PURPOSES: Purpose[] = ['eggs', 'meat', 'milk', 'fiber', 'honey', 'guardian', 'pest-control', 'grazing', 'breeding', 'riding', 'work', 'rodent-control', 'compost'];
const LEVELS: Array<[Tolerance, string]> = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
type Range = [number, number];

export default function EditCustomAnimal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const t = useTheme();
  const existing = useCustomAnimals((s) => (id ? s.list.find((c) => c.spec.id === id) : undefined));
  const { save, remove } = useCustomAnimals();
  const [draft, setDraft] = useState<AnimalSpec>(() => existing?.spec ?? blankAnimalSpec(newCustomAnimalId()));
  const [art, setArt] = useState<AnimalArtSpec>(() => existing?.art ?? { shape: 'hen', main: '#b5652b' });
  const [q, setQ] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  // Number fields keep their own text; re-key them when a copy replaces the draft.
  const [rev, setRev] = useState(0);
  const set = (p: Partial<AnimalSpec>) => setDraft((d) => ({ ...d, ...p }));

  const startFrom = (a: AnimalSpec) => {
    setDraft(copyAnimalSpec(a, draft.id));
    setArt({ ...artForAnimal(a.id) });
    setQ('');
    setRev((r) => r + 1);
  };

  const onSave = async () => {
    const e = validateAnimalSpec(draft, undefined, { custom: true });
    const half = (r: Range | null | undefined) => !!r && (!Number.isFinite(r[0]) || !Number.isFinite(r[1]));
    if ([draft.spaceIndoorSqFt, draft.spaceOutdoorSqFt, draft.pastureAcresPerHead, draft.waterGalPerDay, draft.lifespanYears, draft.reproduction.gestationDays, draft.reproduction.incubationDays, draft.production.eggsPerYear].some(half))
      e.push('A range has only one number: enter both, or clear both.');
    setErrors(e);
    if (e.length) return;
    await save(draft, art);
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {!existing && (
        <Card title="Start from" icon="content-copy">
          <Body muted>Copying a library animal keeps its sourced space, water and heat figures, which you can then adjust.</Body>
          <SearchField value={q} onChangeText={setQ} placeholder="Search the library to copy" accessibilityLabel="Search the animal library to copy" />
          {q.trim() !== '' && <View style={styles.chips}>{searchAnimals(q, allAnimals().filter((a) => !a.id.startsWith('custom-'))).slice(0, 8).map((a) => <Chip key={a.id} label={a.commonName} active={false} onPress={() => startFrom(a)} />)}</View>}
        </Card>
      )}

      <Card title="About it" icon="paw-outline">
        <View style={styles.head}>
          <AnimalArt animalId={draft.id} size={64} art={art} />
          <View style={{ flex: 1 }}>
            <TextInput value={draft.commonName} onChangeText={(v) => set({ commonName: v })} placeholder="Name, e.g. Silkie bantams" placeholderTextColor={t.muted} accessibilityLabel="Animal name" style={[styles.input, { color: t.text, borderColor: t.border }]} />
            <TextInput value={draft.scientificName} onChangeText={(v) => set({ scientificName: v })} placeholder="Scientific name (optional)" placeholderTextColor={t.muted} accessibilityLabel="Scientific name" style={[styles.input, { color: t.text, borderColor: t.border }]} />
          </View>
        </View>
        <Text style={[styles.label, { color: t.text }]}>Kind</Text>
        <View style={styles.chips}>{KINDS.map(([k, l]) => <Chip key={k} label={l} active={draft.kind === k} onPress={() => set({ kind: k, housingObjects: draft.housingObjects.length ? draft.housingObjects : blankAnimalSpec('x', k).housingObjects })} />)}</View>
        <Text style={[styles.label, { color: t.text }]}>Kept for</Text>
        <View style={styles.chips}>{PURPOSES.map((p) => <Chip key={p} label={p.replace('-', ' ')} active={draft.purposes.includes(p)} onPress={() => set({ purposes: draft.purposes.includes(p) ? draft.purposes.filter((x) => x !== p) : [...draft.purposes, p] })} />)}</View>
      </Card>

      <Card title="Drawing" icon="palette-outline">
        <View style={styles.chips}>
          {ANIMAL_SHAPES.map((s) => (
            <Pressable key={s} accessibilityRole="button" accessibilityLabel={`Drawing: ${s}`} accessibilityState={{ selected: art.shape === s }} onPress={() => setArt({ ...art, shape: s })}
              style={[styles.pick, { borderColor: art.shape === s ? t.accent : t.border }]}>
              <AnimalArt animalId="" size={40} art={{ ...art, shape: s }} />
            </Pressable>
          ))}
        </View>
        <View style={styles.chips}>
          {ART_COLORS.map((c) => <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: art.main === c }} onPress={() => setArt({ ...art, main: c })} style={[styles.swatch, { backgroundColor: c, borderColor: art.main === c ? t.text : 'transparent' }]} />)}
        </View>
      </Card>

      <Card key={`needs-${rev}`} title="Needs" icon="home-outline">
        <Body muted>Use the larger figure when sources differ; space and water lean toward the animal’s comfort.</Body>
        <RangeField label="Shelter space per animal (sq ft)" value={draft.spaceIndoorSqFt} onChange={(v) => set({ spaceIndoorSqFt: v })} />
        <RangeField label="Outdoor space per animal (sq ft)" value={draft.spaceOutdoorSqFt} onChange={(v) => set({ spaceOutdoorSqFt: v })} />
        <RangeField label="Pasture per animal (acres)" value={draft.pastureAcresPerHead} onChange={(v) => set({ pastureAcresPerHead: v })} />
        <RangeField label="Water per day (gallons)" value={draft.waterGalPerDay} onChange={(v) => set({ waterGalPerDay: v })} />
        <NumberField label="Keep at least (group size)" value={draft.minGroupSize} onChange={(v) => set({ minGroupSize: v, livesAloneOk: v !== null && v <= 1 })} />
        <NumberField label="Heat stress begins at (°F, optional)" value={draft.heat.airOnsetF ?? null} onChange={(v) => set({ heat: { ...draft.heat, airOnsetF: v ?? undefined } })} />
        <Text style={[styles.label, { color: t.text }]}>Cold tolerance</Text>
        <View style={styles.chips}>{LEVELS.map(([k, l]) => <Chip key={k} label={l} active={draft.cold.tolerance === k} onPress={() => set({ cold: { ...draft.cold, tolerance: k } })} />)}</View>
        <Text style={[styles.label, { color: t.text }]}>Noise</Text>
        <View style={styles.chips}>{LEVELS.map(([k, l]) => <Chip key={k} label={l} active={draft.noise === k} onPress={() => set({ noise: k })} />)}</View>
      </Card>

      <Card title="Where it lives on the map" icon="map-marker-outline">
        <View style={styles.chips}>{[...HOUSING_KINDS].map((k) => <Chip key={k} label={objectType(k)?.name ?? k} active={draft.housingObjects.includes(k)} onPress={() => set({ housingObjects: draft.housingObjects.includes(k) ? draft.housingObjects.filter((x) => x !== k) : [...draft.housingObjects, k] })} />)}</View>
      </Card>

      <Card key={`prod-${rev}`} title="Production and breeding" icon="egg-outline">
        <RangeField label="Eggs per year" value={draft.production.eggsPerYear} onChange={(v) => set({ production: { ...draft.production, eggsPerYear: v } })} />
        <RangeField label="Gestation (days)" value={draft.reproduction.gestationDays} onChange={(v) => set({ reproduction: { ...draft.reproduction, gestationDays: v } })} />
        <RangeField label="Incubation (days)" value={draft.reproduction.incubationDays} onChange={(v) => set({ reproduction: { ...draft.reproduction, incubationDays: v } })} />
        <RangeField label="Lifespan (years)" value={draft.lifespanYears} onChange={(v) => set({ lifespanYears: v })} />
      </Card>

      {errors.length > 0 && <Card title="Before saving" icon="alert-outline">{errors.map((e) => <Text key={e} style={{ color: t.warn }}>• {e}</Text>)}</Card>}
      <Button title={existing ? 'Save' : 'Add to my animals'} onPress={() => void onSave()} />
      {existing && (
        <Button title="Delete" kind="secondary" onPress={async () => {
          const n = await recordsUsingSpecies(existing.spec.id);
          Alert.alert('Delete this animal?', n ? `${n} herd${n === 1 ? '' : 's'} or record${n === 1 ? '' : 's'} use it; they’ll show its id instead of a name.` : undefined, [
            { text: 'Cancel', style: 'cancel' },
            // Back past its (now empty) detail page to the library.
            { text: 'Delete', style: 'destructive', onPress: async () => { await remove(existing.spec.id); router.dismiss(2); } },
          ]);
        }} />
      )}
      <Body muted>Your animal’s figures are your own, so its fit and care notes say so. Local rules come first: check zoning before getting any animal.</Body>
    </ScrollView>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <Text style={{ color: t.text, flex: 1 }}>{label}</Text>
      <TextInput defaultValue={value === null ? '' : String(value)} keyboardType="decimal-pad" accessibilityLabel={label} placeholder="—" placeholderTextColor={t.muted}
        onEndEditing={(e) => { const s = e.nativeEvent.text.trim(); onChange(s === '' ? null : Number(s)); }} style={[styles.input, styles.num, { color: t.text, borderColor: t.border }]} />
    </View>
  );
}

function RangeField({ label, value, onChange }: { label: string; value: Range | null | undefined; onChange: (v: Range | null) => void }) {
  const t = useTheme();
  const [lo, setLo] = useState(value ? String(value[0]) : '');
  const [hi, setHi] = useState(value ? String(value[1]) : '');
  const push = (a: string, b: string) => onChange(a.trim() === '' && b.trim() === '' ? null : [a.trim() === '' ? NaN : Number(a), b.trim() === '' ? NaN : Number(b)]);
  return (
    <View style={styles.row}>
      <Text style={{ color: t.text, flex: 1 }}>{label}</Text>
      <TextInput value={lo} onChangeText={(v) => { setLo(v); push(v, hi); }} keyboardType="decimal-pad" accessibilityLabel={`${label}, lowest`} placeholder="low" placeholderTextColor={t.muted} style={[styles.input, styles.num, { color: t.text, borderColor: t.border }]} />
      <TextInput value={hi} onChangeText={(v) => { setHi(v); push(lo, v); }} keyboardType="decimal-pad" accessibilityLabel={`${label}, highest`} placeholder="high" placeholderTextColor={t.muted} style={[styles.input, styles.num, { color: t.text, borderColor: t.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 4 },
  label: { fontWeight: '600', marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, marginVertical: 4, fontSize: 15 },
  num: { width: 70, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pick: { borderWidth: 2, borderRadius: 12, padding: 2 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
});
