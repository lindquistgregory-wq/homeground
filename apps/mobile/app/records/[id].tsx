/**
 * Records for one animal, pet or group (prompt §6; free): profile, production logs with a chart,
 * breeding with due dates, and health records with next-due reminders and a "share with my vet"
 * export. The app stores what the owner and their vet decide; it never suggests products or doses.
 */
import {
  HEALTH_TYPES, LOG_KINDS, PHOTO, animalById, eggsPerHenPerWeek, expectedDue, isHousehold, isIsoDate, logSeries, logTotal, weanedPerLitter, welfareNote,
  type AnimalLog, type AnimalRecord, type BreedingMethod, type BreedingRecord, type HealthRecord, type HealthType, type LogKind, type LogPeriod,
} from '@plotwright/core';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from '../../src/components/Text';
import { AnimalArt } from '../../src/components/AnimalArt';
import { Chip } from '../../src/components/plants';
import { MoreInfo } from '../../src/components/kit';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { herdsForParcel, type Herd } from '../../src/db/herds';
import { deleteAnimalAndRecords, deleteRecord, getAnimal, listAnimals, recordsFor, saveRecord } from '../../src/db/records';
import { herdLabel, localToday } from '../../src/services/animals';
import { refreshHealthReminders, speciesName } from '../../src/services/healthReminders';
import { exportVetHistory } from '../../src/services/recordsExport';
import { deletePhotoFile, photoUri, pickAnimalPhoto } from '../../src/services/photos';

const METHODS: Array<[BreedingMethod, string]> = [['natural', 'Natural'], ['ai', 'AI'], ['eggs-set', 'Eggs set'], ['other', 'Other']];

interface Loaded {
  animal?: AnimalRecord;
  herd?: Herd;
  speciesId: string;
  title: string;
  logs: AnimalLog[];
  breeding: BreedingRecord[];
  health: HealthRecord[];
  names: Map<string, string>;
  males: AnimalRecord[];
}

export default function RecordsScreen() {
  const { id, type, parcelId } = useLocalSearchParams<{ id: string; type: 'animal' | 'herd'; parcelId?: string }>();
  const t = useTheme();
  const [d, setD] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const owner = type === 'herd' ? { herdId: id } : { animalId: id };
    const everyone = await listAnimals();
    let animal: AnimalRecord | undefined, herd: Herd | undefined;
    if (type === 'herd') herd = (await herdsForParcel(parcelId ?? '')).find((h) => h.id === id);
    else animal = await getAnimal(id);
    if (!animal && !herd) return setMissing(true);
    const speciesId = animal?.speciesId ?? herd!.speciesId;
    const [logs, breeding, health] = await Promise.all([recordsFor('animalLogs', owner), recordsFor('breedingRecords', owner), recordsFor('healthRecords', owner)]);
    setD({
      animal, herd, speciesId, title: animal?.name ?? herdLabel(herd!), logs: logs.sort((a, b) => b.date.localeCompare(a.date)),
      breeding: breeding.sort((a, b) => b.bredOn.localeCompare(a.bredOn)), health: health.sort((a, b) => b.date.localeCompare(a.date)),
      names: new Map(everyone.map((a) => [a.id, a.name])), males: everyone.filter((a) => a.speciesId === speciesId && a.sex === 'male' && a.status === 'active'),
    });
  }, [id, type, parcelId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (missing) return <Body>This record is no longer on this phone.</Body>;
  if (!d) return <Body>Loading…</Body>;

  const sp = animalById(d.speciesId);
  const pet = isHousehold(d.speciesId);
  const a = d.animal;
  const owner = { parcelId: a?.parcelId ?? d.herd?.parcelId, ...(a ? { animalId: a.id } : { herdId: d.herd!.id }) };
  const canBreed = !pet && sp && (sp.reproduction.gestationDays || sp.reproduction.incubationDays) && (!a || a.sex === 'female' || a.sex === 'unknown');
  const groupSize = d.herd?.count ?? 1;
  const welfare = sp && d.herd?.status === 'active' ? welfareNote(sp, d.herd.count) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        {a?.photos?.[0] ? <Image source={{ uri: a.photos[0].thumb }} style={styles.avatar} accessibilityLabel={`Photo of ${a.name}`} /> : <AnimalArt animalId={d.speciesId} size={72} />}
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 24, fontWeight: '700' }} accessibilityRole="header">{d.title}</Text>
          <Body muted>{[a?.breed ?? speciesName(d.speciesId), a && a.sex !== 'unknown' ? a.sex : null, a?.tag, a && a.status !== 'active' ? a.status : null].filter(Boolean).join(' · ')}</Body>
        </View>
      </View>
      {welfare && <Text style={{ color: t.warn, marginBottom: 8 }}>{welfare}</Text>}

      {a && (
        <Card title="Profile" icon="card-account-details-outline">
          {[
            ['Born', a.birthDate], ['Acquired', a.acquiredOn], ['From', a.source], ['Markings', a.colorMarkings], ['Registration', a.registrationNo],
            ['Sire', a.sireId ? d.names.get(a.sireId) : a.outsideSire?.name], ['Dam', a.damId ? d.names.get(a.damId) : a.outsideDam?.name], ['Notes', a.notes],
          ].filter(([, v]) => v).map(([k, v]) => <Body key={k}>{k}: {v}</Body>)}
          <Photos a={a} onChange={async (photos) => { await saveRecord('animals', { ...a, photos }); await load(); }} />
          <View style={styles.chips}>
            <Chip label="Edit" active={false} onPress={() => router.push({ pathname: '/records/edit', params: { id: a.id } })} />
            {!pet && <Chip label="Pedigree" active={false} onPress={() => router.push({ pathname: '/herdbook/[animalId]', params: { animalId: a.id } })} />}
            <Chip label="Delete" active={false} onPress={() => Alert.alert('Delete record?', `Delete ${a.name} and all of ${a.name}’s logs, breeding and health records? To keep the history, edit the status instead (sold, retired, deceased).`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => { a.photos?.forEach(deletePhotoFile); await deleteAnimalAndRecords(a.id); await refreshHealthReminders().catch(() => 0); router.back(); } },
            ])} />
          </View>
        </Card>
      )}

      <HealthCard records={d.health} pet={pet} onAdd={async (r) => { await saveRecord('healthRecords', { ...owner, ...r }); await refreshHealthReminders().catch(() => 0); await load(); }}
        onRemove={async (r) => { await deleteRecord('healthRecords', r.id); await refreshHealthReminders().catch(() => 0); await load(); }}
        onExport={a ? (fmt) => exportVetHistory(a, d.health, fmt).catch((e: Error) => Alert.alert('Export', e.message)) : undefined} />

      <LogsCard logs={d.logs} groupSize={groupSize}
        kinds={pet ? ['weight'] : (Object.keys(LOG_KINDS) as LogKind[]).filter((k) => {
          const purpose = LOG_KINDS[k].purpose;
          return !purpose || !!sp?.purposes.includes(purpose as never) || (purpose === 'breeding' && !!sp?.reproduction.litterSize);
        })}
        onAdd={async (l) => { await saveRecord('animalLogs', { ...owner, ...l }); await load(); }}
        onRemove={async (l) => { await deleteRecord('animalLogs', l.id); await load(); }} />

      {canBreed && (
        <BreedingCard records={d.breeding} males={d.males} names={d.names} eggs={!sp!.reproduction.gestationDays}
          onAdd={async (r) => {
            const due = expectedDue(sp, r.bredOn, r.method);
            await saveRecord('breedingRecords', { ...owner, damId: a?.id, speciesId: d.speciesId, ...r, dueFrom: due?.from, dueTo: due?.to });
            await load();
          }}
          onOutcome={async (r, born, alive) => { await saveRecord('breedingRecords', { ...r, born, alive }); await load(); }}
          onRemove={async (r) => { await deleteRecord('breedingRecords', r.id); await load(); }} />
      )}
      {sp && <Button title={`${sp.commonName}: care and details`} kind="secondary" onPress={() => router.push({ pathname: '/animals/[animalId]', params: { animalId: sp.id, ...(owner.parcelId ? { parcelId: owner.parcelId } : {}) } })} />}
    </ScrollView>
  );
}

function Photos({ a, onChange }: { a: AnimalRecord; onChange: (p: NonNullable<AnimalRecord['photos']>) => Promise<void> }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const photos = a.photos ?? [];
  return (
    <View style={{ marginTop: 8 }}>
      <View style={styles.chips}>
        {photos.map((p, i) => (
          <Pressable key={p.id} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${a.name}${i === 0 ? ', profile picture' : ''}`}
            onPress={() => setView(photoUri(p))}
            onLongPress={() => Alert.alert('Photo', undefined, [
              ...(i > 0 ? [{ text: 'Make profile picture', onPress: () => void onChange([p, ...photos.filter((x) => x.id !== p.id)]) }] : []),
              { text: 'Remove', style: 'destructive' as const, onPress: () => { deletePhotoFile(p); void onChange(photos.filter((x) => x.id !== p.id)); } },
              { text: 'Cancel', style: 'cancel' as const },
            ])}>
            <Image source={{ uri: p.thumb }} style={[styles.thumb, i === 0 && { borderColor: t.accent, borderWidth: 2 }]} />
          </Pressable>
        ))}
      </View>
      {photos.length < PHOTO.maxPerAnimal && (
        <Chip label={busy ? 'Saving photo…' : photos.length ? 'Add photo' : 'Add a photo'} active={false} disabled={busy} onPress={async () => {
          setBusy(true);
          try {
            const p = await pickAnimalPhoto();
            if (p) await onChange([...photos, p]);
          } catch (e) {
            Alert.alert('Photo', (e as Error).message);
          } finally {
            setBusy(false);
          }
        }} />
      )}
      {photos.length > 0 && <Text style={{ color: t.muted, fontSize: 12 }}>Hold a photo to remove it or make it the profile picture. Photos are compressed and location data is removed.</Text>}
      <Modal visible={!!view} transparent animationType="fade" onRequestClose={() => setView(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setView(null)} style={styles.viewer}>
          {view && <Image source={{ uri: view }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

function DateField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const t = useTheme();
  return <TextInput value={value} onChangeText={onChange} placeholder={`${label} (YYYY-MM-DD)`} placeholderTextColor={t.muted} accessibilityLabel={label} keyboardType="numbers-and-punctuation"
    style={[styles.input, { color: t.text, borderColor: value && !isIsoDate(value) ? t.bad : t.border }]} />;
}

function Field({ value, onChange, label, numeric }: { value: string; onChange: (v: string) => void; label: string; numeric?: boolean }) {
  const t = useTheme();
  return <TextInput value={value} onChangeText={onChange} placeholder={label} placeholderTextColor={t.muted} accessibilityLabel={label} keyboardType={numeric ? 'decimal-pad' : 'default'}
    style={[styles.input, { color: t.text, borderColor: t.border }]} />;
}

function HealthCard({ records, pet, onAdd, onRemove, onExport }: {
  records: HealthRecord[]; pet: boolean; onAdd: (r: Omit<HealthRecord, 'id'>) => Promise<void>; onRemove: (r: HealthRecord) => Promise<void>; onExport?: (fmt: 'pdf' | 'csv') => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [r, setR] = useState<{ date: string; type: HealthType; product: string; givenBy: string; lot: string; nextDue: string; notes: string }>({ date: localToday(), type: 'vaccination', product: '', givenBy: '', lot: '', nextDue: '', notes: '' });
  const today = localToday();
  const ok = isIsoDate(r.date) && (!r.nextDue || isIsoDate(r.nextDue));
  return (
    <Card title="Health and vaccinations" icon="medical-bag">
      {records.length === 0 && <Body muted>No health records yet.</Body>}
      {records.map((h) => (
        <View key={h.id} style={[styles.item, { borderColor: t.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '600' }}>{h.date} · {h.product || HEALTH_TYPES[h.type]}</Text>
            <Body muted>{[HEALTH_TYPES[h.type], h.givenBy && `by ${h.givenBy}`, h.lot && `lot ${h.lot}`, h.notes].filter(Boolean).join(' · ')}</Body>
            {h.nextDue && <Text style={{ color: h.nextDue < today ? t.bad : t.muted }}>Next due {h.nextDue}</Text>}
          </View>
          <Chip label="Remove" active={false} onPress={() => Alert.alert('Remove health record?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void onRemove(h) }])} />
        </View>
      ))}
      {open ? (
        <View>
          <DateField label="Date" value={r.date} onChange={(v) => setR({ ...r, date: v })} />
          <View style={styles.chips}>{(Object.keys(HEALTH_TYPES) as HealthType[]).map((k) => <Chip key={k} label={HEALTH_TYPES[k]} active={r.type === k} onPress={() => setR({ ...r, type: k })} />)}</View>
          <Field label="Product or vaccine (as on the label)" value={r.product} onChange={(v) => setR({ ...r, product: v })} />
          <Field label="Given by (optional)" value={r.givenBy} onChange={(v) => setR({ ...r, givenBy: v })} />
          <Field label="Lot number (optional)" value={r.lot} onChange={(v) => setR({ ...r, lot: v })} />
          <DateField label="Next due, from your vet or the label (optional)" value={r.nextDue} onChange={(v) => setR({ ...r, nextDue: v })} />
          <Field label="Notes (optional)" value={r.notes} onChange={(v) => setR({ ...r, notes: v })} />
          <Button title="Save health record" disabled={!ok} onPress={async () => {
            await onAdd({ date: r.date, type: r.type, product: r.product.trim() || undefined, givenBy: r.givenBy.trim() || undefined, lot: r.lot.trim() || undefined, nextDue: r.nextDue || undefined, notes: r.notes.trim() || undefined });
            setOpen(false);
            setR({ ...r, product: '', lot: '', nextDue: '', notes: '' });
          }} />
        </View>
      ) : <Button title="Add health record" kind="secondary" icon="plus" onPress={() => setOpen(true)} />}
      {onExport && records.length > 0 && (
        <View style={styles.chips}>
          <Chip label="Share with my vet (PDF)" active={false} onPress={() => onExport('pdf')} />
          <Chip label="CSV" active={false} onPress={() => onExport('csv')} />
        </View>
      )}
      <MoreInfo label="About health records">
        <Body muted>Plotwright keeps what you and your veterinarian decide. It doesn’t suggest vaccines, treatments, schedules or doses. For any sign of illness or injury, call your veterinarian.</Body>
        {pet && <Body muted>Rabies vaccination rules for dogs and cats vary by state and county; check your local requirements.</Body>}
        <Body muted>Reminders come a week before and on the morning of each next-due date you enter.</Body>
      </MoreInfo>
    </Card>
  );
}

function LogsCard({ logs, kinds, groupSize, onAdd, onRemove }: {
  logs: AnimalLog[]; kinds: LogKind[]; groupSize: number; onAdd: (l: Omit<AnimalLog, 'id'>) => Promise<void>; onRemove: (l: AnimalLog) => Promise<void>;
}) {
  const t = useTheme();
  const today = localToday();
  const [kind, setKind] = useState<LogKind>(kinds.find((k) => logs.some((l) => l.kind === k)) ?? kinds[0] ?? 'weight');
  const [period, setPeriod] = useState<LogPeriod>('week');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const series = logSeries(logs, kind, period, today);
  const unit = LOG_KINDS[kind].unit;
  const mine = logs.filter((l) => l.kind === kind);
  const perHen = kind === 'eggs' ? eggsPerHenPerWeek(logs, groupSize, today) : null;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const v = Number(value);
  return (
    <Card title="Production" icon="chart-bar">
      <View style={styles.chips}>{kinds.map((k) => <Chip key={k} label={LOG_KINDS[k].label} active={kind === k} onPress={() => setKind(k)} />)}</View>
      {mine.length > 0 && (
        <>
          <View style={styles.chips}>{(['week', 'month', 'season'] as LogPeriod[]).map((p) => <Chip key={p} label={p === 'week' ? 'Weeks' : p === 'month' ? 'Months' : 'Seasons'} active={period === p} onPress={() => setPeriod(p)} />)}</View>
          <Bars data={series} unit={unit} />
          <Body>
            {perHen !== null ? `${perHen} eggs per ${groupSize > 1 ? 'hen' : 'bird'} per week (last 4 weeks). ` : ''}
            {kind !== 'weight' ? `This year: ${logTotal(logs, kind, yearStart)} ${unit}.` : `Latest: ${mine[0]!.value} ${unit} on ${mine[0]!.date}.`}
            {kind === 'litter-weaned' && weanedPerLitter(logs) !== null ? ` Average ${weanedPerLitter(logs)} weaned per litter.` : ''}
          </Body>
        </>
      )}
      <View style={[styles.chips, { alignItems: 'center' }]}>
        <TextInput value={value} onChangeText={setValue} placeholder={unit} placeholderTextColor={t.muted} keyboardType="decimal-pad" accessibilityLabel={`${LOG_KINDS[kind].label} in ${unit}`}
          style={[styles.input, { color: t.text, borderColor: t.border, width: 90 }]} />
        <View style={{ flex: 1 }}><DateField label="Date" value={date} onChange={setDate} /></View>
      </View>
      <Field label="Note (optional)" value={note} onChange={setNote} />
      <Button title={`Log ${LOG_KINDS[kind].label.toLowerCase()}`} kind="secondary" disabled={!value || !Number.isFinite(v) || v < 0 || !isIsoDate(date)} onPress={async () => {
        await onAdd({ date, kind, value: v, unit, note: note.trim() || undefined });
        setValue(''); setNote('');
      }} />
      {mine.slice(0, 6).map((l) => (
        <View key={l.id} style={[styles.item, { borderColor: t.border }]}>
          <Body>{l.date}: {l.value} {l.unit}{l.note ? ` · ${l.note}` : ''}</Body>
          <Chip label="Remove" active={false} onPress={() => void onRemove(l)} />
        </View>
      ))}
    </Card>
  );
}

function Bars({ data, unit }: { data: Array<{ label: string; total: number }>; unit: string }) {
  const t = useTheme();
  const W = 320, H = 130, max = Math.max(1, ...data.map((d) => d.total)), bw = W / data.length;
  return (
    <View accessible accessibilityLabel={data.map((d) => `${d.label}: ${d.total} ${unit}`).join(', ')} style={{ marginVertical: 6 }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {data.map((d, i) => {
          const h = (d.total / max) * (H - 34);
          return (
            <G key={i}>
              <Rect x={i * bw + 4} y={H - 18 - h} width={bw - 8} height={Math.max(h, d.total ? 2 : 0)} rx={4} fill={t.accent} />
              {d.total > 0 && <SvgText x={i * bw + bw / 2} y={H - 22 - h} fontSize={10} fill={t.muted} textAnchor="middle">{d.total}</SvgText>}
              <SvgText x={i * bw + bw / 2} y={H - 4} fontSize={9} fill={t.muted} textAnchor="middle">{d.label}</SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

function BreedingCard({ records, males, names, eggs, onAdd, onOutcome, onRemove }: {
  records: BreedingRecord[]; males: AnimalRecord[]; names: Map<string, string>; eggs: boolean;
  onAdd: (r: { bredOn: string; method: BreedingMethod; sireId?: string; sireName?: string; notes?: string }) => Promise<void>;
  onOutcome: (r: BreedingRecord, born: number, alive: number) => Promise<void>; onRemove: (r: BreedingRecord) => Promise<void>;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [bredOn, setBredOn] = useState(localToday());
  const [method, setMethod] = useState<BreedingMethod>(eggs ? 'eggs-set' : 'natural');
  const [sireId, setSireId] = useState<string | undefined>();
  const [sireName, setSireName] = useState('');
  const [outcome, setOutcome] = useState<{ id: string; born: string; alive: string } | null>(null);
  return (
    <Card title={eggs ? 'Hatching' : 'Breeding'} icon="heart-outline">
      {records.length === 0 && <Body muted>{eggs ? 'Record eggs set to get a hatch window on the calendar.' : 'Record a breeding to get a due window on the calendar.'}</Body>}
      {records.map((r) => (
        <View key={r.id} style={[styles.item, { borderColor: t.border, flexDirection: 'column', alignItems: 'stretch' }]}>
          <Text style={{ color: t.text, fontWeight: '600' }}>{eggs ? 'Set' : 'Bred'} {r.bredOn}{r.sireId ? ` · ${names.get(r.sireId) ?? ''}` : r.sireName ? ` · ${r.sireName}` : ''}</Text>
          {r.dueFrom && <Body muted>{eggs ? 'Hatch' : 'Due'} {r.dueFrom === r.dueTo ? `around ${r.dueFrom}` : `${r.dueFrom} to ${r.dueTo}`}</Body>}
          {r.born !== undefined && <Body>{eggs ? 'Hatched' : 'Born'} {r.born}, alive {r.alive ?? r.born}</Body>}
          {outcome?.id === r.id ? (
            <View style={[styles.chips, { alignItems: 'center' }]}>
              <TextInput value={outcome.born} onChangeText={(v) => setOutcome({ ...outcome, born: v })} placeholder={eggs ? 'Hatched' : 'Born'} placeholderTextColor={t.muted} keyboardType="number-pad" accessibilityLabel="Number born" style={[styles.input, { color: t.text, borderColor: t.border, width: 80 }]} />
              <TextInput value={outcome.alive} onChangeText={(v) => setOutcome({ ...outcome, alive: v })} placeholder="Alive" placeholderTextColor={t.muted} keyboardType="number-pad" accessibilityLabel="Number alive" style={[styles.input, { color: t.text, borderColor: t.border, width: 80 }]} />
              <Chip label="Save" active onPress={async () => { await onOutcome(r, Number(outcome.born) || 0, Number(outcome.alive || outcome.born) || 0); setOutcome(null); }} />
            </View>
          ) : (
            <View style={styles.chips}>
              <Chip label="Record outcome" active={false} onPress={() => setOutcome({ id: r.id, born: r.born !== undefined ? String(r.born) : '', alive: r.alive !== undefined ? String(r.alive) : '' })} />
              <Chip label="Remove" active={false} onPress={() => void onRemove(r)} />
            </View>
          )}
        </View>
      ))}
      {open ? (
        <View>
          <DateField label={eggs ? 'Eggs set on' : 'Bred on'} value={bredOn} onChange={setBredOn} />
          <View style={styles.chips}>{METHODS.filter(([m]) => (eggs ? m === 'eggs-set' || m === 'other' : m !== 'eggs-set')).map(([m, l]) => <Chip key={m} label={l} active={method === m} onPress={() => setMethod(m)} />)}</View>
          {!eggs && males.length > 0 && <View style={styles.chips}><Chip label="Outside sire" active={!sireId} onPress={() => setSireId(undefined)} />{males.map((m) => <Chip key={m.id} label={m.name} active={sireId === m.id} onPress={() => setSireId(m.id)} />)}</View>}
          {!eggs && !sireId && <Field label="Sire name (optional)" value={sireName} onChange={setSireName} />}
          <Button title="Save" disabled={!isIsoDate(bredOn)} onPress={async () => { await onAdd({ bredOn, method, sireId, sireName: sireId ? undefined : sireName.trim() || undefined }); setOpen(false); }} />
          <Body muted>The {eggs ? 'hatch' : 'due'} window covers the full cited {eggs ? 'incubation' : 'gestation'} range, so it starts early on purpose.</Body>
        </View>
      ) : <Button title={eggs ? 'Record eggs set' : 'Record a breeding'} kind="secondary" icon="plus" onPress={() => setOpen(true)} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  avatar: { width: 72, height: 72, borderRadius: 18 },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, marginVertical: 5, fontSize: 15 },
});
