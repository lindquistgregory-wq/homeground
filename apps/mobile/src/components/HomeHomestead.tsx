/**
 * Home once a homestead is laid out: the map fills the screen. Today's brief sits in a small card at
 * the top left, the tools (Design, Calendar, Planner, Site profile, Plants, My animals) in a ribbon on
 * the right that folds away, and tapping an object shows what's planted or living there.
 */
import { areaMembers, formatArea, footprintAreaM2, frameForBoundary, inDrawnArea, isDrawnArea, objectType, plantById, type Design } from '@plotwright/core';
import type { SiteProfile } from '@plotwright/providers';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { kvGet, kvSet } from '../db/database';
import { getDesign, mainDesignId } from '../db/designs';
import { herdsForParcel, type Herd } from '../db/herds';
import type { ParcelRecord } from '../db/parcels';
import { plantingsForParcel, type Planting } from '../db/plantings';
import { herdLabel, isCurrent } from '../services/animals';
import type { DailyBrief } from '../services/dailyBrief';
import { activePlantings, isPlantable } from '../services/garden';
import { useSettings } from '../services/settings';
import { HomeMap } from './HomeMap';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { tapFeedback, useTheme } from './ui';
import type { ImageryChoice } from '@plotwright/providers';

export type HomeRoute = '/profile/[id]' | '/design/[id]' | '/calendar/[id]' | '/planner/[id]';

/** The design that Home shows: the property's main design, if it has anything drawn on it. */
export async function homesteadDesign(parcelId: string): Promise<Design | undefined> {
  const d = await getDesign(mainDesignId(parcelId));
  return d && d.objects.some((o) => !o.existing) ? d : undefined;
}

export function HomeHomestead({ parcel, profile, brief, height, topInset, onHoldPage }: {
  parcel: ParcelRecord; profile?: SiteProfile; brief: DailyBrief | null | undefined; height: number; topInset: number;
  /** The map wants the page to stop scrolling while it's pinched or zoomed in. */
  onHoldPage?: (hold: boolean) => void;
}) {
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const animalsOn = useSettings((s) => s.animals) === 'yes';
  const [design, setDesign] = useState<Design | undefined>();
  const [plantings, setPlantings] = useState<Planting[]>([]);
  const [herds, setHerds] = useState<Herd[]>([]);
  const [imagery, setImagery] = useState<ImageryChoice>('best');
  const [selected, setSelected] = useState<string | null>(null);
  const [ribbon, setRibbon] = useState(true);
  const [briefOpen, setBriefOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      const [d, ps, hs, img, rib] = await Promise.all([
        getDesign(mainDesignId(parcel.id)), plantingsForParcel(parcel.id), herdsForParcel(parcel.id), kvGet('imagery.choice'), kvGet('home.ribbon'),
      ]);
      if (cancelled) return;
      setDesign(d);
      setPlantings(activePlantings(ps, new Date().getFullYear()));
      setHerds(hs.filter((h) => h.designId === d?.id));
      if (img === 'best' || img === 'state' || img === 'naip-plus' || img === 'standard') setImagery(img);
      setRibbon(rib !== 'closed');
    })();
    return () => { cancelled = true; };
  }, [parcel.id]));

  const go = (pathname: HomeRoute) => { tapFeedback(); router.push({ pathname, params: { id: parcel.id } }); };
  const toggleRibbon = () => { tapFeedback(); setRibbon((r) => { void kvSet('home.ribbon', r ? 'closed' : 'open'); return !r; }); };
  const tools: Array<{ icon: IconName; label: string; onPress: () => void }> = [
    { icon: 'pencil-ruler', label: 'Design', onPress: () => go('/design/[id]') },
    { icon: 'calendar-month', label: 'Calendar', onPress: () => go('/calendar/[id]') },
    { icon: 'lightbulb-on-outline', label: 'Planner', onPress: () => go('/planner/[id]') },
    { icon: 'layers-outline', label: 'Site', onPress: () => go('/profile/[id]') },
    { icon: 'sprout', label: 'Plants', onPress: () => { tapFeedback(); router.push('/plants'); } },
    ...(animalsOn ? [{ icon: 'paw' as IconName, label: 'Animals', onPress: () => { tapFeedback(); router.push('/records'); } }] : []),
  ];

  const obj = selected ? design?.objects.find((o) => o.id === selected) : undefined;
  const objPlants = obj ? plantings.filter((p) => p.bedObjectId === obj.id) : [];
  const objHerds = obj ? herds.filter((h) => h.objectId === obj.id && isCurrent(h)) : [];
  // A hand-drawn area (a garden, a paddock): what's in it, and the plants and animals of those too.
  const members = obj && design ? areaMembers(obj, design.objects).map((m) => m.object) : [];
  const memberIds = new Set(members.map((m) => m.id));
  const areaPlants = members.length ? plantings.filter((p) => memberIds.has(p.bedObjectId)) : [];
  const areaHerds = obj && isDrawnArea(obj)
    ? herds.filter((h) => isCurrent(h) && ((h.objectId && memberIds.has(h.objectId)) || (!h.objectId && h.location && inDrawnArea(obj, [h.location.lon, h.location.lat]))))
    : [];
  const shownPlants = [...objPlants, ...areaPlants];
  const shownHerds = [...objHerds, ...areaHerds];
  const frame = frameForBoundary(parcel.geometry);
  const weather = brief?.weather?.split(' · ').slice(0, 2).join(' · ');

  return (
    <View style={{ height }}>
      <HomeMap boundary={parcel.geometry} design={design} herds={animalsOn ? herds : []} stateFips={profile?.place.stateFips} imageryChoice={imagery}
        selectedId={selected} onSelect={(id) => setSelected(id)} padding={{ top: topInset + 76, right: ribbon ? 84 : 28, bottom: 28, left: 20 }} onHoldPage={onHoldPage} />
      {/* A soft band under the status bar so the clock and icons stay readable over the imagery. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: topInset, backgroundColor: 'rgba(0,0,0,0.28)' }} />

      {/* Today, small: the forecast and how many things are on; tap for the list. */}
      {brief !== null && (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: briefOpen }} accessibilityLabel={`Daily brief${weather ? `: ${weather}` : ''}${brief ? `, ${brief.events.length} on the calendar today` : ''}`}
          onPress={() => { tapFeedback(); setBriefOpen(!briefOpen); }}
          style={[styles.brief, { top: topInset + 10, backgroundColor: t.dark ? 'rgba(32,35,40,0.94)' : 'rgba(255,255,255,0.94)', borderColor: t.border }]}>
          <View style={styles.briefHead}>
            <Icon name="weather-partly-cloudy" size={20} color={t.warn} />
            <View style={{ flexShrink: 1 }}>
              <Text style={{ color: t.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{brief === undefined ? 'Today…' : weather ?? 'No forecast today'}</Text>
              {brief && (
                <Text style={{ color: brief.alerts.length ? (brief.alerts.some((a) => a.urgent) ? t.bad : t.warn) : t.muted, fontSize: 12, fontWeight: brief.alerts.length ? '700' : '400' }} numberOfLines={1}>
                  {brief.events.length ? `${brief.events.length} on the calendar today` : 'Nothing on the calendar today'}{brief.alerts[0] ? ` · ${brief.alerts[0].title}` : ''}
                </Text>
              )}
            </View>
          </View>
          {briefOpen && brief && (
            <View style={[styles.briefBody, { borderTopColor: t.border }]}>
              {brief.weather && <Text style={{ color: t.muted, fontSize: 12 }}>{brief.weather}</Text>}
              {brief.alerts.map((a) => <Text key={a.title} style={{ color: a.urgent ? t.bad : t.warn, fontWeight: '700', fontSize: 13 }}>{a.title}</Text>)}
              {brief.events.slice(0, 5).map((e) => <Text key={e.id} style={{ color: t.text, fontSize: 13 }}>• {e.title}</Text>)}
              {brief.events.length > 5 && <Text style={{ color: t.muted, fontSize: 12 }}>…and {brief.events.length - 5} more</Text>}
              {brief.ongoing.length > 0 && <Text style={{ color: t.muted, fontSize: 12 }}>Ongoing: {brief.ongoing.slice(0, 3).map((e) => e.title).join('; ')}</Text>}
              <Pressable accessibilityRole="link" onPress={() => go('/calendar/[id]')} style={{ minHeight: 36, justifyContent: 'center' }}>
                <Text style={{ color: t.accent, fontWeight: '600' }}>Open the calendar</Text>
              </Pressable>
              <Text style={{ color: t.muted, fontSize: 11 }}>Forecast: National Weather Service. Not an official warning.</Text>
            </View>
          )}
        </Pressable>
      )}

      {/* Tools ribbon on the right; folds to a small tab. */}
      {ribbon ? (
        <View accessibilityRole="toolbar" accessibilityLabel="Homestead tools" style={[styles.ribbon, { top: topInset + 76, backgroundColor: t.dark ? 'rgba(22,24,28,0.94)' : 'rgba(247,244,236,0.95)', borderColor: t.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Hide tools" onPress={toggleRibbon} style={styles.ribbonToggle} hitSlop={6}>
            <Icon name="chevron-right" size={20} color={t.muted} />
          </Pressable>
          {tools.map((x) => (
            <Pressable key={x.label} accessibilityRole="button" accessibilityLabel={x.label} onPress={x.onPress} style={styles.tool}>
              <View style={[styles.toolWell, { backgroundColor: t.accentSoft }]}><Icon name={x.icon} size={20} color={t.accent} /></View>
              <Text style={{ color: t.text, fontSize: 10.5 }} numberOfLines={1}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Show tools" onPress={toggleRibbon}
          style={[styles.ribbonTab, { top: topInset + 160, backgroundColor: t.dark ? 'rgba(22,24,28,0.94)' : 'rgba(247,244,236,0.95)', borderColor: t.border }]}>
          <Icon name="chevron-left" size={20} color={t.accent} />
          <Icon name="view-grid-outline" size={18} color={t.accent} />
        </Pressable>
      )}

      {/* What's in the tapped object. */}
      {obj && (
        <View style={[styles.popup, { backgroundColor: t.card, borderColor: t.border }]} accessibilityViewIsModal={false}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }} accessibilityRole="header">{obj.label ?? objectType(obj.kind)?.name ?? obj.kind}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{objectType(obj.kind)?.name ?? obj.kind} · {formatArea(footprintAreaM2(obj, frame), units)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSelected(null)} style={styles.close}><Icon name="close" size={20} color={t.muted} /></Pressable>
          </View>
          {isDrawnArea(obj) && (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.colHead, { color: t.accent }]}>IN THIS AREA</Text>
              {members.length
                ? <Text style={{ color: t.text, fontSize: 13 }}>{members.slice(0, 6).map((m) => m.label ?? objectType(m.kind)?.name ?? m.kind).join(', ')}{members.length > 6 ? ` and ${members.length - 6} more` : ''}</Text>
                : <Text style={{ color: t.muted, fontSize: 13 }}>Nothing yet</Text>}
            </View>
          )}
          <View style={styles.cols}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.colHead, { color: t.growth }]}>PLANTS</Text>
              {shownPlants.length ? shownPlants.slice(0, 5).map((p) => <Text key={p.id} style={{ color: t.text, fontSize: 13 }}>{plantById(p.plantId)?.commonName ?? p.plantId}{p.share < 1 && !areaPlants.includes(p) ? ` (${Math.round(p.share * 100)}%)` : ''}</Text>)
                : <Text style={{ color: t.muted, fontSize: 13 }}>{isPlantable(obj) || isDrawnArea(obj) ? 'Nothing planted yet' : 'None'}</Text>}
              {shownPlants.length > 5 && <Text style={{ color: t.muted, fontSize: 12 }}>+{shownPlants.length - 5} more</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.colHead, { color: t.warn }]}>ANIMALS</Text>
              {shownHerds.length ? shownHerds.map((h) => <Text key={h.id} style={{ color: t.text, fontSize: 13 }}>{herdLabel(h)}{h.status === 'planned' ? ' (planned)' : ''}</Text>)
                : <Text style={{ color: t.muted, fontSize: 13 }}>None</Text>}
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={() => { tapFeedback(); router.push({ pathname: '/design/[id]', params: { id: parcel.id, select: obj.id } }); }}
            style={[styles.goBtn, { backgroundColor: t.accent }]}>
            <Text style={{ color: t.onAccent, fontWeight: '700', fontSize: 15 }}>Go to design</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  brief: { position: 'absolute', left: 12, maxWidth: 260, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, elevation: 4 },
  briefHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  briefBody: { marginTop: 8, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, gap: 2 },
  ribbon: { position: 'absolute', right: 8, width: 64, borderWidth: 1, borderRadius: 20, paddingVertical: 4, alignItems: 'center', elevation: 5 },
  ribbonToggle: { width: 44, height: 32, alignItems: 'center', justifyContent: 'center' },
  ribbonTab: { position: 'absolute', right: 0, width: 44, height: 72, borderWidth: 1, borderRightWidth: 0, borderTopLeftRadius: 16, borderBottomLeftRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 2, elevation: 5 },
  tool: { width: 60, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, gap: 2 },
  toolWell: { width: 40, height: 30, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  popup: { position: 'absolute', left: 12, right: 12, bottom: 12, borderWidth: 1, borderRadius: 20, padding: 14, elevation: 8 },
  close: { width: 44, height: 44, marginTop: -10, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  cols: { flexDirection: 'row', gap: 12, marginTop: 8 },
  colHead: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  goBtn: { marginTop: 12, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
