/**
 * Design mode (§6): place objects to scale on the parcel over real GIS layers, see live sun/shade,
 * get warnings (boundary, setbacks, slope, overlaps), keep versions, and export.
 */
import { Camera, GeoJSONSource, Layer, Map, RasterSource, type MapRef } from '@maplibre/maplibre-react-native';
import {
  OBJECT_LIBRARY, bbox, estimatePv, footprintAreaM2, footprintLonLat, formatArea, formatLength, materialList, newObject, objectType,
  project, siteSuitability, snapRotationToBoundary, snapToContour, snapToGridM, unproject, validateDesign,
  type Design, type DesignObject, type DesignWarning, type ObjectCategory, type SitingTarget,
} from '@plotwright/core';
import { OPENFREEMAP_STYLE_URL, USGS_HILLSHADE, USGS_IMAGERY, solarClimatology } from '@plotwright/providers';
import { http } from '../../src/services/http';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEntitlements } from '../../src/billing/entitlements';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { getParcel, getSiteProfile, type ParcelRecord } from '../../src/db/parcels';
import { getOrCreateDesign, listVersions, saveDesign, saveVersion } from '../../src/db/designs';
import { kvGet, kvSet } from '../../src/db/database';
import {
  PERIOD_LABELS, computeSun, contourGeoJSON, heatmapGeoJSON, loadAnalysis, sunSummary,
  type ParcelAnalysis, type SunPeriod, type SunResult,
} from '../../src/services/analysis';
import { exportDesign, type ExportFormat } from '../../src/services/export';
import { activePlantings, cropShadeObjects, isPlantable } from '../../src/services/garden';
import { plantingsForParcel, type Planting } from '../../src/db/plantings';
import { newId } from '../../src/services/identity';
import { useSettings } from '../../src/services/settings';

type Tab = 'add' | 'selected' | 'sun' | 'layers' | 'plan';

const CATEGORY_LABEL: Record<ObjectCategory, string> = {
  growing: 'Growing', trees: 'Trees', structure: 'Structures', animals: 'Animals', 'water-soil': 'Water & soil', 'energy-utility': 'Energy & utility',
};

/** Viridis stops: colour-blind safe and readable on imagery. */
const SUN_RAMP = ['interpolate', ['linear'], ['get', 'hours'], 0, '#440154', 3, '#31688e', 6, '#35b779', 9, '#fde725'];
// Hoisted so map layers keep stable props and big GeoJSON sources aren't re-serialised on every render.
const HEAT_PAINT = { 'fill-color': SUN_RAMP, 'fill-opacity': 0.6, 'fill-antialias': false };
const CONTOUR_PAINT = { 'line-color': '#f5e6c8', 'line-width': 0.8, 'line-opacity': 0.8 };
const CAMERA_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

export default function DesignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const ent = useEntitlements((s) => s.entitlements);
  const mapRef = useRef<MapRef | null>(null);

  const [parcel, setParcel] = useState<ParcelRecord | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [analysis, setAnalysis] = useState<ParcelAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [sun, setSun] = useState<SunResult | null>(null);
  const [period, setPeriod] = useState<SunPeriod>('summer');
  const [tab, setTab] = useState<Tab>('add');
  const [placing, setPlacing] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layers, setLayers] = useState({ imagery: true, hillshade: false, contours: false, heatmap: true, siting: false });
  const [contourInterval, setContourInterval] = useState(units === 'imperial' ? 0.6096 : 0.5);
  const [setbackM, setSetbackM] = useState(0);
  const [siting, setSiting] = useState<{ target: SitingTarget; geo: object; factors: string[] } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [plantings, setPlantings] = useState<Planting[]>([]);
  const pendingChange = useRef<DesignObject[]>([]);
  const sunRef = useRef<SunResult | null>(null);

  // ---------- load ----------
  useEffect(() => {
    (async () => {
      const p = await getParcel(id);
      if (!p) return;
      setParcel(p);
      setDesign(await getOrCreateDesign(p.id));
      setSetbackM(Number((await kvGet(`setback.${p.id}`)) ?? 0));
      const profile = await getSiteProfile(p.id);
      const frost = profile?.climate.status === 'ok'
        ? { lastSpringDoy: profile.climate.value.frost.dates.lastSpring[32][50], firstFallDoy: profile.climate.value.frost.dates.firstFall[32][50] }
        : undefined;
      try {
        setAnalysis(await loadAnalysis(p.id, p.geometry, { canopy: ent.has('layers.canopyShade'), frost }));
      } catch (e) {
        setAnalysisError((e as Error).message);
      }
    })();
  }, [id, ent]);

  // Plantings change in the bed planner; reload them whenever this screen regains focus.
  useFocusEffect(
    useCallback(() => {
      void plantingsForParcel(id).then((ps) => setPlantings(activePlantings(ps, new Date().getFullYear())));
    }, [id]),
  );

  // ---------- sun (debounced, incremental when possible) ----------
  useEffect(() => {
    if (!analysis || !design) return;
    const handle = setTimeout(() => {
      // Tall crops this season (corn, pole beans, sunflowers) shade their neighbours like foliage.
      const crops = cropShadeObjects(design.objects, plantings, analysis.frame);
      // A moved bed moves its crop too: include the crop shapes at both the old and new position.
      const changed = pendingChange.current.flatMap((o) => [o, ...cropShadeObjects([o], plantings, analysis.frame)]);
      pendingChange.current = [];
      const prev = sunRef.current;
      const next = computeSun(analysis, [...design.objects, ...crops], period, 15, prev && changed.length ? { prev, changed } : undefined);
      sunRef.current = next;
      setSun(next);
    }, 250);
    return () => clearTimeout(handle);
  }, [analysis, design, period, plantings]);

  const frame = analysis?.frame;
  const selected = design?.objects.find((o) => o.id === selectedId) ?? null;

  const update = useCallback(
    (objects: DesignObject[], changed: DesignObject[]) => {
      if (!design) return;
      pendingChange.current.push(...changed);
      const next = { ...design, objects };
      setDesign(next);
      void saveDesign(next);
    },
    [design],
  );

  const replaceSelected = (patch: Partial<DesignObject>) => {
    if (!design || !selected) return;
    const nextObj = { ...selected, ...patch };
    update(design.objects.map((o) => (o.id === selected.id ? nextObj : o)), [selected, nextObj]);
  };

  // ---------- map interaction ----------
  const onMapPress = (lon: number, lat: number) => {
    if (!design || !frame) return;
    const snapped = snapToGridM(frame, [lon, lat], 0.25);
    if (placing) {
      if (design.objects.filter((o) => !o.existing).length >= ent.limits.designObjects) {
        Alert.alert('Object limit reached', `Your plan allows ${ent.limits.designObjects} objects. Upgrade for unlimited objects.`);
        return;
      }
      let o = newObject(placing, { lon: snapped[0], lat: snapped[1] }, newId());
      if (o.shape === 'line') {
        const [x, y] = project(frame, o.center);
        o.path = [unproject(frame, [x - o.length / 2, y]) as [number, number], unproject(frame, [x + o.length / 2, y]) as [number, number]];
        if (objectType(o.kind)?.followsContour && ent.has('layers.advancedTerrain') && analysis?.terrain.status === 'ok') o = snapToContour(o, analysis.ground, frame);
      }
      update([...design.objects, o], [o]);
      setSelectedId(o.id);
      setPlacing(null);
      setTab('selected');
      return;
    }
    if (moving && selected) {
      const dx = snapped[0] - selected.center[0], dy = snapped[1] - selected.center[1];
      replaceSelected({
        center: snapped,
        path: selected.path?.map(([a, b]) => [a + dx, b + dy] as [number, number]),
        polygon: selected.polygon?.map(([a, b]) => [a + dx, b + dy] as [number, number]),
      });
      setMoving(false);
      return;
    }
    setSelectedId(null);
  };

  const detectBuildings = async () => {
    if (!design || !mapRef.current) return;
    try {
      const feats = await mapRef.current.queryRenderedFeatures({ layers: ['building', 'building-3d'] });
      const added: DesignObject[] = [];
      for (const f of feats) {
        const g = f.geometry as { type: string; coordinates: number[][][] };
        if (g?.type !== 'Polygon') continue;
        const ring = g.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]);
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        if (design.objects.some((o) => o.existing && Math.abs(o.center[0] - cx) < 1e-5 && Math.abs(o.center[1] - cy) < 1e-5)) continue;
        const props = (f.properties ?? {}) as { render_height?: number; height?: number };
        const o = newObject('building', { lon: cx, lat: cy }, newId());
        o.polygon = ring;
        o.existing = true;
        o.height = Number(props.render_height ?? props.height ?? 6) || 6;
        added.push(o);
      }
      if (!added.length) return Alert.alert('No buildings found', 'OpenStreetMap has no building outlines in view here. You can add an "Existing building" from the library instead.');
      update([...design.objects, ...added], added);
      Alert.alert('Buildings added', `${added.length} building outline${added.length > 1 ? 's' : ''} from OpenStreetMap. Heights are estimates; tap one to correct it.`);
    } catch (e) {
      Alert.alert('Could not read buildings', (e as Error).message);
    }
  };

  // ---------- derived layers ----------
  const objectsGeo = useMemo(() => {
    if (!design || !frame) return null;
    return {
      type: 'FeatureCollection' as const,
      features: design.objects.map((o) => ({
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [footprintLonLat(o, frame)] },
        properties: { id: o.id, selected: o.id === selectedId ? 1 : 0, existing: o.existing ? 1 : 0, label: o.label ?? objectType(o.kind)?.name ?? o.kind },
      })),
    };
  }, [design, frame, selectedId]);

  const heatGeo = useMemo(() => (analysis && sun && ent.has('sun.heatmaps') ? heatmapGeoJSON(analysis, sun.hours) : null), [analysis, sun, ent]);
  const [contourGeo, setContourGeo] = useState<ReturnType<typeof contourGeoJSON> | null>(null);
  useEffect(() => {
    if (!analysis || !layers.contours || analysis.terrain.status !== 'ok') return setContourGeo(null);
    const h = setTimeout(() => setContourGeo(contourGeoJSON(analysis, contourInterval)), 30); // let the toggle render first
    return () => clearTimeout(h);
  }, [analysis, layers.contours, contourInterval]);
  const warnings: DesignWarning[] = useMemo(
    () => (design && frame && parcel ? validateDesign(design.objects.filter((o) => !o.existing), { boundary: parcel.geometry, setbackM, slope: analysis?.slope, maxStructureSlopeDeg: 10, units }, frame) : []),
    [design, frame, parcel, setbackM, analysis, units],
  );
  const summary = analysis && sun ? sunSummary(analysis, sun.hours) : null;

  const runSiting = (target: SitingTarget) => {
    if (!analysis || !design) return;
    const winter = computeSun(analysis, design.objects, 'winter');
    const summer = computeSun(analysis, design.objects, 'summer');
    // Cold-air drainage is a Homestead Pro terrain layer (§10); lower tiers score without it.
    const pooling = ent.has('layers.advancedTerrain') ? analysis.pooling : undefined;
    const r = siteSuitability(target, { winterSun: winter.hours, summerSun: summer.hours, slope: analysis.slope, pooling, parcelMask: analysis.maskGrid });
    const renamed = { ...r.score, data: r.score.data.map((v) => v * 10) }; // reuse the 0–10 heat builder
    const geo = heatmapGeoJSON(analysis, renamed as typeof r.score);
    setSiting({ target, geo, factors: r.factors });
    setLayers((l) => ({ ...l, siting: true, heatmap: false }));
  };

  const doExport = async (fmt: ExportFormat) => {
    if (!design || !parcel || !frame) return;
    const need = fmt === 'pdf' ? 'export.pdf' : 'export.gis';
    if (!ent.has(need)) return Alert.alert('Upgrade needed', fmt === 'pdf' ? 'PDF export is part of Grower and Homestead Pro.' : 'GIS exports are part of Homestead Pro.');
    try {
      await exportDesign(fmt, { design, boundary: parcel.geometry, frame, units, parcelName: parcel.name, boundaryDisplayOnly: !!parcel.boundaryMeta.displayOnly });
    } catch (e) {
      Alert.alert('Export failed', (e as Error).message);
    }
  };

  if (!parcel || !design) return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading design" />;
  const b = bbox(parcel.geometry);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.map}>
        <Map
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={OPENFREEMAP_STYLE_URL}
          attribution
          onPress={(e) => onMapPress(e.nativeEvent.lngLat[0], e.nativeEvent.lngLat[1])}
        >
          <Camera initialViewState={{ bounds: [b[0], b[1], b[2], b[3]], padding: CAMERA_PADDING }} />
          {layers.imagery && (
            <RasterSource id="img" tiles={USGS_IMAGERY.tiles} tileSize={256} maxzoom={USGS_IMAGERY.maxzoom} attribution={USGS_IMAGERY.attribution}>
              <Layer type="raster" id="img-l" />
            </RasterSource>
          )}
          {layers.hillshade && ent.has('layers.standard') && (
            <RasterSource id="hs" tiles={USGS_HILLSHADE.tiles} tileSize={256} maxzoom={USGS_HILLSHADE.maxzoom} attribution={USGS_HILLSHADE.attribution}>
              <Layer type="raster" id="hs-l" paint={{ 'raster-opacity': 0.45 }} />
            </RasterSource>
          )}
          {layers.heatmap && heatGeo && (
            <GeoJSONSource id="heat" data={heatGeo}>
              <Layer type="fill" id="heat-l" paint={HEAT_PAINT} />
            </GeoJSONSource>
          )}
          {layers.siting && siting && (
            <GeoJSONSource id="siting" data={siting.geo}>
              <Layer type="fill" id="siting-l" paint={HEAT_PAINT} />
            </GeoJSONSource>
          )}
          {contourGeo && ent.has('layers.standard') && (
            <GeoJSONSource id="contours" data={contourGeo}>
              <Layer type="line" id="contours-l" paint={CONTOUR_PAINT} />
            </GeoJSONSource>
          )}
          <GeoJSONSource id="parcel" data={{ type: 'Feature', geometry: parcel.geometry, properties: {} }}>
            <Layer type="line" id="parcel-l" paint={{ 'line-color': '#f2c14e', 'line-width': 3 }} />
          </GeoJSONSource>
          {objectsGeo && (
            <GeoJSONSource
              id="objects"
              data={objectsGeo}
              hitbox={{ top: 8, right: 8, bottom: 8, left: 8 }}
              onPress={(e) => {
                if (placing || moving) return; // let the map handle placement taps
                e.stopPropagation(); // otherwise the Map's onPress deselects straight away
                const fid = e.nativeEvent.features[0]?.properties?.id;
                if (typeof fid === 'string') {
                  setSelectedId(fid);
                  setTab('selected');
                }
              }}
            >
              <Layer type="fill" id="obj-fill" paint={{ 'fill-color': ['case', ['==', ['get', 'existing'], 1], '#9e9e9e', '#ffffff'], 'fill-opacity': 0.35 }} />
              <Layer type="line" id="obj-line" paint={{ 'line-color': ['case', ['==', ['get', 'selected'], 1], '#4ea8f2', '#ffffff'], 'line-width': ['case', ['==', ['get', 'selected'], 1], 3, 1.5] }} />
            </GeoJSONSource>
          )}
        </Map>
        {(placing || moving) && (
          <View style={[styles.banner, { backgroundColor: t.card }]}>
            <Text style={{ color: t.text }}>{placing ? `Tap the map to place: ${objectType(placing)?.name}` : 'Tap the new spot'}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setPlacing(null); setMoving(false); }}><Text style={{ color: t.accent }}>Cancel</Text></Pressable>
          </View>
        )}
        {!analysis && !analysisError && (
          <View style={[styles.banner, { backgroundColor: t.card, top: undefined, bottom: 8 }]}>
            <ActivityIndicator /><Text style={{ color: t.text, marginLeft: 8 }}>Loading terrain{ent.has('layers.canopyShade') ? ' and tree heights' : ''}…</Text>
          </View>
        )}
      </View>

      <View style={[styles.tabs, { borderColor: t.border }]}>
        {(['add', 'selected', 'sun', 'layers', 'plan'] as Tab[]).map((k) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} style={[styles.tab, tab === k && { borderBottomColor: t.accent }]}>
            <Text style={{ color: tab === k ? t.accent : t.muted, fontWeight: '600' }}>{k === 'add' ? 'Add' : k === 'selected' ? 'Edit' : k === 'sun' ? 'Sun' : k === 'layers' ? 'Layers' : 'Plan'}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        {analysisError && <Body muted>Terrain couldn't load ({analysisError}). Shade is computed on flat ground until it does.</Body>}

        {tab === 'add' && (
          <>
            <Button title="Browse object library" onPress={() => setLibraryOpen(true)} />
            <Button title="Add existing buildings from the map" kind="secondary" onPress={detectBuildings} />
            <Body muted>{design.objects.filter((o) => !o.existing).length} of {Number.isFinite(ent.limits.designObjects) ? ent.limits.designObjects : 'unlimited'} objects used.</Body>
          </>
        )}

        {tab === 'selected' && (selected ? (
          <SelectedPanel
            key={selected.id}
            o={selected}
            units={units}
            areaM2={frame ? footprintAreaM2(selected, frame) : 0}
            onPatch={replaceSelected}
            onMove={() => setMoving(true)}
            onSnapAngle={() => frame && replaceSelected({ rotationDeg: snapRotationToBoundary(selected.rotationDeg, parcel.geometry, frame) })}
            onSnapContour={objectType(selected.kind)?.followsContour && ent.has('layers.advancedTerrain') && analysis?.terrain.status === 'ok' && frame ? () => replaceSelected(snapToContour(selected, analysis.ground, frame)) : undefined}
            onDelete={() => { update(design.objects.filter((o) => o.id !== selected.id), [selected]); setSelectedId(null); }}
            onPlan={isPlantable(selected) ? () => router.push({ pathname: '/garden/[id]', params: { id: parcel.id, bedId: selected.id } }) : undefined}
            planted={plantings.filter((p) => p.bedObjectId === selected.id).length}
          />
        ) : <Body muted>Tap an object on the map to edit it.</Body>)}

        {tab === 'sun' && (
          <>
            <View style={styles.row}>
              {(Object.keys(PERIOD_LABELS) as SunPeriod[]).map((p) => {
                const locked = p === 'growing' && !ent.has('sun.heatmaps');
                return (
                  <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: period === p, disabled: locked }} disabled={locked} onPress={() => setPeriod(p)}
                    style={[styles.chip, { borderColor: period === p ? t.accent : t.border, opacity: locked ? 0.4 : 1 }]}>
                    <Text style={{ color: period === p ? t.accent : t.text }}>{PERIOD_LABELS[p]}{locked ? ' 🔒' : ''}</Text>
                  </Pressable>
                );
              })}
            </View>
            {summary && sun && (
              <Card title={`Direct sun, ${PERIOD_LABELS[period]}`}>
                <Body>Full sun (6 h+): {formatArea(summary.full * summary.cellAreaM2, units)}</Body>
                <Body>Part sun (3–6 h): {formatArea(summary.part * summary.cellAreaM2, units)}</Body>
                <Body>Shade (under 3 h): {formatArea(summary.shade * summary.cellAreaM2, units)}</Body>
                <Body muted>At most {sun.possibleHours.toFixed(1)} h of sun above your horizon that day. Grid {analysis!.ground.cell.toFixed(1)} m · computed in {sun.ms} ms ({sun.engine === 'native' ? 'native engine' : 'JavaScript engine'}).</Body>
                {!ent.has('sun.heatmaps') && <Body muted>Sun-hour heatmaps on the map are part of Grower and Homestead Pro.</Body>}
                {!ent.has('layers.canopyShade') && <Body muted>Tree shade from satellite canopy heights is part of Homestead Pro. Trees you place yourself always cast shade.</Body>}
              </Card>
            )}
            <Legend />
            <Button title="Sun path & sun check" kind="secondary" onPress={() => router.push({ pathname: '/sun/[id]', params: { id: parcel.id } })} />
            <Card title="Best spot for…">
              <View style={styles.row}>
                {(['greenhouse', 'garden', 'orchard', 'coop', 'solar'] as SitingTarget[]).map((k) => (
                  <Pressable key={k} accessibilityRole="button" disabled={!analysis || !ent.has('sun.heatmaps')} onPress={() => runSiting(k)} style={[styles.chip, { borderColor: siting?.target === k ? t.accent : t.border }]}>
                    <Text style={{ color: t.text }}>{k}</Text>
                  </Pressable>
                ))}
              </View>
              {siting ? <Body muted>Yellow = best. Based on: {siting.factors.join(', ')}.</Body> : <Body muted>Shows where on your land a new object would do best.{!ent.has('sun.heatmaps') ? ' (Grower and up.)' : ''}</Body>}
            </Card>
          </>
        )}

        {tab === 'layers' && (
          <>
            {([
              ['imagery', 'Aerial imagery', 'layers.core'], ['hillshade', 'Hillshade', 'layers.standard'], ['contours', 'Contour lines', 'layers.standard'],
              ['heatmap', 'Sun-hours heatmap', 'sun.heatmaps'], ['siting', 'Siting suitability', 'sun.heatmaps'],
            ] as Array<[keyof typeof layers, string, Parameters<typeof ent.has>[0]]>).map(([k, label, feature]) => {
              const locked = !ent.has(feature);
              return (
                <Button key={k} title={`${layers[k] && !locked ? '✓ ' : ''}${label}${locked ? ' 🔒' : ''}`} kind={layers[k] && !locked ? 'primary' : 'secondary'} disabled={locked}
                  onPress={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} />
              );
            })}
            {contourGeo && Math.abs(contourGeo.intervalM - contourInterval) > 1e-6 && (
              <Body muted>Contour interval widened to {formatLength(contourGeo.intervalM, units)} so the map stays responsive on this much relief.</Body>
            )}
            {layers.contours && (
              <View style={styles.row}>
                {(units === 'imperial' ? [[0.3048, '1 ft'], [0.6096, '2 ft'], [1.524, '5 ft']] : [[0.25, '0.25 m'], [0.5, '0.5 m'], [1, '1 m']]).map(([v, l]) => (
                  <Pressable key={String(l)} onPress={() => setContourInterval(v as number)} style={[styles.chip, { borderColor: contourInterval === v ? t.accent : t.border }]}>
                    <Text style={{ color: t.text }}>{l}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {analysis?.terrain.status === 'ok' && <Body muted>Terrain: {analysis.terrain.attribution.resolution}. {analysis.canopy?.status === 'ok' ? 'Tree heights: Meta & WRI Canopy Height Maps v2 (CC BY 4.0).' : ''}</Body>}
          </>
        )}

        {tab === 'plan' && (
          <PlanPanel
            design={design}
            warnings={warnings}
            units={units}
            setbackM={setbackM}
            onSetback={(m) => { setSetbackM(m); void kvSet(`setback.${parcel.id}`, String(m)); }}
            materials={frame ? materialList(design.objects.filter((o) => !o.existing), frame) : []}
            canVersion={ent.has('design.versions')}
            onRestore={(objects) => update(objects, [...design.objects, ...objects])}
            onExport={doExport}
          />
        )}
      </ScrollView>

      <Modal visible={libraryOpen} animationType="slide" onRequestClose={() => setLibraryOpen(false)}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 48, backgroundColor: t.bg }}>
          <Button title="Close" kind="secondary" onPress={() => setLibraryOpen(false)} />
          {(Object.keys(CATEGORY_LABEL) as ObjectCategory[]).map((cat) => (
            <Card key={cat} title={CATEGORY_LABEL[cat]}>
              {OBJECT_LIBRARY.filter((o) => o.category === cat).map((o) => {
                const locked = o.tier === 'grower' && !ent.has('design.fullLibrary');
                return (
                  <Pressable key={o.kind} accessibilityRole="button" accessibilityState={{ disabled: locked }} disabled={locked}
                    onPress={() => { setPlacing(o.kind); setLibraryOpen(false); }} style={[styles.libItem, { borderColor: t.border, opacity: locked ? 0.45 : 1 }]}>
                    <Text style={{ color: t.text, fontSize: 15 }}>{o.name}{locked ? ' 🔒' : ''}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>
                      {o.shape === 'circle' ? `⌀ ${formatLength(o.width, units)}` : o.shape === 'line' ? formatLength(o.length, units) : `${formatLength(o.width, units)} × ${formatLength(o.length, units)}`}
                      {o.height > 0.5 ? ` · ${formatLength(o.height, units)} tall` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </Card>
          ))}
        </ScrollView>
      </Modal>
    </View>
  );
}

function Legend() {
  const t = useTheme();
  return (
    <View style={[styles.row, { alignItems: 'center', marginVertical: 6 }]} accessibilityLabel="Heatmap legend: dark purple 0 hours, blue 3 hours, green 6 hours, yellow 9 or more hours">
      {[['#440154', '0 h'], ['#31688e', '3 h'], ['#35b779', '6 h'], ['#fde725', '9 h+']].map(([c, l]) => (
        <View key={l} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <View style={{ width: 16, height: 16, backgroundColor: c, marginRight: 4, borderRadius: 3 }} />
          <Text style={{ color: t.text }}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

function Stepper({ label, value, step, min, units, onChange }: { label: string; value: number; step: number; min: number; units: 'imperial' | 'metric'; onChange: (v: number) => void }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
      <Text style={{ color: t.text, flex: 1 }}>{label}: {formatLength(value, units)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} onPress={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} style={[styles.stepBtn, { borderColor: t.border }]}><Text style={{ color: t.text, fontSize: 18 }}>−</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} onPress={() => onChange(Math.round((value + step) * 100) / 100)} style={[styles.stepBtn, { borderColor: t.border }]}><Text style={{ color: t.text, fontSize: 18 }}>+</Text></Pressable>
    </View>
  );
}

function SelectedPanel({ o, units, areaM2, onPatch, onMove, onSnapAngle, onSnapContour, onDelete, onPlan, planted }: {
  o: DesignObject; units: 'imperial' | 'metric'; areaM2: number; onPatch: (p: Partial<DesignObject>) => void;
  onMove: () => void; onSnapAngle: () => void; onSnapContour?: () => void; onDelete: () => void; onPlan?: () => void; planted: number;
}) {
  const t = useTheme();
  const type = objectType(o.kind);
  const step = units === 'imperial' ? 0.3048 : 0.25;
  return (
    <Card title={o.label ?? type?.name ?? o.kind}>
      <Body muted>{formatArea(areaM2, units)}{o.existing ? ' · existing feature from map data' : ''}{planted ? ` · ${planted} planting${planted === 1 ? '' : 's'} this year` : ''}</Body>
      {onPlan && <Button title="Plan this bed: what grows best here" onPress={onPlan} />}
      {!o.polygon && o.shape === 'rect' && <Stepper label="Length" value={o.length} step={step} min={0.3} units={units} onChange={(v) => onPatch({ length: v })} />}
      {!o.polygon && <Stepper label={o.shape === 'circle' ? 'Diameter' : 'Width'} value={o.width} step={step} min={0.1} units={units} onChange={(v) => onPatch(o.shape === 'circle' ? { width: v, length: v } : { width: v })} />}
      <Stepper label="Height" value={o.height} step={step} min={0} units={units} onChange={(v) => onPatch({ height: v })} />
      {!o.polygon && o.shape === 'rect' && (
        <View style={styles.row}>
          <Button title="⟲ 15°" kind="secondary" onPress={() => onPatch({ rotationDeg: (o.rotationDeg + 345) % 360 })} />
          <Button title="⟳ 15°" kind="secondary" onPress={() => onPatch({ rotationDeg: (o.rotationDeg + 15) % 360 })} />
          <Button title="Align to boundary" kind="secondary" onPress={onSnapAngle} />
        </View>
      )}
      {onSnapContour && <Button title="Snap to contour" kind="secondary" onPress={onSnapContour} />}
      <TextInput
        defaultValue={o.label ?? ''}
        placeholder="Label (e.g. Bed 3)"
        placeholderTextColor={t.muted}
        onEndEditing={(e) => onPatch({ label: e.nativeEvent.text || undefined })}
        accessibilityLabel="Object label"
        style={[styles.input, { color: t.text, borderColor: t.border }]}
      />
      <TextInput
        defaultValue={o.costUsd !== undefined ? String(o.costUsd) : ''}
        placeholder="Your cost estimate (USD)"
        placeholderTextColor={t.muted}
        keyboardType="decimal-pad"
        onEndEditing={(e) => { const v = Number(e.nativeEvent.text); onPatch({ costUsd: e.nativeEvent.text && Number.isFinite(v) ? v : undefined }); }}
        accessibilityLabel="Cost estimate in US dollars"
        style={[styles.input, { color: t.text, borderColor: t.border }]}
      />
      <Button title="Move (tap new spot)" kind="secondary" onPress={onMove} />
      <Button title="Delete" kind="secondary" onPress={onDelete} />
      {type?.notes && <Body muted>{type.notes}</Body>}
      {o.kind === 'solar-array' && <PvCard o={o} areaM2={areaM2} onPatch={onPatch} />}
    </Card>
  );
}

/** On-device solar estimate (§5.6): NASA POWER monthly GHI + tilt/azimuth + standard losses. No PV API. */
function PvCard({ o, areaM2, onPatch }: { o: DesignObject; areaM2: number; onPatch: (p: Partial<DesignObject>) => void }) {
  const ent = useEntitlements((s) => s.entitlements);
  const [res, setRes] = useState<Awaited<ReturnType<typeof solarClimatology>> | null>(null);
  const [tilt, setTilt] = useState(Math.round(Math.abs(o.center[1])));
  const [lat, lon] = [o.center[1], o.center[0]];
  const pro = ent.has('sun.pvEstimate');
  useEffect(() => {
    if (pro) void solarClimatology(http, { lat, lon }).then(setRes);
  }, [lat, lon, pro]);
  if (!pro) return <Body muted>Solar output estimates are part of Homestead Pro.</Body>;
  if (!res) return <ActivityIndicator accessibilityLabel="Loading solar data" />;
  if (res.status !== 'ok') return <Body muted>{res.reason}</Body>;
  const kw = Math.round(areaM2 * 0.2 * 10) / 10; // ~200 W per m² of modern panels
  // Panels face across the array's long axis; keep facing and rotation in step.
  const facing = o.facingDeg ?? (((o.rotationDeg + 90) % 360) + 360) % 360;
  const turn = (delta: number) => { const f = (((facing + delta) % 360) + 360) % 360; onPatch({ facingDeg: f, rotationDeg: (f + 270) % 360 }); };
  const est = estimatePv(lat, res.value, kw, tilt, facing);
  return (
    <View style={{ marginTop: 8 }}>
      <Body>≈ {Math.round(est.annualKWh).toLocaleString()} kWh per year from ~{kw} kW</Body>
      <View style={styles.row}>
        <Button title={`Tilt ${tilt}° −`} kind="secondary" onPress={() => setTilt((x) => Math.max(0, x - 5))} />
        <Button title="+" kind="secondary" onPress={() => setTilt((x) => Math.min(90, x + 5))} />
      </View>
      <View style={styles.row}>
        <Button title="Face ⟲ 15°" kind="secondary" onPress={() => turn(-15)} />
        <Button title="Face ⟳ 15°" kind="secondary" onPress={() => turn(15)} />
      </View>
      <Body muted>Facing {Math.round(facing)}° ({facing > 135 && facing < 225 ? 'south-ish, good' : 'not south'}). {est.notes.join(' ')}</Body>
      <Body muted>Source: {res.attribution.source}. Shade from your plan isn't subtracted yet.</Body>
    </View>
  );
}

function PlanPanel({ design, warnings, units, setbackM, onSetback, materials, canVersion, onRestore, onExport }: {
  design: Design; warnings: DesignWarning[]; units: 'imperial' | 'metric'; setbackM: number; onSetback: (m: number) => void;
  materials: ReturnType<typeof materialList>; canVersion: boolean; onRestore: (objects: DesignObject[]) => void; onExport: (f: ExportFormat) => void;
}) {
  const t = useTheme();
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof listVersions>>>([]);
  useEffect(() => { void listVersions(design.id).then(setVersions); }, [design.id]);
  const ftStep = units === 'imperial' ? 0.3048 * 5 : 1;
  return (
    <>
      <Card title={`Warnings (${warnings.length})`}>
        {warnings.length === 0 ? <Body muted>No problems found.</Body> : warnings.map((w, i) => <Body key={i}>• {w.message}</Body>)}
        <Stepper label="Setback from property line" value={setbackM} step={ftStep} min={0} units={units} onChange={onSetback} />
        <Body muted>Enter your county's setback. Check rules and have lines surveyed before building.</Body>
      </Card>
      <Card title="Materials & costs">
        {materials.length === 0 ? <Body muted>Nothing placed yet.</Body> : materials.map((m, i) => (
          <Body key={i}>{m.count} × {m.name}{m.areaM2 ? ` · ${formatArea(m.areaM2, units)}` : ''}{m.costUsd ? ` · $${m.costUsd.toLocaleString()}` : ''}</Body>
        ))}
      </Card>
      <Card title="Versions">
        {!canVersion ? <Body muted>Saving versions is part of Grower and Homestead Pro.</Body> : (
          <>
            <Button title="Save this version" kind="secondary" onPress={async () => { await saveVersion(design, new Date().toLocaleString()); setVersions(await listVersions(design.id)); }} />
            {versions.map((v) => (
              <Pressable key={v.id} accessibilityRole="button" onPress={() => Alert.alert('Restore this version?', v.label, [{ text: 'Cancel', style: 'cancel' }, { text: 'Restore', onPress: () => onRestore(v.objects) }])}>
                <Text style={{ color: t.accent, paddingVertical: 8 }}>{v.label} · {v.objects.length} objects</Text>
              </Pressable>
            ))}
          </>
        )}
      </Card>
      <Card title="Export">
        <Button title="PDF plan (to scale)" kind="secondary" onPress={() => onExport('pdf')} />
        <Button title="GeoJSON" kind="secondary" onPress={() => onExport('geojson')} />
        <Button title="KML (Google Earth)" kind="secondary" onPress={() => onExport('kml')} />
        <Button title="DXF (CAD)" kind="secondary" onPress={() => onExport('dxf')} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  map: { height: '48%' },
  banner: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderRadius: 10 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  libItem: { paddingVertical: 10, borderBottomWidth: 1 },
  stepBtn: { width: 48, height: 48, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, marginVertical: 6 },
});
