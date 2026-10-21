/**
 * Housing planner (prompt §5, phase 4), the counterpart of the bed planner: which animals can live in
 * this coop, run, shelter, paddock, barn or hive, how many fit at the protective (larger) space
 * figure, who shouldn't share, and the herds living here. Space checks are welfare checks, so they're
 * free and always shown.
 */
import {
  animalsForHousing, countOf, footprintAreaM2, formatArea, frameForBoundary, housingOccupancy, minimumGroup, objectType, scoreAnimal,
  type AnimalSpec, type HousingOccupancy,
} from '@plotwright/core';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { Text } from '../../src/components/Text';
import { AnimalArt } from '../../src/components/AnimalArt';
import { Chip, VerdictBadge } from '../../src/components/plants';
import { EmptyState, MoreInfo } from '../../src/components/kit';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { deleteHerd, herdsForObject, saveHerd, type Herd } from '../../src/db/herds';
import { listSensors, type SensorRecord } from '../../src/db/sensors';
import { herdCount, herdLabel, housingName, isCurrent, siteForAnimals } from '../../src/services/animals';
import { HerdNameField } from '../../src/components/HerdName';
import { useGarden } from '../../src/services/useGarden';
import { useSettings } from '../../src/services/settings';

/** One colour per herd sharing the housing; distinct in both themes. */
const HERD_COLORS = ['#7fb85a', '#d9a441', '#5aa1c8', '#c27ab8', '#c8735a'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function HousingPlanner() {
  const { id, objectId } = useLocalSearchParams<{ id: string; objectId: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const animalsOn = useSettings((s) => s.animals) === 'yes';
  const setAnimals = useSettings((s) => s.setAnimals);
  const { state, error } = useGarden(id);
  const [herds, setHerds] = useState<Herd[] | null>(null);
  const [sensors, setSensors] = useState<SensorRecord[]>([]);
  const [picked, setPicked] = useState<AnimalSpec | null>(null);

  const o = state?.design.objects.find((x) => x.id === objectId);
  const frame = useMemo(() => (state ? frameForBoundary(state.parcel.geometry) : null), [state]);

  const load = useCallback(async () => {
    if (!state) return;
    setHerds(await herdsForObject(state.design.id, objectId));
    setSensors((await listSensors(state.parcel.id)).filter((s) => s.bedObjectId === objectId));
  }, [state, objectId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const current = useMemo(() => (herds ?? []).filter(isCurrent), [herds]);
  const occ: HousingOccupancy | null = useMemo(() => {
    if (!o || !frame) return null;
    return housingOccupancy(current.flatMap((h) => {
      const a = animalsForHousing(o.kind).find((x) => x.id === h.speciesId);
      return a ? [{ herdId: h.id, animal: a, count: h.count }] : [];
    }), o, frame);
  }, [current, o, frame]);

  const ranked = useMemo(() => {
    if (!state || !o) return [];
    const site = siteForAnimals(state);
    return animalsForHousing(o.kind).map((a) => ({ a, s: scoreAnimal(a, site) })).sort((x, y) => y.s.score - x.s.score);
  }, [state, o]);

  if (!animalsOn)
    return (
      <View style={{ padding: 16 }}>
        <EmptyState icon="paw" title="Animal features are off" text="Turn them on to plan which animals live here and how many fit." action="Show animal features" onAction={() => setAnimals('yes')} />
      </View>
    );
  if (error) return <Body>{error}</Body>;
  if (!state || !frame || herds === null) return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading housing" />;
  if (!o) return <Body>This housing is no longer in the design.</Body>;

  const name = housingName(o);
  const areaM2 = footprintAreaM2(o, frame);
  const colorOf = (herdId: string) => HERD_COLORS[current.findIndex((h) => h.id === herdId) % HERD_COLORS.length]!;

  const remove = (h: Herd) =>
    Alert.alert('Remove herd?', `Remove ${herdLabel(h)} from ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteHerd(h.id); await load(); } },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }} accessibilityRole="header">{name}</Text>
      <Body muted>{formatArea(areaM2, units)}{o.label ? ` · ${objectType(o.kind)?.name ?? o.kind}` : ''}</Body>

      <Card title="How full it is" icon="home-group">
        {occ && occ.shares.length > 0 ? (
          <>
            <CapacityDiagram occ={occ} widthM={o.width} lengthM={o.length} colorOf={colorOf} />
            {occ.shares.map((s) => (
              <View key={s.herdId} style={styles.legendRow}>
                <View style={[styles.swatch, { backgroundColor: colorOf(s.herdId) }]} />
                <Body>
                  {countOf(s.animal, s.count)}
                  {s.capacity.limitingFactor === 'hives' ? ' · one colony per hive' : s.capacity.fits !== null ? ` · room for ${s.capacity.fits} alone` : ' · no sourced space figure'}
                </Body>
              </View>
            ))}
            {occ.used !== null && (
              <Text style={{ color: occ.over ? t.bad : t.text, fontWeight: '600', marginTop: 4 }}>
                {occ.over ? `Over capacity: ${Math.round(occ.used * 100)}% of the space. Fewer animals or more room keeps them healthier.` : `${Math.round(occ.used * 100)}% of the space in use.`}
              </Text>
            )}
            {occ.conflicts.map((c) => <Text key={c} style={{ color: t.warn, marginTop: 4 }}>Shouldn’t share: {c}</Text>)}
            <MoreInfo>
              {occ.shares.map((s) => <Body key={s.herdId} muted>{s.animal.commonName}: {s.capacity.basis}</Body>)}
              <Body muted>When herds share, each uses its count divided by how many of its kind would fit alone.</Body>
            </MoreInfo>
          </>
        ) : <Body muted>No animals here yet. Pick one below to see how many fit.</Body>}
      </Card>

      {current.length > 0 && (
        <Card title="Living here" icon="paw-outline">
          {current.map((h) => {
            const a = ranked.find((r) => r.a.id === h.speciesId)?.a;
            const group = a ? minimumGroup(a) : 1;
            return (
              <View key={h.id} style={[styles.herd, { borderColor: t.border }]}>
                <View style={styles.herdHead}>
                  <AnimalArt animalId={h.speciesId} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontWeight: '600', fontSize: 16 }}>{herdLabel(h, a)}</Text>
                    {h.name && <Body muted>{herdCount(h, a)}</Body>}
                    <Body muted>{h.status === 'active' ? `On the land${h.arrivedOn ? ` since ${h.arrivedOn}` : ''}` : 'Planned'}</Body>
                  </View>
                </View>
                <HerdNameField herd={h} onSave={async (name) => { await saveHerd({ ...h, name }); await load(); }} />
                {a && h.count < group && <Text style={{ color: t.warn }}>{a.commonName} do best in groups of {group} or more.</Text>}
                <View style={styles.row}>
                  <Chip label="−" active={false} disabled={h.count <= 1} onPress={async () => { await saveHerd({ ...h, count: h.count - 1 }); await load(); }} />
                  <Chip label="+" active={false} onPress={async () => { await saveHerd({ ...h, count: h.count + 1 }); await load(); }} />
                  {h.status === 'planned' && <Chip label="They’ve arrived" active={false} onPress={async () => { await saveHerd({ ...h, status: 'active', arrivedOn: h.arrivedOn ?? new Date().toISOString().slice(0, 10) }); await load(); }} />}
                  <Chip label="Care & details" active={false} onPress={() => router.push({ pathname: '/animals/[animalId]', params: { animalId: h.speciesId, parcelId: state.parcel.id } })} />
                  <Chip label="Remove" active={false} onPress={() => remove(h)} />
                </View>
              </View>
            );
          })}
          <Body muted>Weather alerts cover herds marked as on the land. Turn on alerts in More.</Body>
          <Button title="Records: health, eggs, breeding" kind="secondary" icon="clipboard-text-outline" onPress={() => router.push('/records')} />
        </Card>
      )}

      <Card title={`Who can live in ${name.toLowerCase().startsWith('the ') ? name : `the ${name.toLowerCase()}`}`} icon="star-outline">
        {ranked.length === 0 && <Body muted>No animals in the library live in this kind of object.</Body>}
        {ranked.map(({ a, s }) => {
          const open = picked?.id === a.id;
          return (
            <View key={a.id} style={[styles.rank, { borderColor: t.border }]}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setPicked(open ? null : a)} style={styles.herdHead}>
                <AnimalArt animalId={a.id} size={40} />
                <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', flex: 1 }}>{a.commonName} {open ? '▾' : '▸'}</Text>
                <VerdictBadge s={s} />
              </Pressable>
              {open && <AddHerd a={a} summary={s.summary} onAdd={async (count, status, arrivedOn) => {
                await saveHerd({ parcelId: state.parcel.id, designId: state.design.id, objectId: o.id, speciesId: a.id, count, status, arrivedOn });
                setPicked(null);
                await load();
              }} areaOk={(count) => housingOccupancy([...(occ?.shares ?? []), { herdId: 'new', animal: a, count }], o, frame)} />}
            </View>
          );
        })}
      </Card>

      <Card title="Sensors here" icon="thermometer">
        {sensors.length ? sensors.map((s) => (
          <Text key={s.id} accessibilityRole="link" onPress={() => router.push({ pathname: '/sensors/[id]', params: { id: s.id } })} style={{ color: t.accent, paddingVertical: 4 }}>{s.name} ›</Text>
        )) : <Body muted>A thermometer in here gives heat and freezing alerts from the real conditions inside. In Sensors, open one and choose this housing under “In a bed or animal housing?”.</Body>}
      </Card>
    </ScrollView>
  );
}

function AddHerd({ a, summary, onAdd, areaOk }: {
  a: AnimalSpec; summary: string;
  onAdd: (count: number, status: 'planned' | 'active', arrivedOn?: string) => Promise<void>; areaOk: (count: number) => HousingOccupancy | null;
}) {
  const t = useTheme();
  const group = minimumGroup(a);
  const [count, setCount] = useState(group);
  const [status, setStatus] = useState<'planned' | 'active'>('planned');
  const [date, setDate] = useState('');
  const next = areaOk(count);
  const dateOk = !date || ISO_DATE.test(date);
  return (
    <View style={{ marginTop: 6 }}>
      <Body>{summary}</Body>
      <View style={[styles.row, { alignItems: 'center' }]}>
        <Chip label="−" active={false} disabled={count <= 1} onPress={() => setCount((c) => Math.max(1, c - 1))} />
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', minWidth: 36, textAlign: 'center' }} accessibilityLabel={countOf(a, count)}>{count}</Text>
        <Chip label="+" active={false} onPress={() => setCount((c) => c + 1)} />
      </View>
      {next?.used != null && <Text style={{ color: next.over ? t.bad : t.muted }}>{next.over ? `That’s over capacity (${Math.round(next.used * 100)}% of the space).` : `Uses ${Math.round(next.used * 100)}% of the space with what’s already here.`}</Text>}
      {next?.conflicts.map((c) => <Text key={c} style={{ color: t.warn }}>Shouldn’t share: {c}</Text>)}
      {count < group && <Text style={{ color: t.warn }}>{a.commonName} do best in groups of {group} or more.</Text>}
      <View style={styles.row}>
        <Chip label="Planning" active={status === 'planned'} onPress={() => setStatus('planned')} />
        <Chip label="Already here" active={status === 'active'} onPress={() => setStatus('active')} />
      </View>
      <TextInput value={date} onChangeText={setDate} placeholder={status === 'active' ? 'Arrived or hatched (YYYY-MM-DD, optional)' : 'Expected arrival (YYYY-MM-DD, optional)'}
        placeholderTextColor={t.muted} keyboardType="numbers-and-punctuation" accessibilityLabel="Arrival or hatch date, optional"
        style={[styles.input, { color: t.text, borderColor: dateOk ? t.border : t.bad }]} />
      <Button title={`Add ${countOf(a, count)}`} disabled={!dateOk} onPress={() => void onAdd(count, status, date || undefined)} />
    </View>
  );
}

/**
 * The housing drawn to scale. One herd with a countable capacity shows a place per animal (filled =
 * planned, outlined = room, red = over); shared housing fills left to right by each herd's share.
 */
function CapacityDiagram({ occ, widthM, lengthM, colorOf }: { occ: HousingOccupancy; widthM: number; lengthM: number; colorOf: (id: string) => string }) {
  const t = useTheme();
  const long = Math.max(widthM, lengthM), short = Math.min(widthM, lengthM);
  const W = 300, H = Math.max(60, Math.min(120, (W * short) / Math.max(long, 0.01)));
  const label = occ.used === null ? 'No sourced space figure for these animals here' : `${Math.round(occ.used * 100)} percent of the space in use${occ.over ? ', over capacity' : ''}`;
  const sized = occ.shares.filter((s) => s.capacity.fits !== null);
  const one = sized.length === 1 && occ.shares.length === 1 && sized[0]!.capacity.fits! >= 1 && Math.max(sized[0]!.capacity.fits!, sized[0]!.count) <= 60 ? sized[0]! : null;

  let marks: ReactElement[];
  if (one) {
    const fits = one.capacity.fits!, slots = Math.max(fits, one.count);
    const cols = Math.max(1, Math.min(slots, Math.ceil(Math.sqrt((slots * (W - 16)) / (H - 16)))));
    const rows = Math.ceil(slots / cols);
    const cell = Math.min((W - 16) / cols, (H - 16) / rows), r = Math.max(3, cell * 0.36);
    const x0 = (W - cols * cell) / 2, y0 = (H - rows * cell) / 2;
    marks = Array.from({ length: slots }, (_, i) => {
      const cx = x0 + (i % cols) * cell + cell / 2, cy = y0 + Math.floor(i / cols) * cell + cell / 2;
      const filled = i < one.count, over = i >= fits;
      return <Circle key={i} cx={cx} cy={cy} r={r} fill={filled ? (over ? t.bad : colorOf(one.herdId)) : 'none'} stroke={filled ? 'none' : t.muted} strokeWidth={1.5} strokeDasharray={filled ? undefined : '3 3'} />;
    });
  } else {
    let x = 0;
    marks = sized.map((s) => {
      const w = Math.min(W - x, (s.capacity.fits! > 0 ? s.count / s.capacity.fits! : 1) * W);
      const el = <Rect key={s.herdId} x={x + 2} y={3} width={Math.max(0, w - 4)} height={H - 6} rx={6} fill={colorOf(s.herdId)} opacity={0.85} />;
      x += w;
      return el;
    });
  }
  return (
    <View accessible accessibilityLabel={label} style={{ alignItems: 'center', marginVertical: 8 }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={1} y={1} width={W - 2} height={H - 2} rx={8} fill={t.surface} stroke={occ.over ? t.bad : t.border} strokeWidth={occ.over ? 3 : 1.5} />
        {marks}
      </Svg>
      {one && (
        <Text style={{ color: t.muted, fontSize: 12 }}>
          One circle per animal’s space{one.count < one.capacity.fits! ? ': dashed circles are room to spare' : ''}{one.count > one.capacity.fits! ? ': red circles are over the space' : ''}.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  herd: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  herdHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { borderTopWidth: 1, paddingVertical: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  swatch: { width: 14, height: 14, borderRadius: 3 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, marginVertical: 6, fontSize: 15 },
});
