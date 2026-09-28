/**
 * Site Profile v1 (§3). Every layer shows its source, licence, retrieval date, resolution and
 * confidence, or an explicit "unavailable" reason. Profiles are cached on-device and refreshable.
 */
import {
  formatArea, formatDoy, formatElevation, formatLength, mToFt, type RiskLevel, type ThresholdF,
} from '@plotwright/core';
import { bundledZoneTable } from '@plotwright/data';
import { buildSiteProfile, type SiteProfile } from '@plotwright/providers';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ParcelMap } from '../../src/components/ParcelMap';
import { Body, Button, Card, LayerCard, LEGAL_DISCLAIMER, useTheme } from '../../src/components/ui';
import { deleteParcel, getParcel, getSiteProfile, saveSiteProfile, type ParcelRecord } from '../../src/db/parcels';
import { http } from '../../src/services/http';
import { useSettings } from '../../src/services/settings';

export default function Profile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const [parcel, setParcel] = useState<ParcelRecord | null>(null);
  const [profile, setProfile] = useState<SiteProfile | null>(null);
  const [loading, setLoading] = useState<string[]>([]);

  const compute = useCallback(async (p: ParcelRecord, refresh = false) => {
    setLoading(['starting']);
    // "Refresh" bypasses fresh cache entries; the first build uses whatever is cached.
    const result = await buildSiteProfile({ http: refresh ? http.fresh() : http, zoneTable: bundledZoneTable }, p.geometry, { countyFips: p.countyFips, zip: p.zip }, (layer, status) =>
      setLoading((l) => (status === 'started' ? [...l, String(layer)] : l.filter((x) => x !== layer && x !== 'starting'))),
    );
    await saveSiteProfile(p.id, result);
    setProfile(result);
    setLoading([]);
  }, []);

  useEffect(() => {
    (async () => {
      const p = await getParcel(id);
      if (!p) return;
      setParcel(p);
      const cached = await getSiteProfile(id);
      if (cached) setProfile(cached);
      else await compute(p);
    })();
  }, [id, compute]);

  if (!parcel) return <Body>Loading…</Body>;
  const ft = units === 'imperial';

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={styles.map}>
        <ParcelMap boundary={parcel.geometry} />
      </View>
      <Body muted>{LEGAL_DISCLAIMER}</Body>

      <Card title={parcel.name}>
        <Body>
          {formatArea(parcel.areaM2, units)} · perimeter {profile ? formatLength(profile.perimeterM, units) : '…'}
        </Body>
        <Body muted>
          Boundary: {parcel.boundarySource}
          {parcel.boundaryMeta.attribution ? ` (${parcel.boundaryMeta.attribution})` : ''}
          {parcel.boundaryMeta.medianGpsAccuracyM ? ` · GPS ±${Math.round(parcel.boundaryMeta.medianGpsAccuracyM)} m` : ''}
        </Body>
        {profile?.place.countyName && <Body muted>{profile.place.countyName}</Body>}
        {profile && <Body muted>Profile built {new Date(profile.computedAt).toLocaleString()}</Body>}
        {loading.length > 0 && <Body muted>Fetching: {loading.filter((l) => l !== 'starting').join(', ') || 'starting'}…</Body>}
      </Card>

      <LayerCard title="Elevation" layer={profile?.elevation}>
        {(e) => (
          <Body>
            {formatElevation(e.centroidM, units)} at the centre · {formatElevation(e.minM, units)}–{formatElevation(e.maxM, units)} across
            the parcel ({ft ? `${Math.round(mToFt(e.reliefM))} ft` : `${Math.round(e.reliefM)} m`} of relief in {e.samples} samples)
          </Body>
        )}
      </LayerCard>

      <LayerCard title="Hardiness zone" layer={profile?.hardiness}>
        {(z) => (
          <Body>
            Zone {z.zone}
            {z.rangeF ? ` · average coldest night ${ft ? `${z.rangeF[0]} to ${z.rangeF[1]} °F` : `${Math.round(((z.rangeF[0] - 32) * 5) / 9)} to ${Math.round(((z.rangeF[1] - 32) * 5) / 9)} °C`}` : ''}
          </Body>
        )}
      </LayerCard>

      <LayerCard title="Frost dates (adjusted to your elevation)" layer={profile?.climate}>
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

      <LayerCard title="Soils" layer={profile?.soils}>
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

      <LayerCard title="Flood hazard" layer={profile?.flood}>
        {(f) => <Body>{f.headline}</Body>}
      </LayerCard>

      <LayerCard title="Streams & ponds" layer={profile?.water}>
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
        <Card title="Aerial imagery">
          <Body muted>{profile.imagery.captureNote}</Body>
          <Body muted>{profile.imagery.attribution}</Body>
        </Card>
      )}

      <Button title="Design your land" onPress={() => router.push({ pathname: '/design/[id]', params: { id: parcel.id } })} />
      <Button title="Sun path & sun check" kind="secondary" onPress={() => router.push({ pathname: '/sun/[id]', params: { id: parcel.id } })} />
      <Button title={loading.length ? 'Updating…' : 'Refresh site profile'} onPress={() => compute(parcel, true)} disabled={loading.length > 0} />
      <Button
        title="Delete this property"
        kind="secondary"
        onPress={() =>
          Alert.alert('Delete property?', 'This removes the boundary and profile from this device and marks them deleted on your other devices. Older synced copies stay in your iCloud until you use “Delete all my data”.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: async () => { await deleteParcel(parcel.id); router.replace('/'); } },
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

