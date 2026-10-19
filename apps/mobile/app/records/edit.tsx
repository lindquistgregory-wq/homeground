/**
 * Add or edit an animal or pet (prompt §6). Adding can make several at once ("10 hatched on
 * Apr 2"), named "Hen 1…10" unless renamed later. Parents can be other records or an outside
 * animal by name. Sex, dates and tags are the owner's; nothing is inferred.
 */
import {
  HOUSEHOLD, allAnimals, animalById, isHousehold, isIsoDate, statusOptions, type AnimalRecord, type AnimalSex, type AnimalStatus,
} from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../../src/components/Text';
import { Chip } from '../../src/components/plants';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { herdsForParcel, type Herd } from '../../src/db/herds';
import { getAnimal, listAnimals, saveRecord } from '../../src/db/records';
import { herdLabel, isCurrent } from '../../src/services/animals';
import { useSettings } from '../../src/services/settings';

const SEXES: Array<[AnimalSex, string]> = [['female', 'Female'], ['male', 'Male'], ['castrated', 'Castrated / spayed'], ['unknown', 'Not sure']];

export default function EditAnimal() {
  const p = useLocalSearchParams<{ id?: string; parcelId?: string; herdId?: string; speciesId?: string; pet?: string }>();
  const t = useTheme();
  const showProcessing = useSettings((s) => s.showProcessing);
  const [orig, setOrig] = useState<AnimalRecord | null>(null);
  const [all, setAll] = useState<AnimalRecord[]>([]);
  const [herds, setHerds] = useState<Herd[]>([]);
  const [f, setF] = useState<Partial<AnimalRecord>>({ speciesId: p.speciesId ?? (p.pet ? 'household:dog' : undefined), herdId: p.herdId, parcelId: p.pet ? undefined : p.parcelId, sex: 'unknown', status: 'active' });
  const [count, setCount] = useState('1');
  const [sireOut, setSireOut] = useState('');
  const [damOut, setDamOut] = useState('');
  const pet = !!p.pet || (!!f.speciesId && isHousehold(f.speciesId));

  useEffect(() => {
    void (async () => {
      setAll(await listAnimals());
      if (p.id) {
        const a = await getAnimal(p.id);
        if (a) { setOrig(a); setF(a); setSireOut(a.outsideSire?.name ?? ''); setDamOut(a.outsideDam?.name ?? ''); }
      }
    })();
  }, [p.id]);
  useEffect(() => { if (f.parcelId) void herdsForParcel(f.parcelId).then((hs) => setHerds(hs.filter(isCurrent))); }, [f.parcelId]);

  const sameSpecies = useMemo(() => all.filter((a) => a.speciesId === f.speciesId && a.id !== f.id), [all, f.speciesId, f.id]);
  const set = (patch: Partial<AnimalRecord>) => setF((x) => ({ ...x, ...patch }));
  const n = Math.max(1, Math.min(200, Math.floor(Number(count) || 1)));
  const dateBad = (v?: string) => !!v && !isIsoDate(v);

  const save = async () => {
    if (!f.speciesId) return Alert.alert('Animal', 'Choose a species.');
    if (!f.name?.trim()) return Alert.alert('Animal', n > 1 ? 'Enter a name to number them by, such as “Hen”.' : 'Enter a name or tag.');
    if (dateBad(f.birthDate) || dateBad(f.acquiredOn)) return Alert.alert('Dates', 'Use YYYY-MM-DD, for example 2026-04-02.');
    const base: Omit<AnimalRecord, 'id'> = {
      ...(f as AnimalRecord), name: f.name.trim(), createdAt: orig?.createdAt ?? new Date().toISOString(),
      outsideSire: !f.sireId && sireOut.trim() ? { name: sireOut.trim() } : undefined,
      outsideDam: !f.damId && damOut.trim() ? { name: damOut.trim() } : undefined,
      parcelId: pet ? undefined : f.parcelId,
      herdId: pet ? undefined : f.herdId,
    };
    if (orig) await saveRecord('animals', { ...base, id: orig.id });
    else for (let i = 1; i <= n; i++) await saveRecord('animals', { ...base, name: n > 1 ? `${base.name} ${i}` : base.name });
    router.back();
  };

  const field = (label: string, value: string | undefined, on: (v: string) => void, opts: { date?: boolean; hint?: string } = {}) => (
    <TextInput value={value ?? ''} onChangeText={on} placeholder={opts.hint ?? label} placeholderTextColor={t.muted} accessibilityLabel={label}
      keyboardType={opts.date ? 'numbers-and-punctuation' : 'default'} style={[styles.input, { color: t.text, borderColor: opts.date && dateBad(value) ? t.bad : t.border }]} />
  );

  const speciesChoices = pet ? (Object.keys(HOUSEHOLD) as Array<keyof typeof HOUSEHOLD>).map((id) => [id, HOUSEHOLD[id]] as const) : allAnimals().map((a) => [a.id, a.commonName] as const);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Card title={pet ? 'Pet' : 'Species'} icon="paw-outline">
        <View style={styles.chips}>
          {speciesChoices.map(([id, name]) => <Chip key={id} label={name} active={f.speciesId === id} disabled={!!orig && orig.speciesId !== id && !pet} onPress={() => set({ speciesId: id, herdId: herds.find((h) => h.speciesId === id)?.id, sireId: undefined, damId: undefined })} />)}
        </View>
      </Card>

      <Card title="Who" icon="card-account-details-outline">
        {!orig && !pet && (
          <View style={[styles.chips, { alignItems: 'center' }]}>
            <Body>How many?</Body>
            <TextInput value={count} onChangeText={setCount} keyboardType="number-pad" accessibilityLabel="How many to add" style={[styles.input, styles.count, { color: t.text, borderColor: t.border }]} />
            {n > 1 && <Body muted>Named “{f.name?.trim() || 'Name'} 1” to “{f.name?.trim() || 'Name'} {n}”.</Body>}
          </View>
        )}
        {field(n > 1 ? 'Name to number them by' : 'Name', f.name, (v) => set({ name: v }))}
        {field('Tag or ID', f.tag, (v) => set({ tag: v || undefined }), { hint: pet ? 'Microchip or tag (optional)' : 'Ear tag, leg band, scrapie ID or microchip (optional)' })}
        <View style={styles.chips}>{SEXES.map(([k, l]) => <Chip key={k} label={l} active={f.sex === k} onPress={() => set({ sex: k })} />)}</View>
        {field('Born or hatched', f.birthDate, (v) => set({ birthDate: v || undefined }), { date: true, hint: 'Born or hatched (YYYY-MM-DD, optional)' })}
        {field('Breed', f.breed, (v) => set({ breed: v || undefined }), { hint: 'Breed (optional)' })}
        {field('Colour and markings', f.colorMarkings, (v) => set({ colorMarkings: v || undefined }), { hint: 'Colour and markings (optional)' })}
        {!pet && f.speciesId && animalById(f.speciesId)?.reproduction.matingRules?.some((r) => r.ifBoth === 'polled') && (
          <Chip label="Naturally polled (hornless)" active={!!f.traits?.includes('polled')} onPress={() => set({ traits: f.traits?.includes('polled') ? f.traits.filter((x) => x !== 'polled') : [...(f.traits ?? []), 'polled'] })} />
        )}
      </Card>

      {!pet && herds.some((h) => h.speciesId === f.speciesId) && (
        <Card title="Group" icon="account-group-outline">
          <View style={styles.chips}>
            <Chip label="None" active={!f.herdId} onPress={() => set({ herdId: undefined })} />
            {herds.filter((h) => h.speciesId === f.speciesId).map((h) => <Chip key={h.id} label={herdLabel(h)} active={f.herdId === h.id} onPress={() => set({ herdId: h.id })} />)}
          </View>
        </Card>
      )}

      {!pet && (
        <Card title="Parents" icon="family-tree">
          {(['sire', 'dam'] as const).map((which) => {
            const options = sameSpecies.filter((a) => (which === 'sire' ? a.sex === 'male' || a.sex === 'castrated' || a.sex === 'unknown' : a.sex === 'female' || a.sex === 'unknown'));
            const key = which === 'sire' ? 'sireId' : 'damId';
            return (
              <View key={which} style={{ marginBottom: 6 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{which === 'sire' ? 'Sire (father)' : 'Dam (mother)'}</Text>
                {options.length > 0 && (
                  <View style={styles.chips}>
                    <Chip label="Not in my records" active={!f[key]} onPress={() => set({ [key]: undefined })} />
                    {options.slice(0, 20).map((a) => <Chip key={a.id} label={a.name} active={f[key] === a.id} onPress={() => set({ [key]: a.id })} />)}
                  </View>
                )}
                {!f[key] && field(which === 'sire' ? 'Outside sire' : 'Outside dam', which === 'sire' ? sireOut : damOut, which === 'sire' ? setSireOut : setDamOut, { hint: 'Name and registration, if outside your animals (optional)' })}
              </View>
            );
          })}
          {field('Registration number', f.registrationNo, (v) => set({ registrationNo: v || undefined }), { hint: 'Registration number (optional)' })}
        </Card>
      )}

      <Card title="Where from" icon="truck-outline">
        {field('Acquired on', f.acquiredOn, (v) => set({ acquiredOn: v || undefined }), { date: true, hint: 'Acquired on (YYYY-MM-DD, optional)' })}
        {field('Source', f.source, (v) => set({ source: v || undefined }), { hint: 'Breeder, hatchery or shelter (optional)' })}
        {orig && <View style={styles.chips}>{statusOptions(showProcessing, f.speciesId).map((s) => <Chip key={s} label={s} active={f.status === s} onPress={() => set({ status: s as AnimalStatus })} />)}</View>}
        {field('Notes', f.notes, (v) => set({ notes: v || undefined }), { hint: 'Notes (optional)' })}
      </Card>

      <Button title={orig ? 'Save' : n > 1 ? `Add ${n}` : 'Add'} onPress={() => void save()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, marginVertical: 5, fontSize: 15 },
  count: { width: 70, textAlign: 'center' },
});
