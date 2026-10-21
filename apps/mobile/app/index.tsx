/**
 * Home: a greeting, each property as a card (map with its name, key facts, four action tiles), and
 * what's coming up in the garden (and, with animal features on, for the herds). With no property yet, an illustrated welcome and one button.
 */
import { formatArea, formatDoy, windowOverlaps } from '@plotwright/core';
import type { SiteProfile } from '@plotwright/providers';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { FactChips } from '../src/components/facts';
import { Icon, type IconName } from '../src/components/Icon';
import { FieldScene } from '../src/components/Illustration';
import { PlantArt } from '../src/components/PlantArt';
import { AnimalArt } from '../src/components/AnimalArt';
import { plantById } from '@plotwright/core';
import { EmptyState, Tile, TileRow } from '../src/components/kit';
import { ParcelMap } from '../src/components/ParcelMap';
import { Text } from '../src/components/Text';
import { Body, Button, Card, Skeleton, tapFeedback, useTheme } from '../src/components/ui';
import { useEntitlements } from '../src/billing/entitlements';
import { getSiteProfile, listParcels, type ParcelRecord } from '../src/db/parcels';
import { homeSummary, todayDoy, type HomeSummary, type HomeTask } from '../src/services/homeSummary';
import { dailyBrief, type DailyBrief } from '../src/services/dailyBrief';
import { EventRow } from '../src/components/calendar';
import { useSettings } from '../src/services/settings';

const TASK_ICON: Partial<Record<HomeTask['kind'], IconName>> = {
  'start-indoors': 'sprout-outline', 'harden-off': 'weather-sunny', transplant: 'shovel', 'direct-sow': 'seed-outline', plant: 'shovel',
  succession: 'repeat', 'fall-sow': 'seed-outline', 'fall-transplant': 'shovel', harvest: 'basket-outline', 'fall-harvest': 'basket-outline',
};

function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const units = useSettings((s) => s.units);
  const animals = useSettings((s) => s.animals);
  const setAnimals = useSettings((s) => s.setAnimals);
  const limits = useEntitlements((s) => s.entitlements.limits);
  const [parcels, setParcels] = useState<ParcelRecord[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, SiteProfile | undefined>>({});
  const [summaries, setSummaries] = useState<Record<string, HomeSummary>>({});
  const [briefs, setBriefs] = useState<Record<string, DailyBrief | null>>({});
  const showProcessing = useSettings((s) => s.showProcessing);
  // Read inside the focus effect without re-running it on every settings change.
  const animalsRef = useRef(animals);
  animalsRef.current = animals;
  const processingRef = useRef(showProcessing);
  processingRef.current = showProcessing;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listParcels().then(async (ps) => {
        if (cancelled) return;
        setParcels(ps);
        const profs = Object.fromEntries(await Promise.all(ps.map(async (p) => [p.id, await getSiteProfile(p.id)] as const)));
        if (cancelled) return;
        setProfiles(profs);
        const sums = await Promise.all(ps.map(async (p) => [p.id, await homeSummary(p.id, profs[p.id], 28, { animals: animalsRef.current === 'yes', showProcessing: processingRef.current }).catch(() => undefined)] as const));
        if (!cancelled) setSummaries(Object.fromEntries(sums.filter((s): s is readonly [string, HomeSummary] => !!s[1])));
        // The daily brief needs the forecast, so it fills in after the cards are up.
        for (const p of ps) void dailyBrief(p.id).catch(() => null).then((b) => { if (!cancelled) setBriefs((x) => ({ ...x, [p.id]: b })); });
      });
      return () => { cancelled = true; };
    }, []),
  );

  const atLimit = (parcels?.length ?? 0) >= limits.parcels;
  const go = (pathname: '/profile/[id]' | '/design/[id]' | '/calendar/[id]' | '/planner/[id]', id: string) => router.push({ pathname, params: { id } });
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 12, paddingBottom: 24 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.date, { color: t.muted }]}>{today}</Text>
          <Text style={[styles.hello, { color: t.text }]} accessibilityRole="header">{greeting()}</Text>
        </View>
        <View style={[styles.logo, { backgroundColor: t.accentSoft }]} accessible accessibilityLabel="Plotwright">
          <Icon name="sprout" size={26} color={t.accent} />
        </View>
      </View>

      {parcels === null && (
        <View style={[styles.property, { backgroundColor: t.card, padding: 16 }]}>
          <View style={{ height: 150, borderRadius: 16, backgroundColor: t.surface, marginBottom: 14 }} />
          <Skeleton lines={3} label="Loading your properties" />
        </View>
      )}

      {parcels && parcels.length === 0 && (
        <>
          <EmptyState
            icon="map-search-outline"
            art={<FieldScene width={300} height={160} />}
            title="Plan your land"
            text="Find your property and Plotwright builds a profile from free public data: soils, frost dates, sun and water."
            action="Find your property"
            onAction={() => router.push('/locate')}
          />
          <Card title="What you get" icon="star-four-points-outline">
            {([
              ['map-marker-radius-outline', 'Your actual parcel', 'Boundary, slope, soils and flood zones'],
              ['sprout-outline', 'What grows where', 'Each bed scored for sun, soil and climate'],
              ['calendar-check-outline', 'When to do it', 'Sowing, planting and harvest dates, with frost alerts'],
            ] as const).map(([icon, title, detail]) => (
              <View key={title} style={styles.benefit}>
                <View style={[styles.benefitIcon, { backgroundColor: t.accentSoft }]}><Icon name={icon} size={20} color={t.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }}>{title}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>{detail}</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {/* Asked once (owner decision 2): animal features stay out of sight unless someone wants them. */}
      {parcels && parcels.length > 0 && animals === null && (
        <Card title="Do you keep, or plan to keep, animals?" icon="paw-outline">
          <Body muted>Plotwright can plan for poultry, goats, bees and more: where they live, care dates and heat alerts. You can change this any time in More.</Body>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <View style={{ flex: 1 }}><Button title="Yes, show animals" onPress={() => setAnimals('yes')} /></View>
            <View style={{ flex: 1 }}><Button title="No thanks" kind="secondary" onPress={() => setAnimals('no')} /></View>
          </View>
        </Card>
      )}

      {parcels?.map((item) => {
        const profile = profiles[item.id];
        const sum = summaries[item.id];
        const tasks = sum?.tasks ?? [];
        const d = todayDoy();
        return (
          <View key={item.id}>
            <View style={[styles.property, { backgroundColor: t.card }, t.dark ? { borderColor: t.border, borderWidth: 1 } : styles.shadow]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open the site profile for ${item.name}`} onPress={() => { tapFeedback(); go('/profile/[id]', item.id); }}>
                {/* The map is a picture here: touches go to the card, not to panning the map. */}
                <View pointerEvents="none" style={styles.thumb}>
                  <ParcelMap boundary={item.geometry} style={StyleSheet.absoluteFill} ornamentsTop />
                  <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 10 10">
                    <Defs>
                      <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0.45" stopColor="#000" stopOpacity="0" />
                        <Stop offset="1" stopColor="#000" stopOpacity="0.72" />
                      </LinearGradient>
                    </Defs>
                    <Rect x="0" y="0" width="10" height="10" fill="url(#shade)" />
                  </Svg>
                  <View style={styles.overlay}>
                    <Text style={styles.overlayName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.overlaySub} numberOfLines={1}>
                      {formatArea(item.areaM2, units)}{profile?.place.countyName ? ` · ${profile.place.countyName}` : ''}
                    </Text>
                  </View>
                </View>
              </Pressable>
              <View style={styles.propertyBody}>
                <FactChips profile={profile} />
                <View style={{ height: 12 }} />
                <TileRow>
                  <Tile icon="pencil-ruler" label="Design" caption={sum ? (sum.objects ? `${sum.objects} object${sum.objects === 1 ? '' : 's'}` : 'Start a layout') : undefined} onPress={() => go('/design/[id]', item.id)} />
                  <Tile icon="calendar-month" label="Calendar" caption={sum ? (tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} soon` : (sum.crops ? `${sum.crops} crop${sum.crops === 1 ? '' : 's'}` : 'No crops yet')) : undefined} onPress={() => go('/calendar/[id]', item.id)} />
                </TileRow>
                <View style={{ height: 10 }} />
                <TileRow>
                  <Tile icon="lightbulb-on-outline" label="Planner" caption="Plan the homestead" onPress={() => go('/planner/[id]', item.id)} />
                  <Tile icon="layers-outline" label="Site profile" caption="Soil, sun, water" onPress={() => go('/profile/[id]', item.id)} />
                </TileRow>
                <View style={{ height: 10 }} />
                <TileRow>
                  <Tile icon="sprout" label="Plants" caption="What grows here" onPress={() => router.push('/plants')} />
                  {animals === 'yes' && (
                    <Tile icon="paw" label="My animals" caption={sum?.animals ? `${sum.animals} animal${sum.animals === 1 ? '' : 's'}` : 'Library, health, logs'} onPress={() => router.push('/records')} />
                  )}
                </TileRow>
              </View>
            </View>

            <BriefCard brief={briefs[item.id]} onOpen={() => go('/calendar/[id]', item.id)} />

            {sum && (
              <Card title="Coming up" icon="calendar-clock" right={tasks.length ? (
                <Pressable accessibilityRole="link" onPress={() => go('/calendar/[id]', item.id)} hitSlop={10}>
                  <Text style={{ color: t.accent, fontWeight: '600' }}>See all</Text>
                </Pressable>
              ) : undefined}>
                {tasks.length === 0 ? (
                  <Body muted>
                    {sum.crops || sum.animals
                      ? (sum.next ? `Nothing in the next four weeks. Next: ${sum.next.plantName}, ${sum.next.label.toLowerCase()}, ${formatDoy(sum.next.start)}.` : 'Nothing in the next four weeks.')
                      : (animals === 'yes' ? 'Add crops to a bed or animals to their housing, and their dates show up here.' : 'Add crops to a bed and their sowing, planting and harvest dates show up here.')}
                  </Body>
                ) : tasks.slice(0, 4).map((e, i) => (
                  <View key={i} style={[styles.task, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    {e.animalId ? <AnimalArt animalId={e.animalId} size={42} /> : plantById(e.plantId) ? <PlantArt plant={plantById(e.plantId)!} size={42} /> : <View style={[styles.taskIcon, { backgroundColor: t.accentSoft }]}><Icon name={TASK_ICON[e.kind] ?? 'paw'} size={20} color={t.accent} /></View>}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }}>{e.plantName}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Icon name={TASK_ICON[e.kind] ?? 'paw'} size={14} color={t.muted} />
                        <Text style={{ color: t.muted, fontSize: 13 }}>{e.label}</Text>
                      </View>
                    </View>
                    <Text style={{ color: windowOverlaps(e, d, d) ? t.accent : t.muted, fontSize: 13, fontWeight: '600' }}>
                      {windowOverlaps(e, d, d) ? `Now – ${formatDoy(e.end)}` : formatDoy(e.start)}
                    </Text>
                  </View>
                ))}
              </Card>
            )}
          </View>
        );
      })}

      {parcels && parcels.length > 0 && (
        atLimit ? (
          // At the plan's limit: a quiet line instead of a large disabled button.
          <Text style={[styles.limit, { color: t.muted }]}>
            Your plan includes {limits.parcels} propert{limits.parcels === 1 ? 'y' : 'ies'} ·{' '}
            <Text accessibilityRole="link" style={{ color: t.accent, fontWeight: '600' }} onPress={() => router.push({ pathname: '/paywall', params: { source: 'home' } })}>
              See plans
            </Text>
          </Text>
        ) : (
          <Button icon="map-marker-plus-outline" kind="secondary" title="Add another property" onPress={() => router.push('/locate')} accessibilityHint="Search an address, use GPS, or tap the map" />
        )
      )}
    </ScrollView>
      {/* This screen has no header: keep scrolled content from running under the status bar. */}
      <View pointerEvents="none" style={[styles.statusBar, { height: insets.top, backgroundColor: t.bg }]} />
    </View>
  );
}

/** Today on the homestead: the forecast in a line, today's alerts, and what's on the calendar. */
function BriefCard({ brief, onOpen }: { brief: DailyBrief | null | undefined; onOpen: () => void }) {
  const t = useTheme();
  if (brief === null) return null;
  return (
    <Card title="Daily brief" icon="weather-partly-cloudy" right={
      <Pressable accessibilityRole="link" onPress={onOpen} hitSlop={10}><Text style={{ color: t.accent, fontWeight: '600' }}>Calendar</Text></Pressable>
    }>
      {brief === undefined ? <Skeleton lines={2} label="Loading today's brief" /> : (
        <>
          {brief.weather ? <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{brief.weather}</Text> : <Body muted>{brief.weatherNote ?? 'No forecast for today.'}</Body>}
          {brief.alerts.map((a) => <Text key={a.title} style={{ color: a.urgent ? t.bad : t.warn, fontWeight: '700', marginTop: 4 }}>{a.title}</Text>)}
          <View style={{ marginTop: 8 }}>
            {brief.events.length ? brief.events.slice(0, 4).map((e) => <EventRow key={e.id} item={e} onPress={onOpen} />) : <Body muted>Nothing on the calendar today.</Body>}
            {brief.events.length > 4 && <Body muted>…and {brief.events.length - 4} more.</Body>}
            {brief.ongoing.length > 0 && <Text style={{ color: t.muted, fontSize: 13 }}>Ongoing: {brief.ongoing.slice(0, 3).map((e) => e.title).join('; ')}{brief.ongoing.length > 3 ? '…' : ''}</Text>}
          </View>
          <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Forecast: National Weather Service. Not an official warning.</Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  date: { fontSize: 14, fontWeight: '500' },
  hello: { fontSize: 28, fontWeight: '700', marginTop: 2 },
  logo: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  property: { borderRadius: 22, overflow: 'hidden', marginBottom: 14 },
  shadow: { elevation: 3, shadowColor: '#1b2a1e', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  thumb: { height: 190 },
  overlay: { position: 'absolute', left: 16, right: 16, bottom: 12 },
  overlayName: { color: '#ffffff', fontSize: 24, fontWeight: '700' },
  overlaySub: { color: '#eef3ea', fontSize: 14, fontWeight: '500' },
  propertyBody: { padding: 14 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  benefitIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  taskIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  limit: { fontSize: 15, textAlign: 'center', marginTop: 4 },
});
