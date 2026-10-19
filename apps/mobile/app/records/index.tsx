/**
 * My animals (prompt §6, phase 5; free): herds and individual animals on each property, household
 * pets, health dates coming due, a one-tap daily egg count, and import and export. Health and
 * welfare stay free on every plan.
 */
import {
  animalById, healthDue, HEALTH_TYPES, isHousehold, welfareNote, type AnimalLog, type AnimalRecord, type HealthDue,
} from '@plotwright/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/components/Text';
import { AnimalArt } from '../../src/components/AnimalArt';
import { Chip } from '../../src/components/plants';
import { EmptyState } from '../../src/components/kit';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { deleteHerd, herdsForParcel, type Herd } from '../../src/db/herds';
import { getDesign } from '../../src/db/designs';
import { listParcels, type ParcelRecord } from '../../src/db/parcels';
import { allRecords, listAnimals, saveRecord } from '../../src/db/records';
import { herdLabel, isCurrent, localToday } from '../../src/services/animals';
import { enableReminders, healthSubjects, remindersAllowed, speciesName } from '../../src/services/healthReminders';
import { exportRecords, type RecordsExport } from '../../src/services/recordsExport';
import { useSettings } from '../../src/services/settings';

interface Data {
  parcels: ParcelRecord[];
  herds: Herd[];
  /** Herds whose coop or paddock is no longer in the design. */
  orphans: Set<string>;
  animals: AnimalRecord[];
  due: Array<HealthDue & { who: string }>;
  eggsToday: Map<string, AnimalLog>;
  reminders: boolean;
}

export default function MyAnimals() {
  const t = useTheme();
  const { animals: animalsOn, setAnimals } = useSettings();
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(async () => {
    const parcels = await listParcels();
    const herds = (await Promise.all(parcels.map((p) => herdsForParcel(p.id)))).flat().filter(isCurrent);
    const animals = await listAnimals();
    const orphans = new Set<string>();
    const designs = new Map<string, Awaited<ReturnType<typeof getDesign>>>();
    for (const h of herds) {
      if (!designs.has(h.designId)) designs.set(h.designId, await getDesign(h.designId));
      if (!designs.get(h.designId)?.objects.some((o) => o.id === h.objectId)) orphans.add(h.id);
    }
    const today = localToday();
    const who = await healthSubjects();
    const due = healthDue(await allRecords('healthRecords'), today, 30).map((d) => ({ ...d, who: who(d.record) }));
    const eggsToday = new Map((await allRecords('animalLogs')).filter((l) => l.kind === 'eggs' && l.date === today && l.herdId && !l.animalId).map((l) => [l.herdId!, l]));
    setData({ parcels, herds, orphans, animals, due, eggsToday, reminders: await remindersAllowed() });
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (animalsOn !== 'yes')
    return (
      <View style={{ padding: 16 }}>
        <EmptyState icon="paw" title="Animal features are off" text="Keep records for your animals and pets: health and vaccination dates with reminders, egg and milk logs, breeding and due dates." action="Show animal features" onAction={() => setAnimals('yes')} />
      </View>
    );
  if (!data) return <Body>Loading…</Body>;

  const today = localToday();
  const pets = data.animals.filter((a) => isHousehold(a.speciesId));
  const stock = data.animals.filter((a) => !isHousehold(a.speciesId));
  const loose = stock.filter((a) => !a.herdId || !data.herds.some((h) => h.id === a.herdId));
  const firstParcel = data.parcels[0]?.id;

  // Welfare: social species below their group minimum, counting herds and individuals not in one.
  const activeBySpecies = new Map<string, number>();
  for (const h of data.herds.filter((x) => x.status === 'active')) activeBySpecies.set(h.speciesId, (activeBySpecies.get(h.speciesId) ?? 0) + h.count);
  for (const a of loose.filter((x) => x.status === 'active')) activeBySpecies.set(a.speciesId, (activeBySpecies.get(a.speciesId) ?? 0) + 1);
  const welfare = [...activeBySpecies].flatMap(([id, n]) => { const sp = animalById(id); const w = sp && welfareNote(sp, n); return w ? [w] : []; });

  const logEgg = async (h: Herd, delta: number) => {
    const cur = data.eggsToday.get(h.id);
    const value = Math.max(0, (cur?.value ?? 0) + delta);
    const saved = await saveRecord('animalLogs', { ...(cur ?? { parcelId: h.parcelId, herdId: h.id, date: today, kind: 'eggs' as const, unit: 'eggs' }), value });
    setData((d) => d && { ...d, eggsToday: new Map(d.eggsToday).set(h.id, saved) });
  };

  const exportMenu = () => {
    const opts: Array<[string, RecordsExport]> = [['Animals (CSV)', 'animals'], ['Production logs (CSV)', 'logs'], ['Health records (CSV)', 'health'], ['Breeding records (CSV)', 'breeding'], ['Everything (JSON)', 'json']];
    const run = (k: RecordsExport) => exportRecords(k).catch((e: Error) => Alert.alert('Export', e.message));
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ options: [...opts.map((o) => o[0]), 'Cancel'], cancelButtonIndex: opts.length }, (i) => i < opts.length && void run(opts[i]![1]));
    else Alert.alert('Export records', 'Choose what to export.', [...opts.slice(0, 2).map(([l, k]) => ({ text: l, onPress: () => void run(k) })), { text: 'More…', onPress: () => Alert.alert('Export records', undefined, opts.slice(2).map(([l, k]) => ({ text: l, onPress: () => void run(k) }))) }]);
  };

  const row = (a: AnimalRecord) => (
    <Pressable key={a.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/records/[id]', params: { id: a.id, type: 'animal' } })} style={[styles.row, { borderColor: t.border }]}>
      <AnimalArt animalId={a.speciesId} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontWeight: '600' }}>{a.name}{a.tag ? ` · ${a.tag}` : ''}</Text>
        <Body muted>{[a.breed ?? speciesName(a.speciesId), a.sex !== 'unknown' ? a.sex : null, a.status !== 'active' ? a.status : null].filter(Boolean).join(' · ')}</Body>
      </View>
      <Text style={{ color: t.muted }}>›</Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {(data.due.length > 0 || !data.reminders) && (
        <Card title="Health dates" icon="calendar-alert">
          {data.due.map((d) => (
            <Pressable key={d.record.id} accessibilityRole="button" onPress={() => d.record.animalId
              ? router.push({ pathname: '/records/[id]', params: { id: d.record.animalId, type: 'animal' } })
              : d.record.herdId && router.push({ pathname: '/records/[id]', params: { id: d.record.herdId, type: 'herd', parcelId: d.record.parcelId ?? '' } })}>
              <Text style={{ color: d.overdue ? t.bad : d.days <= 7 ? t.warn : t.text, fontWeight: '600', paddingVertical: 3 }}>
                {d.who}: {d.record.product || HEALTH_TYPES[d.record.type]} {d.overdue ? `was due ${d.record.nextDue}` : d.days === 0 ? 'due today' : `due ${d.record.nextDue}`}
              </Text>
            </Pressable>
          ))}
          {data.due.length === 0 && <Body muted>No health dates in the next 30 days.</Body>}
          {!data.reminders && <Button title="Remind me before due dates" kind="secondary" icon="bell-outline" onPress={async () => { if (await enableReminders()) await load(); else Alert.alert('Reminders', 'Notifications are turned off for Plotwright in your phone’s settings.'); }} />}
        </Card>
      )}

      {welfare.map((w) => <Text key={w} style={{ color: t.warn, marginBottom: 8 }}>{w}</Text>)}

      {data.herds.map((h) => {
        const sp = animalById(h.speciesId);
        const members = stock.filter((a) => a.herdId === h.id);
        const eggs = data.eggsToday.get(h.id)?.value ?? 0;
        return (
          <Card key={h.id} title={herdLabel(h, sp)} icon="paw-outline">
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/records/[id]', params: { id: h.id, type: 'herd', parcelId: h.parcelId } })} style={[styles.row, { borderColor: t.border, borderTopWidth: 0 }]}>
              <AnimalArt animalId={h.speciesId} size={44} />
              <View style={{ flex: 1 }}>
                <Body>{h.status === 'active' ? 'On the land' : 'Planned'}{data.parcels.length > 1 ? ` · ${data.parcels.find((p) => p.id === h.parcelId)?.name ?? ''}` : ''}</Body>
                <Body muted>Group logs, health and breeding ›</Body>
              </View>
            </Pressable>
            {sp?.purposes.includes('eggs') && h.status === 'active' && (
              <View style={[styles.eggs, { backgroundColor: t.surface }]}>
                <Text style={{ color: t.text, fontWeight: '600', flex: 1 }} accessibilityLiveRegion="polite">Eggs today: {eggs}</Text>
                <Chip label="−1" active={false} disabled={eggs <= 0} onPress={() => void logEgg(h, -1)} />
                <Chip label="+1 egg" active onPress={() => void logEgg(h, 1)} />
              </View>
            )}
            {data.orphans.has(h.id) && (
              <View style={{ marginVertical: 4 }}>
                <Text style={{ color: t.warn }}>Its housing is no longer in the design, so it gets no capacity checks or weather alerts.</Text>
                <Chip label="Remove this group" active={false} onPress={() => Alert.alert('Remove group?', `Remove ${herdLabel(h, sp)}? Records for individual animals stay.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await deleteHerd(h.id); await load(); } }])} />
              </View>
            )}
            {members.map(row)}
            {sp?.kind !== 'pollinator' && <Chip label={`Add ${sp?.commonName.toLowerCase() ?? 'animals'} by name or tag`} active={false} onPress={() => router.push({ pathname: '/records/edit', params: { parcelId: h.parcelId, herdId: h.id, speciesId: h.speciesId } })} />}
          </Card>
        );
      })}

      {loose.length > 0 && <Card title="Animals" icon="paw">{loose.map(row)}</Card>}

      <Card title="Household pets" icon="dog">
        {pets.length ? pets.map(row) : <Body muted>Dogs, cats and other pets get a profile, health and vaccination records, and reminders.</Body>}
        <Button title="Add a pet" kind="secondary" icon="plus" onPress={() => router.push({ pathname: '/records/edit', params: { pet: '1' } })} />
      </Card>

      {data.herds.length === 0 && stock.length === 0 && (
        <Body muted>To keep records for livestock, add the animals here, or plan a herd in its housing (Design, tap a coop or paddock, then “Plan animals here”).</Body>
      )}
      <Button title="Add an animal" icon="plus" disabled={!firstParcel} onPress={() => router.push({ pathname: '/records/edit', params: { parcelId: firstParcel ?? '' } })} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button title="Import CSV" kind="secondary" icon="file-upload-outline" disabled={!firstParcel} onPress={() => router.push({ pathname: '/records/import', params: { parcelId: firstParcel ?? '' } })} /></View>
        <View style={{ flex: 1 }}><Button title="Export" kind="secondary" icon="export-variant" onPress={exportMenu} /></View>
      </View>
      <Body muted>Records stay on this phone and in your own cloud account if you sync. Plotwright records what you and your veterinarian decide; it never suggests vaccines, treatments, schedules or doses.</Body>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  eggs: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, padding: 8, marginVertical: 6 },
});
