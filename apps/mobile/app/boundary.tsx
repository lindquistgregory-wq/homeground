/**
 * Step 2 — confirm the boundary (§2.2). Tries the county/state parcel registry first; the user can
 * always draw on imagery, walk the line with GPS, or import a survey file instead.
 * Privacy: only the parcel's geometry, id and acreage are ever requested from county services.
 */
import {
  areaM2, formatArea, normalizeAreal, walkToPolygon, type Areal, type GpsFix, type ImportResult, type Position,
} from '@plotwright/core';
import { findParcel, reverseCensus, type ParcelCandidate } from '@plotwright/providers';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { georeferenceWith, pickBoundaryFile, type CrsChoice } from '../src/boundary/importFile';
import { ParcelMap } from '../src/components/ParcelMap';
import { Body, Button, Card, LEGAL_DISCLAIMER, useTheme } from '../src/components/ui';
import { listUserEndpoints, saveParcel, type BoundaryMeta, type BoundarySource } from '../src/db/parcels';
import { http } from '../src/services/http';
import { useOnboarding } from '../src/services/onboarding';
import { currentRegistry } from '../src/services/registry';
import { useSettings } from '../src/services/settings';

type Mode = 'lookup' | 'draw' | 'walk' | 'georef';

export default function Boundary() {
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const place = useOnboarding((s) => s.place);
  const [mode, setMode] = useState<Mode>('lookup');
  const [status, setStatus] = useState('Looking for a public parcel map for this county…');
  const [candidates, setCandidates] = useState<ParcelCandidate[]>([]);
  const [boundary, setBoundary] = useState<Areal | null>(null);
  const [source, setSource] = useState<BoundarySource>('drawn');
  const [meta, setMeta] = useState<BoundaryMeta>({});
  const [draft, setDraft] = useState<Position[]>([]);
  const [fixes, setFixes] = useState<GpsFix[]>([]);
  const [pendingImport, setPendingImport] = useState<{ fileName: string; result: ImportResult } | null>(null);
  const [utmZone, setUtmZone] = useState('');
  const [name, setName] = useState('My homestead');
  const [county, setCounty] = useState<{ fips?: string; zip?: string }>({});
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!place) return;
    (async () => {
      let fips = place.countyFips, zip = place.zip;
      if (!fips) {
        try {
          const r = await reverseCensus(http, place.lat, place.lon);
          fips = r.countyFips;
          zip = zip ?? r.zcta;
        } catch {
          /* offline: fall through to drawing */
        }
      }
      setCounty({ fips, zip });
      const r = await findParcel(http, await currentRegistry(), fips, place, await listUserEndpoints());
      if (r.candidates[0]) {
        const c = r.candidates[0];
        setCandidates(r.candidates);
        setBoundary(c.geometry);
        setSource('county');
        setMeta({
          endpointId: c.endpointId, parcelId: c.parcelId, publishedAcres: c.publishedAcres, attribution: c.attribution,
          license: c.license, displayOnly: c.displayOnly, retrievedAt: new Date().toISOString(),
        });
        setStatus(`Found a parcel from ${c.attribution}. Is this your land?`);
      } else {
        setStatus(
          r.tried.length
            ? 'The county parcel service did not return a parcel here. Draw your boundary, walk it, or import a survey file.'
            : "We don't have a free parcel map for this county yet. Draw your boundary, walk it, or import a survey file. You can also add your county's GIS link in Settings.",
        );
        setMode('draw');
      }
    })();
    return () => watchRef.current?.remove();
  }, [place]);

  if (!place) return <Body>Start from “Find your property”.</Body>;

  const startWalk = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return Alert.alert('Location needed', 'Allow location access to walk your boundary.');
    setFixes([]);
    setMode('walk');
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 },
      (loc) => setFixes((f) => [...f, { lat: loc.coords.latitude, lon: loc.coords.longitude, accuracyM: loc.coords.accuracy ?? 99, timestamp: loc.timestamp }]),
    );
  };

  const finishWalk = () => {
    watchRef.current?.remove();
    watchRef.current = null;
    const r = walkToPolygon(fixes);
    if (!r.polygon) return Alert.alert('Not enough good GPS points', `Kept ${r.kept}, dropped ${r.dropped} low-accuracy readings. Try again in the open, away from buildings.`);
    setBoundary(r.polygon);
    setSource('walked');
    setMeta({ medianGpsAccuracyM: r.medianAccuracyM ?? undefined, retrievedAt: new Date().toISOString() });
    setMode('lookup');
  };

  const finishDraw = () => {
    if (draft.length < 3) return;
    setBoundary(normalizeAreal({ type: 'Polygon', coordinates: [[...draft, draft[0]!]] }));
    setSource('drawn');
    setMeta({});
    setDraft([]);
    setMode('lookup');
  };

  const importFile = async () => {
    try {
      const picked = await pickBoundaryFile();
      if (!picked) return;
      if (picked.result.needsGeoreference) {
        setPendingImport(picked);
        setMode('georef');
        return;
      }
      setBoundary(picked.result.geometry);
      setSource('imported');
      setMeta({ fileName: picked.fileName });
      if (picked.result.warnings.length) Alert.alert('Check the boundary', picked.result.warnings.join('\n'));
    } catch (e) {
      Alert.alert('Could not import', (e as Error).message);
    }
  };

  const applyCrs = (crs: CrsChoice) => {
    if (!pendingImport) return;
    try {
      setBoundary(georeferenceWith(pendingImport.result, crs));
      setSource('imported');
      setMeta({ fileName: pendingImport.fileName });
      setPendingImport(null);
      setMode('lookup');
    } catch (e) {
      Alert.alert('That coordinate system did not work', (e as Error).message);
    }
  };

  const save = async () => {
    if (!boundary) return;
    const rec = await saveParcel({ name: name.trim() || 'My homestead', geometry: boundary, boundarySource: source, boundaryMeta: meta, countyFips: county.fips, zip: county.zip });
    router.replace({ pathname: '/profile/[id]', params: { id: rec.id } });
  };

  return (
    <View style={styles.screen}>
      <ParcelMap
        style={styles.map}
        center={[place.lon, place.lat]}
        boundary={mode === 'draw' ? null : boundary}
        candidates={candidates.slice(1).map((c) => c.geometry)}
        draft={mode === 'draw' ? draft : mode === 'walk' ? fixes.map((f) => [f.lon, f.lat] as Position) : []}
        onPress={mode === 'draw' ? (lon, lat) => setDraft((d) => [...d, [lon, lat]]) : undefined}
      />
      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 16 }}>
        {mode === 'lookup' && (
          <>
            <Body>{status}</Body>
            {boundary && (
              <Card title="Selected boundary">
                <Body>
                  {formatArea(areaM2(boundary), units)} measured on-device
                  {meta.publishedAcres ? ` · county lists ${meta.publishedAcres} ac` : ''}
                </Body>
                {meta.attribution && <Body muted>Source: {meta.attribution}</Body>}
                <Body muted>{LEGAL_DISCLAIMER}</Body>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  accessibilityLabel="Property name"
                  style={[styles.input, { color: t.text, borderColor: t.border }]}
                />
                <Button title="Use this boundary" onPress={save} />
              </Card>
            )}
            <Button title="Draw on the map" kind="secondary" onPress={() => { setDraft([]); setMode('draw'); }} />
            <Button title="Walk the line with GPS" kind="secondary" onPress={startWalk} />
            <Button title="Import survey file (KML, KMZ, GeoJSON, SHP, GPX, DXF)" kind="secondary" onPress={importFile} />
          </>
        )}
        {mode === 'draw' && (
          <>
            <Body>Tap each corner of your property in order. {draft.length} point{draft.length === 1 ? '' : 's'} so far.</Body>
            <Button title="Finish shape" onPress={finishDraw} disabled={draft.length < 3} />
            <Button title="Undo last point" kind="secondary" onPress={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} />
            <Button title="Cancel" kind="secondary" onPress={() => { setDraft([]); setMode('lookup'); }} />
          </>
        )}
        {mode === 'walk' && (
          <>
            <Body>Walk your boundary and come back to where you started. {fixes.length} GPS readings.</Body>
            <Body muted>Readings less accurate than 15 m are skipped automatically.</Body>
            <Button title="I'm back at the start" onPress={finishWalk} />
          </>
        )}
        {mode === 'georef' && pendingImport && (
          <>
            <Body>
              {pendingImport.fileName} uses projected coordinates{pendingImport.result.crsHint ? ` (${pendingImport.result.crsHint.slice(0, 80)}…)` : ''}. Which coordinate system is it in?
            </Body>
            {pendingImport.result.crsHint && /PROJCS/i.test(pendingImport.result.crsHint) && (
              <Button title="Use the projection in the file" onPress={() => applyCrs({ kind: 'prj' })} />
            )}
            <TextInput
              value={utmZone}
              onChangeText={setUtmZone}
              keyboardType="number-pad"
              placeholder="UTM zone number (e.g. 18)"
              placeholderTextColor={t.muted}
              accessibilityLabel="UTM zone number"
              style={[styles.input, { color: t.text, borderColor: t.border }]}
            />
            <Button title="UTM (metres)" kind="secondary" disabled={!/^\d{1,2}$/.test(utmZone)} onPress={() => applyCrs({ kind: 'utm', zone: Number(utmZone), units: 'm' })} />
            <Body muted>For State Plane drawings, ask your surveyor for the .prj file or the EPSG code.</Body>
            <Button title="Cancel" kind="secondary" onPress={() => { setPendingImport(null); setMode('lookup'); }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1.2 },
  panel: { flex: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, marginVertical: 8 },
});
