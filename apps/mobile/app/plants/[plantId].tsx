/**
 * Plant detail (§7): growing facts, a planting calendar personalised to the property's frost dates and
 * soil warming, climate fit with reasons, and links to land-grant extension guides for how-to detail.
 */
import { plantById, scorePlant } from '@plotwright/core';
import { cropGuide, stateExtensionHub } from '@plotwright/data';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useEntitlements } from '../../src/billing/entitlements';
import { CalendarList, Chip, ExternalLink, FactorList, StaleProfileNotice, VerdictBadge } from '../../src/components/plants';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { calendarFor } from '../../src/services/garden';
import { useGarden } from '../../src/services/useGarden';
import { useSettings } from '../../src/services/settings';

const inToUnits = (inches: number, imperial: boolean) => (imperial ? `${inches} in` : `${Math.round(inches * 2.54)} cm`);

export default function PlantDetail() {
  const { plantId, parcelId } = useLocalSearchParams<{ plantId: string; parcelId?: string }>();
  const t = useTheme();
  const imperial = useSettings((s) => s.units) === 'imperial';
  const ent = useEntitlements((s) => s.entitlements);
  const { state } = useGarden(parcelId);
  const [risk, setRisk] = useState<'cautious' | 'typical'>('cautious');
  const plant = plantById(plantId);

  const cal = useMemo(() => (plant && state ? calendarFor(plant, state.site, { risk, dynamicGdd: ent.has('planting.dynamicScheduling'), soilF: state.soil.soilF, soilLabel: state.soil.basisLabel }) : null), [plant, state, risk, ent]);
  const fit = useMemo(() => (plant && state ? scorePlant(plant, state.site, {}, undefined, 'your climate') : null), [plant, state]);

  if (!plant) return <Body>Unknown plant.</Body>;
  const guide = cropGuide(plant.id);
  const hub = stateExtensionHub(state?.profile?.place.stateFips);
  const climate = state?.profile?.climate;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: t.text, fontSize: 24, fontWeight: '700' }} accessibilityRole="header">{plant.commonName}</Text>
      <Text style={{ color: t.muted, fontStyle: 'italic', marginBottom: 12 }}>{plant.scientificName} · {plant.family}</Text>

      <Card title="Growing needs">
        <Body>Sun: {plant.sunHours.min}+ hours of direct sun ({plant.sunHours.ideal}+ ideal)</Body>
        <Body>Frost: {plant.frost}{plant.season !== 'perennial' ? ` · ${plant.season}-season crop` : ''} · heat tolerance {plant.heat}</Body>
        {plant.daysToMaturity && <Body>Maturity: {plant.daysToMaturity[0]}–{plant.daysToMaturity[1]} days from {plant.maturityFrom ?? 'seed'}</Body>}
        {plant.yearsToBearing && <Body>First real crop: {plant.yearsToBearing[0]}–{plant.yearsToBearing[1]} years after planting</Body>}
        <Body>Soil: pH {plant.soil.pH[0]}–{plant.soil.pH[1]}, {plant.soil.drainage.replace('-', ' ')}{plant.soil.textures ? `, ${plant.soil.textures.join('/')}` : ''} · water {plant.water}</Body>
        <Body>Spacing: {inToUnits(plant.spacingIn.inRow, imperial)} apart, rows {inToUnits(plant.spacingIn.betweenRows, imperial)}{plant.perSquareFoot ? ` · ${plant.perSquareFoot} per square foot` : ''}</Body>
        <Body>Size: {inToUnits(plant.heightIn, imperial)} tall, {inToUnits(plant.spreadIn, imperial)} wide</Body>
        {plant.zones && <Body>Hardy in zones {plant.zones[0]}–{plant.zones[1]}</Body>}
        {plant.chillHours && <Body>Winter chill: {plant.chillHours[0]}–{plant.chillHours[1]} hours, depending on variety</Body>}
        {plant.pollination && <Body>Pollination: {plant.pollination === 'needs-partner' ? 'needs a second, compatible variety nearby' : plant.pollination === 'partly-self' ? 'self-fruitful, but a partner improves the crop' : plant.pollination === 'wind' ? 'wind' : 'self-fruitful'}</Body>}
        {plant.germination && <Body>Germination: soil {plant.germination.minSoilF} °F minimum, {plant.germination.optimalF[0]}–{plant.germination.optimalF[1]} °F best</Body>}
      </Card>

      {state?.profileStale && <StaleProfileNotice parcelId={state.parcel.id} />}
      {state && (
        <Card title={`Planting calendar · ${state.parcel.name}`}>
          {plant.frost === 'tender' && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
              <Chip label="Cautious (1-in-10 late frost)" active={risk === 'cautious'} onPress={() => setRisk('cautious')} />
              <Chip label="Typical (median)" active={risk === 'typical'} onPress={() => setRisk('typical')} />
            </View>
          )}
          {cal ? <CalendarList cal={cal} /> : <Body muted>Frost dates for this property aren’t available yet, so the calendar can’t be personalised. Refresh the site profile to try again.</Body>}
          {climate?.status === 'ok' && (
            <Text style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>
              Frost dates: {climate.attribution.source}, adjusted to the parcel’s elevation. Soil temperature: {state?.soil.label}.{state?.soil.kind === 'model' ? ' A soil thermometer or sensor beats the model.' : ''}
            </Text>
          )}
        </Card>
      )}

      {fit && (
        <Card title="Fit for your climate" right={<VerdictBadge s={fit} />}>
          <Body>{fit.summary}</Body>
          {ent.has('planting.bedScoring') ? (
            <View style={{ marginTop: 8 }}><FactorList factors={fit.factors} /></View>
          ) : (
            <Body muted>Upgrade to Grower to see every factor and its weight.</Body>
          )}
          {state?.humiditySource && <Text style={{ color: t.muted, fontSize: 12 }}>Humidity: {state.humiditySource}</Text>}
        </Card>
      )}

      <Card title="Problems to watch">
        <Body>Diseases: {plant.diseases.join(', ') || 'few serious ones'}</Body>
        <Body>Pests: {plant.pests.join(', ') || 'few serious ones'}</Body>
        {plant.companions?.length ? <Body muted>Traditional companions: {plant.companions.map((id) => plantById(id)?.commonName ?? id).join(', ')} (mostly anecdotal)</Body> : null}
        {plant.avoidNear?.length ? <Body muted>Keep apart from: {plant.avoidNear.map((id) => plantById(id)?.commonName ?? id).join(', ')}</Body> : null}
      </Card>

      {plant.notes?.length ? (
        <Card title="Notes">
          {plant.notes.map((n, i) => <Body key={i}>• {n}</Body>)}
        </Card>
      ) : null}

      <Card title="Learn more from extension experts">
        {guide ? <ExternalLink link={guide} /> : <Body muted>No guide linked yet.</Body>}
        {hub && <ExternalLink link={hub} prefix="Your state" />}
        <Body muted>Land-grant university extension services give free, locally tested advice. Varieties and timing suggested by your state’s service win over the general figures here.</Body>
      </Card>

      {parcelId && <Button title="Plant it in a bed" kind="secondary" onPress={() => router.push({ pathname: '/design/[id]', params: { id: parcelId } })} />}
    </ScrollView>
  );
}
