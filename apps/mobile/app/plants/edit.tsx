/**
 * Add or edit one of the user's own plants: the same facts the bundled library has (so fit scores,
 * calendars, bed layouts and yields work for it), plus an icon picked from the app's plant drawings.
 * A new plant can start blank or as a copy of a library plant, which is the quickest way to add a
 * variety or a crop that's close to one we already have.
 */
import {
  blankPlantSpec, plantById, searchPlants, validatePlantSpec,
  type Drainage, type FrostTolerance, type Level, type Lifecycle, type PlantKind, type PlantSpec, type Season, type SowingPlan,
} from '@plotwright/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg from 'react-native-svg';
import { Text, TextInput } from '../../src/components/Text';
import { Chip } from '../../src/components/plants';
import { Body, Button, Card, tapFeedback, useTheme } from '../../src/components/ui';
import { SearchField } from '../../src/components/kit';
import { PlantArt, drawPlant } from '../../src/components/PlantArt';
import { ART_COLORS, ART_SHAPES, SHAPE_LABEL, artFor, type ArtSpec } from '../../src/components/plantArtMap';
import { newCustomPlantId, useCustomPlants } from '../../src/services/customPlants';

const KINDS: Array<[PlantKind, string]> = [
  ['vegetable', 'Vegetable'], ['herb', 'Herb'], ['flower', 'Flower'], ['berry', 'Berry'], ['vine-fruit', 'Vine fruit'],
  ['fruit-tree', 'Fruit tree'], ['nut-tree', 'Nut tree'], ['cover-crop', 'Cover crop'], ['field-crop', 'Grain or forage'],
];
const PERENNIAL_KINDS = new Set<PlantKind>(['berry', 'vine-fruit', 'fruit-tree', 'nut-tree']);
const LEVELS: Array<[Level, string]> = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];

/** Friendly names for the fields a half-filled number can sit in. */
const FIELD_NAMES: Record<string, string> = {
  sunHours: 'Sun', soil: 'Soil pH', daysToMaturity: 'Days to harvest', germination: 'Germination', sowing: 'Planting times',
  spacingIn: 'Spacing', perSquareFoot: 'Plants per square foot', heightIn: 'Height', spreadIn: 'Spread', zones: 'Zones',
  chillHours: 'Chill hours', yieldLb: 'Yield', yearsToBearing: 'Years to first crop', harvestWindowDays: 'Harvest window',
};

/** Top-level fields holding a number that's been left half filled in (stored as NaN by the inputs). */
function incompleteFields(p: PlantSpec): string[] {
  const bad = (v: unknown): boolean =>
    typeof v === 'number' ? !Number.isFinite(v) : Array.isArray(v) ? v.some(bad) : v && typeof v === 'object' ? Object.values(v).some(bad) : false;
  return Object.entries(p).filter(([, v]) => bad(v)).map(([k]) => FIELD_NAMES[k] ?? k);
}

/** A library plant as the starting point for a new one: its facts and icon, under a new id and name. */
function copyOf(p: PlantSpec): PlantSpec {
  const c = JSON.parse(JSON.stringify(p)) as PlantSpec;
  return { ...c, id: newCustomPlantId(), commonName: '', aliases: undefined };
}

const splitList = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);

export default function EditCustomPlant() {
  const { id, from } = useLocalSearchParams<{ id?: string; from?: string }>();
  const t = useTheme();
  const existing = useCustomPlants((s) => (id ? s.list.find((c) => c.spec.id === id) : undefined));
  const fromPlant = from ? plantById(from) : undefined;

  const [template, setTemplate] = useState<PlantSpec | undefined>(fromPlant);
  const [draft, setDraft] = useState<PlantSpec>(() => existing?.spec ?? (fromPlant ? copyOf(fromPlant) : blankPlantSpec(newCustomPlantId())));
  const [art, setArt] = useState<ArtSpec>(() => existing?.art ?? { ...artFor(fromPlant?.id ?? '', fromPlant?.kind ?? 'vegetable') });
  const [artPicked, setArtPicked] = useState(!!existing || !!fromPlant);
  // Remounts the inputs (which keep their own text) when the whole draft is replaced.
  const [formKey, setFormKey] = useState(0);
  const [q, setQ] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<PlantSpec>) => setDraft((d) => ({ ...d, ...patch }));
  const setSow = (patch: Partial<SowingPlan>) => setDraft((d) => ({ ...d, sowing: { ...d.sowing, ...patch } }));
  const pickArt = (patch: Partial<ArtSpec>) => { tapFeedback(); setArtPicked(true); setArt((a) => ({ ...a, ...patch })); };

  const useTemplate = (p: PlantSpec) => {
    setTemplate(p);
    setDraft((d) => ({ ...copyOf(p), id: d.id, commonName: d.commonName }));
    if (!artPicked) setArt({ ...artFor(p.id, p.kind) });
    setQ('');
    setFormKey((k) => k + 1);
  };

  const setKind = (kind: PlantKind) => {
    // A blank plant takes on sensible defaults for its kind (a tree isn't sown like lettuce).
    if (!existing && !template) {
      setDraft((d) => ({ ...blankPlantSpec(d.id, kind), commonName: d.commonName, aliases: d.aliases, scientificName: d.scientificName }));
      setFormKey((k) => k + 1);
    } else set({ kind });
    if (!artPicked) setArt({ ...artFor('', kind) });
  };

  const save = async () => {
    const spec: PlantSpec = {
      ...draft,
      commonName: draft.commonName.trim(),
      scientificName: draft.scientificName.trim(),
      family: draft.family.trim() || 'Custom',
    };
    const half = incompleteFields(spec);
    const errs = [
      ...(half.length ? [`Fill in both numbers, or leave both blank: ${half.join(', ')}.`] : []),
      ...validatePlantSpec(spec),
      ...(spec.germination && !spec.germination.optimalF ? ['Germination: add the best soil temperature range.'] : []),
    ];
    setErrors(errs);
    if (errs.length) {
      Alert.alert('A few things to fix', errs.join('\n\n'));
      return;
    }
    setSaving(true);
    try {
      const saved = await useCustomPlants.getState().save(spec, art);
      if (existing) router.back();
      else router.replace({ pathname: '/plants/[plantId]', params: { plantId: saved.id } });
    } catch (e) {
      Alert.alert('Couldn’t save', String(e));
    } finally {
      setSaving(false);
    }
  };

  const perennialish = draft.lifecycle !== 'annual' || PERENNIAL_KINDS.has(draft.kind);
  const matches = q.trim() ? searchPlants(q).filter((p) => p.id !== draft.id).slice(0, 6) : [];

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Edit your plant' : 'Add a plant' }} />

      {!existing && (
        <Card title="Start from" icon="content-copy">
          {template ? (
            <View style={styles.templateRow}>
              <PlantArt plant={template} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>Copied from {template.commonName}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>Change anything that’s different about yours.</Text>
              </View>
            </View>
          ) : (
            <Body muted>Copy a similar library plant to fill everything in, or start blank.</Body>
          )}
          <SearchField value={q} onChangeText={setQ} placeholder="Copy a library plant" accessibilityLabel="Search the library for a plant to copy" />
          {matches.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Copy ${p.commonName}`} onPress={() => useTemplate(p)}
              style={[styles.templateRow, styles.match, { borderColor: t.border }]}>
              <PlantArt plant={p} size={40} />
              <Text style={{ color: t.text, flex: 1, fontWeight: '600' }}>{p.commonName}</Text>
              <Text style={{ color: t.accent, fontWeight: '600' }}>Copy</Text>
            </Pressable>
          ))}
        </Card>
      )}

      <View key={formKey}>
        <Card title="Name and type" icon="tag-outline">
          <TextField label="Name" value={draft.commonName} onChange={(commonName) => set({ commonName })}
            placeholder={template ? `e.g. My ${template.commonName.toLowerCase()}` : 'e.g. Purple hull pea'} autoCapitalize="words" />
          <TextField label="Other names (optional)" hint="Separate with commas. Search finds these too." value={(draft.aliases ?? []).join(', ')}
            onChange={(s) => set({ aliases: splitList(s, /,/).length ? splitList(s, /,/) : undefined })} />
          <TextField label="Latin name (optional)" value={draft.scientificName} onChange={(scientificName) => set({ scientificName })} />
          <TextField label="Family (optional)" value={draft.family === 'Custom' ? '' : draft.family} onChange={(family) => set({ family })} placeholder="e.g. Fabaceae" />
          <Choice label="Kind" value={draft.kind} options={KINDS} onChange={setKind} />
          <Choice<Lifecycle> label="Lives for" value={draft.lifecycle} options={[['annual', 'One season'], ['biennial', 'Two years'], ['perennial', 'Many years']]}
            onChange={(lifecycle) => set({ lifecycle, season: lifecycle === 'perennial' ? 'perennial' : draft.season === 'perennial' ? 'warm' : draft.season })} />
          {draft.lifecycle !== 'perennial' && (
            <Choice<Season> label="Season" value={draft.season} options={[['cool', 'Cool season'], ['warm', 'Warm season']]} onChange={(season) => set({ season })} />
          )}
        </Card>
      </View>

      <Card title="Icon" icon="palette-outline">
        <View style={{ alignItems: 'center', marginBottom: 10 }}>
          <PlantArt plant={draft} art={art} size={96} />
        </View>
        <Text style={[styles.label, { color: t.muted }]}>Shape</Text>
        <View style={styles.grid}>
          {ART_SHAPES.map((shape) => {
            const on = art.shape === shape;
            return (
              <Pressable key={shape} accessibilityRole="button" accessibilityLabel={SHAPE_LABEL[shape]} accessibilityState={{ selected: on }}
                onPress={() => pickArt({ shape })}
                style={[styles.shape, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}>
                <Svg width={38} height={38} viewBox="0 0 48 48">{drawPlant({ ...art, shape })}</Svg>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.label, { color: t.muted }]}>Colour</Text>
        <Swatches value={art.main} onPick={(main) => pickArt({ main })} />
        <Text style={[styles.label, { color: t.muted }]}>Second colour (stem, stripes or flower centre)</Text>
        <Swatches value={art.alt} onPick={(alt) => pickArt({ alt })} allowNone />
      </Card>

      <View key={`needs-${formKey}`}>
        <Card title="Growing needs" icon="sprout-outline">
          <View style={styles.pair}>
            <NumField label="Sun, minimum" unit="hours" value={draft.sunHours.min} onChange={(min) => set({ sunHours: { ...draft.sunHours, min: min ?? NaN } })} />
            <NumField label="Sun, ideal" unit="hours" value={draft.sunHours.ideal} onChange={(ideal) => set({ sunHours: { ...draft.sunHours, ideal: ideal ?? NaN } })} />
          </View>
          <Choice label="Water" value={draft.water} options={[['low', 'Light'], ['medium', 'Moderate'], ['high', 'Plenty']]} onChange={(water) => set({ water })} />
          <Choice<FrostTolerance> label="Frost" value={draft.frost}
            options={[['tender', 'Tender'], ['half-hardy', 'Light frost OK'], ['hardy', 'Hardy'], ['very-hardy', 'Very hardy']]} onChange={(frost) => set({ frost })} />
          <Choice label="Heat it likes" value={draft.heat} options={[['low', 'Prefers cool'], ['medium', 'Some heat'], ['high', 'Loves heat']]} onChange={(heat) => set({ heat })} />
          <Choice label="Disease risk in humid weather" value={draft.humidityDisease} options={LEVELS} onChange={(humidityDisease) => set({ humidityDisease })} />
          <RangeField label="Soil pH" value={draft.soil.pH} required onChange={(pH) => set({ soil: { ...draft.soil, pH: pH ?? [NaN, NaN] } })} />
          <Choice<Drainage> label="Soil" value={draft.soil.drainage}
            options={[['well-drained', 'Well drained'], ['moist', 'Moist'], ['tolerates-wet', 'Tolerates wet']]} onChange={(drainage) => set({ soil: { ...draft.soil, drainage } })} />
        </Card>

        <Card title="Planting times" icon="calendar-month">
          <Body muted>Days are counted from your property’s median last spring frost: negative is before it. Fill in at least one way to plant.</Body>
          <Choice<SowingPlan['method']> label="Usually started by" value={draft.sowing.method}
            options={[['direct', 'Sowing seed'], ['transplant', 'Transplants'], ['either', 'Either'], ['plant', 'Plants, sets or crowns']]}
            onChange={(method) => setSow({ method })} />
          <RangeField label="Sow seed outdoors" unit="days" signed hint="e.g. −14 to 14" value={draft.sowing.directSowDays} onChange={(directSowDays) => setSow({ directSowDays })} />
          <RangeField label="Start seed indoors" unit="weeks before transplanting" hint="Most weeks first, e.g. 8 to 6" value={draft.sowing.indoorStartWeeks}
            onChange={(indoorStartWeeks) => setSow({ indoorStartWeeks })} />
          <RangeField label="Set out transplants" unit="days" signed hint="e.g. 7 to 21" value={draft.sowing.transplantDays} onChange={(transplantDays) => setSow({ transplantDays })} />
          <RangeField label="Fall planting" unit="days before first fall frost" hint="Most days first, e.g. 70 to 50" value={draft.sowing.fallDaysBeforeFirstFrost}
            onChange={(fallDaysBeforeFirstFrost) => setSow({ fallDaysBeforeFirstFrost })} />
          <View style={styles.pair}>
            <NumField label="Soil at least" unit="°F" optional value={draft.sowing.minSoilF} onChange={(minSoilF) => setSow({ minSoilF })} />
            <NumField label="Sow again every" unit="days" optional value={draft.sowing.successionDays} onChange={(successionDays) => setSow({ successionDays })} />
          </View>
          <Text style={[styles.label, { color: t.muted }]}>Germination (optional)</Text>
          <NumField label="Minimum soil temperature" unit="°F" optional value={draft.germination?.minSoilF}
            onChange={(minSoilF) => set({ germination: minSoilF === undefined && !draft.germination?.optimalF ? undefined : { ...draft.germination!, minSoilF: minSoilF ?? NaN } })} />
          <RangeField label="Best soil temperature" unit="°F" value={draft.germination?.optimalF}
            onChange={(optimalF) => set({ germination: optimalF === undefined && draft.germination?.minSoilF === undefined ? undefined : { ...draft.germination!, minSoilF: draft.germination?.minSoilF ?? NaN, optimalF: optimalF! } })} />
        </Card>

        <Card title="Harvest" icon="basket-outline">
          <RangeField label="Days to harvest" unit="days" hint="Fastest and slowest varieties" value={draft.daysToMaturity} onChange={(daysToMaturity) => set({ daysToMaturity })} />
          {draft.daysToMaturity && (
            <Choice label="Counted from" value={draft.maturityFrom ?? 'seed'} options={[['seed', 'Sowing'], ['transplant', 'Transplanting'], ['planting', 'Planting']]}
              onChange={(maturityFrom) => set({ maturityFrom })} />
          )}
          <NumField label="Keeps producing for" unit="days" optional value={draft.harvestWindowDays} onChange={(harvestWindowDays) => set({ harvestWindowDays })} />
          <Choice label="Yield is per" value={draft.yieldLb?.per ?? '10ft-row'} options={[['10ft-row', '10 ft of row'], ['plant', 'Plant']]}
            onChange={(per) => set({ yieldLb: draft.yieldLb ? { ...draft.yieldLb, per } : undefined })} />
          <RangeField label="Yield" unit="lb" value={draft.yieldLb?.range}
            onChange={(range) => set({ yieldLb: range ? { per: draft.yieldLb?.per ?? (perennialish ? 'plant' : '10ft-row'), range } : undefined })} />
        </Card>

        <Card title="Size and spacing" icon="ruler">
          <View style={styles.pair}>
            <NumField label="In the row" unit="in" value={draft.spacingIn.inRow} onChange={(inRow) => set({ spacingIn: { ...draft.spacingIn, inRow: inRow ?? NaN } })} />
            <NumField label="Between rows" unit="in" value={draft.spacingIn.betweenRows} onChange={(betweenRows) => set({ spacingIn: { ...draft.spacingIn, betweenRows: betweenRows ?? NaN } })} />
          </View>
          <View style={styles.pair}>
            <NumField label="Height" unit="in" value={draft.heightIn} onChange={(heightIn) => set({ heightIn: heightIn ?? NaN })} />
            <NumField label="Spread" unit="in" value={draft.spreadIn} onChange={(spreadIn) => set({ spreadIn: spreadIn ?? NaN })} />
          </View>
          <NumField label="Plants per square foot (optional)" hint="For small crops in a square-foot bed. Left blank, spacing decides." optional
            value={draft.perSquareFoot} onChange={(perSquareFoot) => set({ perSquareFoot })} />
        </Card>

        {perennialish && (
          <Card title="Trees, vines and perennials" icon="tree-outline">
            <RangeField label="Hardiness zones" hint="Coldest first, e.g. 5 to 8" value={draft.zones} onChange={(zones) => set({ zones })} />
            <RangeField label="Years to first crop" unit="years" value={draft.yearsToBearing} onChange={(yearsToBearing) => set({ yearsToBearing })} />
            <RangeField label="Winter chill needed" unit="hours" hint="Fruit trees: hours at 32–45 °F" value={draft.chillHours} onChange={(chillHours) => set({ chillHours })} />
            <Choice label="Pollination" value={draft.pollination ?? 'unknown'}
              options={[['unknown', 'Not sure'], ['self', 'Self-fruitful'], ['partly-self', 'Better with a partner'], ['needs-partner', 'Needs a partner'], ['wind', 'Wind']]}
              onChange={(v) => set({ pollination: v === 'unknown' ? undefined : v })} />
          </Card>
        )}

        <Card title="Problems and notes" icon="note-text-outline">
          <TextField label="Diseases (optional)" hint="Separate with commas" value={draft.diseases.join(', ')} onChange={(s) => set({ diseases: splitList(s, /,/) })} />
          <TextField label="Pests (optional)" hint="Separate with commas" value={draft.pests.join(', ')} onChange={(s) => set({ pests: splitList(s, /,/) })} />
          <TextField label="Notes (optional)" hint="One note per line" multiline value={(draft.notes ?? []).join('\n')}
            onChange={(s) => set({ notes: splitList(s, /\n/).length ? splitList(s, /\n/) : undefined })} />
        </Card>
      </View>

      {errors.length > 0 && (
        <View style={[styles.errors, { borderColor: t.bad }]} accessibilityLiveRegion="polite">
          {errors.map((e) => <Text key={e} style={{ color: t.bad }}>• {e}</Text>)}
        </View>
      )}
      <Button title={saving ? 'Saving…' : existing ? 'Save changes' : 'Add to my library'} icon="check" onPress={save} disabled={saving} />
    </ScrollView>
  );
}

function Label({ text, hint }: { text: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={[styles.label, { color: t.text, marginTop: 0 }]}>{text}</Text>
      {hint ? <Text style={{ color: t.muted, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  );
}

function TextField({ label, hint, value, onChange, placeholder, multiline, autoCapitalize = 'sentences' }: {
  label: string; hint?: string; value: string; onChange: (s: string) => void; placeholder?: string; multiline?: boolean; autoCapitalize?: 'words' | 'sentences';
}) {
  const t = useTheme();
  const [text, setText] = useState(value);
  return (
    <View style={styles.field}>
      <Label text={label} hint={hint} />
      <TextInput
        value={text} onChangeText={(s) => { setText(s); onChange(s); }} placeholder={placeholder} placeholderTextColor={t.muted}
        accessibilityLabel={label} multiline={multiline} autoCapitalize={autoCapitalize}
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }, multiline && { minHeight: 88, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

const fmt = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '' : String(n));
const parse = (s: string): number | undefined => {
  const v = s.trim().replace(',', '.').replace('−', '-');
  return v === '' ? undefined : Number(v);
};

/** A number. Blank reports undefined when `optional`, otherwise NaN so saving asks for it. */
function NumField({ label, unit, hint, value, onChange, optional, signed }: {
  label: string; unit?: string; hint?: string; value: number | undefined; onChange: (n: number | undefined) => void; optional?: boolean; signed?: boolean;
}) {
  const t = useTheme();
  const [text, setText] = useState(fmt(value));
  return (
    <View style={[styles.field, { flex: 1 }]}>
      <Label text={label} hint={hint} />
      <View style={styles.numRow}>
        <TextInput
          value={text} accessibilityLabel={unit ? `${label}, ${unit}` : label}
          keyboardType={signed ? 'numbers-and-punctuation' : 'decimal-pad'}
          onChangeText={(s) => { setText(s); const n = parse(s); onChange(n === undefined && !optional ? NaN : n); }}
          style={[styles.input, styles.num, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
        />
        {unit ? <Text style={{ color: t.muted, flexShrink: 1 }}>{unit}</Text> : null}
      </View>
    </View>
  );
}

/** A [from, to] range: both blank → undefined; one blank → NaN in its place so saving flags it. */
function RangeField({ label, unit, hint, value, onChange, signed, required }: {
  label: string; unit?: string; hint?: string; value: [number, number] | undefined; onChange: (r: [number, number] | undefined) => void; signed?: boolean; required?: boolean;
}) {
  const t = useTheme();
  const [a, setA] = useState(fmt(value?.[0]));
  const [b, setB] = useState(fmt(value?.[1]));
  const emit = (x: string, y: string) => {
    const lo = parse(x), hi = parse(y);
    onChange(lo === undefined && hi === undefined && !required ? undefined : [lo ?? NaN, hi ?? NaN]);
  };
  const box = [styles.input, styles.num, { color: t.text, borderColor: t.border, backgroundColor: t.card }];
  const kb = signed ? 'numbers-and-punctuation' : 'decimal-pad';
  return (
    <View style={styles.field}>
      <Label text={label} hint={hint} />
      <View style={styles.numRow}>
        <TextInput value={a} keyboardType={kb} accessibilityLabel={`${label}, from`} style={box} onChangeText={(s) => { setA(s); emit(s, b); }} />
        <Text style={{ color: t.muted }}>to</Text>
        <TextInput value={b} keyboardType={kb} accessibilityLabel={`${label}, to`} style={box} onChangeText={(s) => { setB(s); emit(a, s); }} />
        {unit ? <Text style={{ color: t.muted, flexShrink: 1 }}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <View style={styles.field}>
      <Label text={label} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {options.map(([k, text]) => <Chip key={k} label={text} active={value === k} onPress={() => onChange(k)} />)}
      </View>
    </View>
  );
}

function Swatches({ value, onPick, allowNone }: { value: string | undefined; onPick: (c: string | undefined) => void; allowNone?: boolean }) {
  const t = useTheme();
  const items: Array<string | undefined> = allowNone ? [undefined, ...ART_COLORS] : ART_COLORS;
  return (
    <View style={styles.grid}>
      {items.map((c) => {
        const on = value === c;
        return (
          <Pressable key={c ?? 'none'} accessibilityRole="button" accessibilityLabel={c ? `Colour ${c}` : 'Shape’s own colour'} accessibilityState={{ selected: on }}
            onPress={() => onPick(c)}
            style={[styles.swatch, { borderColor: on ? t.text : t.border, backgroundColor: c ?? t.surface }]}>
            {!c ? <Text style={{ color: t.muted, fontSize: 11 }}>Auto</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  match: { borderWidth: 1, borderRadius: 14, padding: 8, marginTop: 6, marginBottom: 0 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 10, marginBottom: 6 },
  field: { marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
  num: { minWidth: 72, textAlign: 'center' },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pair: { flexDirection: 'row', gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shape: { width: 52, height: 52, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  errors: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6, marginBottom: 12 },
});
