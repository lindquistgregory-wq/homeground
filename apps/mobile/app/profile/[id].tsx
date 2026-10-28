/**
 * Site Profile v1 (§3). Every layer shows its source, licence, retrieval date, resolution and
 * confidence, or an explicit "unavailable" reason. Profiles are cached on-device and refreshable.
 */
import {
  formatArea, formatDoy, formatElevation, formatLength, mToFt, type RiskLevel, type ThresholdF,
} from '@plotwright/core';
import { bundledZoneTable } from '@plotwright/data';
import { SITE_PROFILE_VERSION, buildSiteProfile, type SiteProfile } from '@plotwright/providers';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { OWN_CLOUD } from '../../src/sync/userCloud';
import { Text } from '../../src/components/Text';
import { OfflinePackCard } from '../../src/components/OfflinePack';
import { ParcelMap } from '../../src/components/ParcelMap';
import { FactChips } from '../../src/components/facts';
import { MoreInfo, Tile, TileRow } from '../../src/components/kit';
import { deletePack, type PackInfo } from '../../src/services/offlinePacks';
import { Body, Button, Card, LayerCard, LEGAL_DISCLAIMER, useTheme } from '../../src/components/ui';
import { deleteParcel, getParcel, getSiteProfile, saveSiteProfile, type ParcelRecord } from '../../src/db/parcels';
import { http } from '../../src/services/http';
import { useSettings } from '../../src/services/settings';
import { refreshHealthReminders } from '../../src/services/healthReminders';
import { refreshEventReminders } from '../../src/services/eventReminders';

export default function Profile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const [parcel, setParcel] = useState<ParcelRecord | null>(null);
  const [profile, setProfile] = useState<SiteProfile | null>(null);
  const [loading, setLoading] = useState<string[]>([]);
  // Layers that have arrived during the current build, shown over the stored profile until the build saves.
  const [arrived, setArrived] = useState<Partial<SiteProfile>>({});
  const [pack, setPack] = useState<PackInfo | undefined>(undefined);

  const compute = useCallback(async (p: ParcelRecord, refresh = false) => {
    setLoading(['starting']);
    setArrived({});
    // "Refresh" bypasses fresh cache entries; the first build uses whatever is cached.
    const result = await buildSiteProfile({ http: refresh ? http.fresh() : http, zoneTable: bundledZoneTable }, p.geometry, { countyFips: p.countyFips, zip: p.zip }, (layer, status, value) => {
      setLoading((l) => (status === 'started' ? [...l, String(layer)] : l.filter((x) => x !== layer && x !== 'starting')));
      if (status === 'done' && value !== undefined) setArrived((a) => ({ ...a, [layer]: value }));
    });
    await saveSiteProfile(p.id, result);
    setProfile(result);
    setArrived({});
    setLoading([]);
  }, []);

  useEffect(() => {
    (async () => {
      const p = await getParcel(id);
      if (!p) return;
      setParcel(p);
      const cached = await getSiteProfile(id);
      if (cached) setProfile(cached);
      // Build it, or rebuild one from an older app version (shown meanwhile) that lacks newer layers.
      if (!cached || cached.version < SITE_PROFILE_VERSION) await compute(p);
    })();
  }, [id, compute]);

  if (!parcel) return <Body>Loading…</Body>;
  const ft = units === 'imperial';
  // Each card shows its layer as soon as it arrives, without waiting for the slowest service.
  const shown: Partial<SiteProfile> | null = profile || Object.keys(arrived).length ? { ...profile, ...arrived } : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={styles.map}>
        <ParcelMap boundary={parcel.geometry} offlineImagery={pack?.imagery} />
      </View>
      <Card title={parcel.name} icon="map-marker-radius-outline">
        <Body>
          {formatArea(parcel.areaM2, units)} · perimeter {profile ? formatLength(profile.perimeterM, units) : '…'}{shown?.place?.countyName ? ` · ${shown.place.countyName}` : ''}
        </Body>
        <FactChips profile={shown} />
        {loading.length > 0 && <Body muted>Fetching: {loading.filter((l) => l !== 'starting').join(', ') || 'starting'}…</Body>}
        <MoreInfo label="Boundary and sources">
          <Body muted>
            Boundary: {parcel.boundarySource}
            {parcel.boundaryMeta.attribution ? ` (${parcel.boundaryMeta.attribution})` : ''}
            {parcel.boundaryMeta.medianGpsAccuracyM ? ` · GPS ±${Math.round(parcel.boundaryMeta.medianGpsAccuracyM)} m` : ''}
          </Body>
          {profile && <Body muted>Profile built {new Date(profile.computedAt).toLocaleString()}</Body>}
        </MoreInfo>
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>{LEGAL_DISCLAIMER}</Text>
      </Card>

      <LayerCard
        title="Elevation"
        icon="image-filter-hdr"
        layer={shown?.elevation}
        summary={(e) => `${formatElevation(e.centroidM, units)} at the centre · ${ft ? `${Math.round(mToFt(e.reliefM))} ft` : `${Math.round(e.reliefM)} m`} of relief`}
      >
        {(e) => (
          <Body>
            {formatElevation(e.centroidM, units)} at the centre · {formatElevation(e.minM, units)}–{formatElevation(e.maxM, units)} across
            the parcel ({ft ? `${Math.round(mToFt(e.reliefM))} ft` : `${Math.round(e.reliefM)} m`} of relief in {e.samples} samples)
          </Body>
        )}
      </LayerCard>

      <LayerCard title="Hardiness zone" icon="thermometer" layer={shown?.hardiness} summary={(z) => `Zone ${z.zone}`}>
        {(z) => (
          <Body>
            Zone {z.zone}
            {z.rangeF ? ` · average coldest night ${ft ? `${z.rangeF[0]} to ${z.rangeF[1]} °F` : `${Math.round(((z.rangeF[0] - 32) * 5) / 9)} to ${Math.round(((z.rangeF[1] - 32) * 5) / 9)} °C`}` : ''}
          </Body>
        )}
      </LayerCard>

      <LayerCard
        title="Frost dates (adjusted to your elevation)"
        icon="snowflake"
        layer={shown?.climate}
        summary={(c) => {
          const d = c.frost.dates;
          if (d.freezeRare) return 'Freezes are rare here.';
          const last = d.lastSpring[32][50], first = d.firstFall[32][50];
          return [last !== null ? `Last frost ${formatDoy(last)}` : null, first !== null ? `first frost ${formatDoy(first)}` : null,
            d.freezeFreeDays !== null ? `${d.freezeFreeDays}-day season` : null].filter(Boolean).join(' · ') || 'Median dates and ranges';
        }}
      >
        {(c) =>
          c.frost.dates.freezeRare ? (
            <Body>Freezes are rare here: nearby stations don't record a 32 °F freeze in most years.</Body>
          ) : (
            <View>
              <FrostTable title="Last spring freeze" table={c.frost.dates.lastSpring} spring />
              <FrostTable title="First fall freeze" table={c.frost.dates.firstFall} />
              {c.frost.dates.freezeFreeDays !== null && <Body>Typical freeze-free season: {c.frost.dates.freezeFreeDays} days</Body>}
              {c.annual?.gddBase50F !== undefined && <Body muted>Growing degree days (base 50 °F): {Math.round(c.annual.gddBase50F)} per year at the nearest station</Body>}
            </View>
          )
        }
      </LayerCard>

      <LayerCard
        title="Soils"
        icon="shovel"
        layer={shown?.soils}
        summary={(s) => {
          const u = s.units[0];
          if (!u) return 'No soil map units here.';
          const parts = [`${u.percentOfParcel !== undefined ? `${Math.round(u.percentOfParcel)}% ` : ''}${(u.name ?? u.symbol ?? u.mukey).split(',')[0]}`,
            u.surface?.pH !== undefined ? `pH ${u.surface.pH}` : null, u.drainageClass ?? null];
          return parts.filter(Boolean).join(' · ') + (s.units.length > 1 ? ` · +${s.units.length - 1} more` : '');
        }}
      >
        {(s) => (
          <View>
            {s.units.slice(0, 6).map((u) => (
              <View key={u.mukey} style={styles.soil}>
                <Text style={[styles.soilName, { color: t.text }]}>
                  {u.percentOfParcel !== undefined ? `${Math.round(u.percentOfParcel)}% · ` : ''}{u.name ?? u.symbol ?? u.mukey}
                </Text>
                <Body muted>
                  {[u.drainageClass, u.surface?.texture, u.surface?.pH !== undefined ? `pH ${u.surface.pH}` : null,
                    u.surface?.organicMatterPct !== undefined ? `${u.surface.organicMatterPct}% organic matter` : null,
                    u.hydrologicGroup ? `hydrologic group ${u.hydrologicGroup}` : null,
                    u.hydricPercent && u.hydricPercent > 0 ? `${u.hydricPercent}% hydric` : null, u.farmlandClass]
                    .filter(Boolean)
                    .join(' · ')}
                </Body>
              </View>
            ))}
          </View>
        )}
      </LayerCard>

      <LayerCard title="Flood hazard" icon="home-flood" layer={shown?.flood} summary={(f) => f.headline}>
        {(f) => (
          <>
            <Body>{f.headline}</Body>
            <Body muted>Not an official flood determination: FEMA’s Flood Map Service Center is. Land outside mapped zones can still flood.</Body>
          </>
        )}
      </LayerCard>

      <LayerCard title="Streams & ponds" icon="waves" layer={shown?.water}
        summary={(w) => w.nearest ? `Nearest ${w.nearest.kind === 'stream' ? 'stream' : 'pond or lake'} ${formatLength(w.nearest.distanceM, units)} away · ${w.features.length} nearby` : 'None mapped nearby'}>
        {(w) =>
          w.nearest ? (
            <Body>
              Nearest: {w.nearest.name ?? (w.nearest.kind === 'stream' ? 'unnamed stream' : 'unnamed pond or lake')},{' '}
              {formatLength(w.nearest.distanceM, units)} from the centre of the parcel. {w.features.length} water feature
              {w.features.length === 1 ? '' : 's'} within {formatLength(w.searchRadiusM, units)} of the boundary.
            </Body>
          ) : (
            <Body>No mapped streams or ponds within {formatLength(w.searchRadiusM, units)} of the boundary.</Body>
          )
        }
      </LayerCard>

      {profile && (
        <Card title="Aerial imagery" icon="satellite-variant">
          <Body>{profile.imagery.attribution}</Body>
          <MoreInfo label="When it was flown">
            <Body muted>{profile.imagery.captureNote}</Body>
          </MoreInfo>
        </Card>
      )}

      <OfflinePackCard parcelId={parcel.id} onChange={setPack} />

      <TileRow>
        <Tile icon="lightbulb-on-outline" label="Planner" caption="Phased plan" onPress={() => router.push({ pathname: '/planner/[id]', params: { id: parcel.id } })} />
        <Tile icon="pencil-ruler" label="Design" caption="Layout" onPress={() => router.push({ pathname: '/design/[id]', params: { id: parcel.id } })} />
        <Tile icon="calendar-month" label="Calendar" caption="Dates & alerts" onPress={() => router.push({ pathname: '/calendar/[id]', params: { id: parcel.id } })} />
      </TileRow>
      <View style={{ height: 10 }} />
      <TileRow>
        <Tile icon="sprout-outline" label="Plants" caption="What grows" onPress={() => router.push({ pathname: '/plants', params: { parcelId: parcel.id } })} />
        <Tile icon="thermometer" label="Sensors" caption="Readings" onPress={() => router.push({ pathname: '/sensors', params: { parcelId: parcel.id } })} />
        <Tile icon="weather-sunset" label="Sun path" caption="Sun check" onPress={() => router.push({ pathname: '/sun/[id]', params: { id: parcel.id } })} />
      </TileRow>
      <View style={{ height: 8 }} />
      <Button icon="refresh" kind="secondary" title={loading.length ? 'Updating…' : 'Refresh site profile'} onPress={() => compute(parcel, true)} disabled={loading.length > 0} />
      <Button
        title="Delete this property"
        kind="secondary"
        onPress={() =>
          Alert.alert('Delete property?', OWN_CLOUD
            ? `This removes the boundary and profile from this device and marks them deleted on your other devices. Older synced copies stay in your ${OWN_CLOUD} until you use “Delete all my data”.`
            : 'This removes the boundary and profile from this device.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: async () => {
              await deletePack(parcel.id).catch(() => undefined);
              await deleteParcel(parcel.id);
              // Its animals' health reminders and its calendar reminders go with it.
              await Promise.all([refreshHealthReminders().catch(() => 0), refreshEventReminders().catch(() => 0)]);
              router.replace('/');
            } },
          ])
        }
      />
    </ScrollView>
  );
}

function FrostTable({ title, table, spring }: { title: string; table: Record<ThresholdF, Record<RiskLevel, number | null>>; spring?: boolean }) {
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const label = (th: ThresholdF) => (units === 'imperial' ? `${th} °F` : `${Math.round(((th - 32) * 5) / 9)} °C`);
  const cell = (d: number | null) => (d === null ? '—' : formatDoy(d));
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ color: t.text, fontWeight: '600', marginBottom: 2 }}>{title}</Text>
      {([32, 28] as ThresholdF[]).map((th) => (
        <Text key={th} style={{ color: t.text }} accessibilityLabel={`${title} at ${label(th)}: 9 in 10 years ${spring ? 'after' : 'before'} ${cell(table[th][90])}, median ${cell(table[th][50])}, 1 in 10 years ${spring ? 'after' : 'before'} ${cell(table[th][10])}`}>
          {label(th)}: median {cell(table[th][50])} · range {spring ? `${cell(table[th][90])}–${cell(table[th][10])}` : `${cell(table[th][10])}–${cell(table[th][90])}`}
        </Text>
      ))}
      <Text style={{ color: t.muted, fontSize: 12 }}>
        {spring ? 'Range: 9 in 10 years the last freeze is after the first date; only 1 in 10 is after the second.' : 'Range: only 1 in 10 years freezes before the first date; 9 in 10 have frozen by the second.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 240, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  soil: { marginBottom: 8 },
  soilName: { fontSize: 15, fontWeight: '600' },
});

