/**
 * Animal detail (prompt §5), the counterpart of plant detail: needs at a glance, fit for the
 * property, a care calendar from its frost dates, housing and fencing, breeds by climate, health
 * awareness (never treatment), the rules to check, and where the figures come from.
 */
import {
  SAFETY_NOTES, animalById, isCustomAnimalId, animalCalendar, fallbackHeatOnset, formatAcres, formatDoy, formatGallons, formatPounds, formatRangeIn, formatSqFt, formatTempF, minimumGroup, objectType, scoreAnimal, spacePerHeadSqFt, waterGallons, type SafetyNote,
} from '@plotwright/core';
import { livestockGuide } from '@plotwright/data';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { Text } from '../../src/components/Text';
import { AnimalArt } from '../../src/components/AnimalArt';
import { ExternalLink, FactorList, VerdictBadge } from '../../src/components/plants';
import { FactGrid, Pill } from '../../src/components/kit';
import { SafetyNoteRow } from '../../src/components/SafetyNote';
import { ShopRow } from '../../src/components/ShopRow';
import { BrowseBanner } from '../../src/ads/useAds';
import { FindAVet } from '../../src/components/FindAVet';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { useGarden } from '../../src/services/useGarden';
import { useSettings } from '../../src/services/settings';
import { housingName, siteForAnimals } from '../../src/services/animals';
import { useCustomAnimals } from '../../src/services/customAnimals';

const range = (r: [number, number] | null | undefined, unit = '') => (r ? (r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}–${r[1]}${unit}`) : null);
const SOURCE_TAG: Record<string, string> = { extension: 'Extension', government: 'Government', research: 'Research', industry: 'Industry', secondary: 'Secondary' };

export default function AnimalDetail() {
  const { animalId, parcelId } = useLocalSearchParams<{ animalId: string; parcelId?: string }>();
  const t = useTheme();
  const showProcessing = useSettings((s) => s.showProcessing);
  const units = useSettings((s) => s.units);
  const { state } = useGarden(parcelId);
  useCustomAnimals((s) => s.version); // re-render after an edit
  const a = animalById(animalId);

  const fit = useMemo(() => (a && state ? scoreAnimal(a, siteForAnimals(state)) : null), [a, state]);
  const cal = useMemo(() => (a && state?.site.frost ? animalCalendar(a, {}, { frost: state.site.frost, showProcessing, peakSummerMaxF: state.site.peakSummerMaxF }) : null), [a, state, showProcessing]);

  if (!a) return <View style={{ padding: 16 }}><Body>This animal isn’t in the library (it may have been deleted).</Body></View>;
  const guide = livestockGuide(a.id);
  const indoor = spacePerHeadSqFt(a, 'indoor');
  const outdoor = spacePerHeadSqFt(a, 'outdoor');
  const water = waterGallons(a);
  const group = minimumGroup(a);
  const poultryNote = a.kind === 'poultry' || a.kind === 'waterfowl' ? (SAFETY_NOTES.poultry as SafetyNote) : null;
  const beeNote = a.kind === 'pollinator' ? (SAFETY_NOTES.bees as SafetyNote) : null;
  const p = a.production;
  const lb = (r: [number, number] | null | undefined) => (r ? formatRangeIn(r, (n) => formatPounds(n, units)) : null);
  const produce = [
    range(p.eggsPerYear) && `${range(p.eggsPerYear)} eggs a year`,
    lb(p.milkLbPerLactation) && `${lb(p.milkLbPerLactation)} of milk per lactation`,
    lb(p.fiberLbPerYear) && `${lb(p.fiberLbPerYear)} of fiber a year`,
    lb(p.honeyLbPerYear) && `${lb(p.honeyLbPerYear)} of honey a year`,
    range(p.growOutDays) && `${range(p.growOutDays)} days to grow out`,
    range(p.layStartWeeks) && `starts laying at ${range(p.layStartWeeks)} weeks`,
  ].filter(Boolean) as string[];
  const r = a.reproduction;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <AnimalArt animalId={a.id} size={84} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 26, fontWeight: '700' }} accessibilityRole="header">{a.commonName}</Text>
          <Text style={{ color: t.muted, fontStyle: 'italic' }}>{a.scientificName}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {a.purposes.filter((x) => showProcessing || x !== 'meat').map((x) => <Pill key={x} text={x.replace('-', ' ')} />)}
            {!showProcessing && a.purposes.includes('meat') && <Pill text="raised for meat" />}
            {isCustomAnimalId(a.id) && <Pill icon="pencil" text="your own figures" tone="accent" />}
          </View>
        </View>
      </View>

      {isCustomAnimalId(a.id) && <Button title="Edit your animal" kind="secondary" icon="pencil" onPress={() => router.push({ pathname: '/animals/edit', params: { id: a.id } })} />}
      {poultryNote && <SafetyNoteRow note={poultryNote} />}
      {beeNote && <SafetyNoteRow note={beeNote} />}

      <Card title="Needs" icon="paw-outline">
        <FactGrid items={[
          { icon: 'home-outline', label: 'Shelter', value: indoor ? `${formatSqFt(indoor, units)} each` : '—' },
          { icon: 'fence', label: a.pastureAcresPerHead ? 'Pasture' : 'Outdoors', value: a.pastureAcresPerHead ? `${formatAcres(Math.max(...a.pastureAcresPerHead), units)} each` : outdoor ? `${formatSqFt(outdoor, units)} each` : '—' },
          { icon: 'water-outline', label: 'Water', value: water ? `up to ${formatGallons(water, units)}/day` : 'always fresh' },
          { icon: 'account-group-outline', label: 'Group', value: group > 1 ? `${group} or more` : 'fine alone' },
          { icon: 'thermometer-high', label: 'Heat stress', value: a.heat.airOnsetF ? `from ${formatTempF(a.heat.airOnsetF, units)}` : a.heat.thiOnset ? `THI ${a.heat.thiOnset}` : a.heat.tPlusRhOnset ? `°F + humidity ${a.heat.tPlusRhOnset}` : fallbackHeatOnset(a) !== undefined ? `°F + humidity ${fallbackHeatOnset(a)} (general)` : a.heat.tolerance ?? '—' },
          { icon: 'snowflake', label: 'Cold', value: a.cold.tolerance ? `${a.cold.tolerance} tolerance` : '—' },
          { icon: 'volume-high', label: 'Noise', value: a.noise ?? '—' },
          { icon: 'heart-pulse', label: 'Lifespan', value: range(a.lifespanYears, ' yrs') ?? '—' },
        ]} />
        <View style={{ marginTop: 10, gap: 2 }}>
          {a.socialNote && <Body muted>{a.socialNote}</Body>}
          {a.heat.note && <Body muted>Heat: {a.heat.note}</Body>}
          {a.cold.note && <Body muted>Cold: {a.cold.note}</Body>}
          {a.waterNote && <Body muted>Water: {a.waterNote}</Body>}
          <Body muted>Space and water are the larger cited figures, so they lean toward the animal’s comfort.</Body>
        </View>
      </Card>

      {fit && state && (
        <Card title={`Fit for ${state.parcel.name}`} icon="map-marker-check-outline" right={<VerdictBadge s={fit} />}>
          <Body>{fit.summary}</Body>
          <View style={{ marginTop: 8 }}><FactorList factors={fit.factors} /></View>
          {fit.flags.map((f) => <Body key={f} muted>• {f}</Body>)}
        </Card>
      )}

      {cal && cal.length > 0 && state && (
        <Card title={`Care calendar · ${state.parcel.name}`} icon="calendar-month">
          {cal.map((e, i) => (
            <View key={i} style={{ marginBottom: 8 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{e.start === e.end ? formatDoy(e.start) : `${formatDoy(e.start)} – ${formatDoy(e.end)}`} · {e.label}</Text>
              <Body muted>{e.basis}</Body>
            </View>
          ))}
        </Card>
      )}

      <Card title="Housing & fencing" icon="shield-home-outline">
        <Body>Lives in: {a.housingObjects.map((k) => objectType(k)?.name ?? k).join(', ')}</Body>
        {a.fence && <Body muted>{a.fence}</Body>}
        {a.nestBoxesPer ? <Body muted>One nest box per {a.nestBoxesPer} birds.</Body> : null}
        {a.manureNote && <Body muted>{a.manureNote}</Body>}
      </Card>

      {(produce.length > 0 || r.gestationDays || r.incubationDays || (showProcessing && a.processing)) && (
        <Card title="Production & breeding" icon="egg-outline">
          {produce.map((x) => <Body key={x}>• {x}</Body>)}
          {p.note && <Body muted>{p.note}</Body>}
          {r.gestationDays && <Body>• Gestation {range(r.gestationDays)} days</Body>}
          {r.incubationDays && <Body>• Incubation {range(r.incubationDays)} days</Body>}
          {r.breedingSeason && <Body muted>{r.breedingSeason}</Body>}
          {r.knownMatingRisks?.map((m) => <Body key={m} muted>{m}</Body>)}
          {showProcessing && a.processing && (
            <View style={{ marginTop: 6 }}>
              {range(a.processing.ageDays) && <Body>• Processing age: {range(a.processing.ageDays)} days</Body>}
              {lb(a.processing.dressedWeightLb) && <Body>• Dressed weight: {lb(a.processing.dressedWeightLb)}</Body>}
              {a.processing.note && <Body muted>{a.processing.note}</Body>}
            </View>
          )}
        </Card>
      )}

      {a.breeds.length > 0 && (
        <Card title="Breeds" icon="star-outline">
          {a.breeds.map((b) => <Body key={b.name}>• {b.name}{b.climate ? ` (${b.climate === 'both' ? 'heat and cold' : b.climate === 'heat' ? 'handles heat' : 'cold-hardy'})` : ''}{b.note ? `: ${b.note}` : ''}</Body>)}
        </Card>
      )}

      <Card title="Health to know about" icon="heart-pulse">
        <Body>{a.diseasesToKnow.join(', ')}.</Body>
        {a.biosecurity && <Body muted>{a.biosecurity}</Body>}
        <Body muted>For any sign of illness or injury, call your veterinarian. Plotwright doesn’t diagnose or suggest treatments.</Body>
        <FindAVet pet={false} />
      </Card>

      <Card title="Rules to check" icon="gavel">
        {a.regulatory.map((x) => <Body key={x}>• {x}</Body>)}
        {a.keepApart.map((k) => <Body key={k.id}>• Keep apart from {animalById(k.id)?.commonName.toLowerCase() ?? k.id}: {k.reason}</Body>)}
      </Card>

      {a.notes.length > 0 && <Card title="Notes" icon="note-text-outline">{a.notes.map((n) => <Body key={n}>• {n}</Body>)}</Card>}

      {!isCustomAnimalId(a.id) && <ShopRow placement="animal-detail" topic={`${a.commonName.replace(/(.*?)/g, '').trim()} supplies`} />}
      <Card title="Learn more" icon="school-outline">
        {guide && <ExternalLink link={guide} />}
        {a.sources.map((s) => (
          <Text key={s.url + s.title} accessibilityRole="link" onPress={() => Linking.openURL(s.url)} style={{ color: t.muted, fontSize: 13, paddingVertical: 4 }}>
            {SOURCE_TAG[s.kind]} · {s.title}{s.year ? ` (${s.year})` : ''}
          </Text>
        ))}
        {a.oldData && <Body muted>Some figures are from before 2016; local extension advice wins.</Body>}
      </Card>

      {parcelId && state && (() => {
        // Straight to the housing planner when the design already has somewhere they can live.
        const homes = state.design.objects.filter((o) => a.housingObjects.includes(o.kind));
        const roam = <Button key="roam" title="Place on my land without housing" kind="secondary" icon="paw" onPress={() => router.push({ pathname: '/design/[id]', params: { id: parcelId, placeAnimal: a.id } })} />;
        return homes.length ? (
          <>{homes.slice(0, 3).map((o) => <Button key={o.id} title={`Plan in ${housingName(o)}`} icon="map-plus" onPress={() => router.push({ pathname: '/housing/[id]', params: { id: parcelId, objectId: o.id } })} />)}{roam}</>
        ) : (
          <>
            <Body muted>Add a {a.housingObjects.map((k) => objectType(k)?.name.toLowerCase() ?? k).join(' or ')} in Design, then tap it and choose “Plan animals here”.</Body>
            <Button title="Open Design" icon="map-plus" onPress={() => router.push({ pathname: '/design/[id]', params: { id: parcelId } })} />
            {roam}
          </>
        );
      })()}
      <BrowseBanner screen="animal-guide" animalKind={a.kind} />
    </ScrollView>
  );
}
