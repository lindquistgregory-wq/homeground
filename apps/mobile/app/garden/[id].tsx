/**
 * Bed planner (§7.2): what to grow in one bed. The bed's growing-season sun comes from the shade model
 * (buildings, trees, other beds' tall crops, terrain); soil from SSURGO; slope and frost pockets from
 * the DEM. Plants are ranked with reasons, and each can be laid out to scale with a yield estimate.
 */
import {
  MAX_GRID_CELLS, allPlants, bedGrid, estimateYieldLb, searchPlants, footprintAreaM2, formatArea, layoutBed, plantById, rankPlants, rotationAdvice, type PlantSpec, type Suitability,
} from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/components/Text';
import { useEntitlements } from '../../src/billing/entitlements';
import { BedGridEditor } from '../../src/components/bedGrid';
import { FactGrid, MoreInfo, Pill, SearchField } from '../../src/components/kit';
import { PlantArt } from '../../src/components/PlantArt';
import { Chip, FactorList, LayoutSvg, StaleProfileNotice, VerdictBadge } from '../../src/components/plants';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { deletePlanting, savePlanting, type Planting, type PlantingStatus } from '../../src/db/plantings';
import { computeSun, loadAnalysis, type ParcelAnalysis, type SunResult } from '../../src/services/analysis';
import { activePlantings, bedConditions, bedHistory, bedName, cropShadeObjects, cropShadeSeason, isTreeSpot, plantsForSpot, type BedReport } from '../../src/services/garden';
import { useGarden } from '../../src/services/useGarden';
import { calibratedSunHours } from '@plotwright/core';
import { listSensors } from '../../src/db/sensors';
import { getCalibration, type StoredCalibration } from '../../src/services/sunCalibration';
import { useSettings } from '../../src/services/settings';
import { useCustomPlants } from '../../src/services/customPlants';

const SHARES: Array<[number, string]> = [[1, 'Whole bed'], [0.5, 'Half'], [0.25, 'Quarter']];
const STATUS_NEXT: Record<PlantingStatus, PlantingStatus | null> = { planned: 'planted', planted: 'harvested', harvested: null, removed: null };
const STATUS_ACTION: Record<PlantingStatus, string> = { planned: 'Mark planted', planted: 'Mark harvested', harvested: '', removed: '' };

export default function BedPlanner() {
  const { id, bedId } = useLocalSearchParams<{ id: string; bedId: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const ent = useEntitlements((s) => s.entitlements);
  const { state, error, reload } = useGarden(id);
  // The user's own plants join the list (and re-rank) as soon as they're added or edited.
  const customVersion = useCustomPlants((s) => s.version);
  const [analysis, setAnalysis] = useState<ParcelAnalysis | null>(null);
  const [sun, setSun] = useState<SunResult | null>(null);
  const [sunError, setSunError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [share, setShare] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const year = new Date().getFullYear();

  const bedIndex = state?.design.objects.findIndex((o) => o.id === bedId) ?? -1;
  const bed = bedIndex >= 0 ? state!.design.objects[bedIndex]! : null;
  const name = bed ? bedName(bed, bedIndex) : 'this bed';
  const bedPlantings = useMemo(() => state?.plantings.filter((p) => p.bedObjectId === bedId) ?? [], [state, bedId]);
  // The grid shows this year's crops that are still in the bed.
  const gridPlantings = useMemo(() => bedPlantings.filter((p) => p.year === year && (p.status === 'planned' || p.status === 'planted')), [bedPlantings, year]);

  // Terrain + growing-season sun, with other beds' tall crops shading this one (but not its own).
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    (async () => {
      try {
        const c = state.profile?.climate.status === 'ok' ? state.profile.climate.value.frost.dates : undefined;
        const a = analysis ?? await loadAnalysis(state.parcel.id, state.parcel.geometry, {
          canopy: ent.has('layers.canopyShade'), frost: c ? { lastSpringDoy: c.lastSpring[32][50], firstFallDoy: c.firstFall[32][50] } : undefined,
        });
        if (cancelled) return;
        setAnalysis(a);
        // Let the spinner render before the (synchronous) shade run.
        await new Promise((r) => setTimeout(r, 30));
        const crops = cropShadeObjects(state.design.objects, activePlantings(state.plantings, year), a.frame, bedId);
        const s = computeSun(a, state.design.objects, 'growing', 20, undefined, { objects: crops, ...cropShadeSeason(state.site) });
        if (!cancelled) setSun(s);
      } catch (e) {
        if (!cancelled) setSunError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.parcel.id, state?.design, state?.plantings, bedId, ent]);

  const [lightCal, setLightCal] = useState<{ sensor: string; cal: StoredCalibration } | null>(null);
  useEffect(() => {
    if (!state) return;
    void (async () => {
      for (const s of (await listSensors(state.parcel.id)).filter((x) => x.bedObjectId === bedId)) {
        const c = await getCalibration(s.id);
        if (c && c.clearDays >= 3 && c.ratio !== null) return setLightCal({ sensor: s.name, cal: c });
      }
      setLightCal(null);
    })();
  }, [state, bedId]);

  const cond: BedReport | null = useMemo(() => {
    if (!analysis || !bed) return null;
    const c = bedConditions(analysis, sun, bed, state?.profile);
    if (lightCal && c.sunHours !== undefined) c.sunHours = calibratedSunHours(c.sunHours, lightCal.cal).hours;
    return c;
  }, [analysis, sun, bed, state?.profile, lightCal]);

  const ranked: Suitability[] = useMemo(() => {
    if (!state || !bed || !cond) return [];
    return rankPlants(plantsForSpot(bed, allPlants()), state.site, cond, name);
  }, [state, bed, cond, name, customVersion]);

  if (error) return <Body>{error}</Body>;
  if (!state) return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading bed" />;
  if (!bed) return <Body>This bed is no longer in the design.</Body>;

  const frame = analysis?.frame;
  const areaM2 = frame ? footprintAreaM2(bed, frame) : bed.width * bed.length;
  const bedWidth = Math.min(bed.width, bed.length), bedLength = Math.max(bed.width, bed.length);
  const history = bedHistory(bedPlantings);
  const soilLayer = state.profile?.soils;

  const add = async (plant: PlantSpec) => {
    const rot = rotationAdvice(plant, history, year);
    const go = async () => {
      await savePlanting({ parcelId: state.parcel.id, designId: state.design.id, bedObjectId: bed.id, plantId: plant.id, year, share, status: 'planned' });
      setOpen(null);
      await reload();
    };
    if (!rot.ok && ent.has('planting.successionRotation')) {
      Alert.alert('Rotation', rot.message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Plant anyway', onPress: go }]);
    } else await go();
  };

  const advance = async (p: Planting) => {
    const next = STATUS_NEXT[p.status];
    if (!next) return;
    await savePlanting({ ...p, status: next, plantedOn: next === 'planted' ? new Date().toISOString().slice(0, 10) : p.plantedOn });
    await reload();
  };

  // A search shows every match, so a plant ranked below the top 15 is still easy to find.
  const matchIds = q.trim() ? new Set(searchPlants(q).map((p) => p.id)) : null;
  const visible = matchIds ? ranked.filter((s) => matchIds.has(s.plantId)) : showAll ? ranked : ranked.slice(0, 15);
  // Matches that don't belong in this kind of spot (trees outside a tree spot), so a search never comes up empty without a reason.
  const elsewhere = matchIds ? allPlants().filter((p) => matchIds.has(p.id) && !ranked.some((s) => s.plantId === p.id)) : [];

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }} accessibilityRole="header">{name}</Text>
      <Body muted>{formatArea(areaM2, units)}{cond?.covered ? ' · covered growing space' : ''}</Body>

      {state.profileStale && <StaleProfileNotice parcelId={state.parcel.id} />}
      <Card title="Conditions in this bed" icon="weather-partly-cloudy">
        {!cond ? (
          sunError ? <Body muted>Sun model unavailable: {sunError}</Body> : <ActivityIndicator accessibilityLabel="Modeling sun for this bed" />
        ) : (
          <View>
            <FactGrid items={[
              { icon: 'white-balance-sunny', label: 'Sun (Apr–Sep)', value: cond.sunHours !== undefined ? `${cond.sunHours.toFixed(1)} h a day` : 'Computing…' },
              { icon: 'shovel', label: cond.raised ? 'Ground below' : 'Soil', value: cond.soil?.texture ?? (cond.soil ? 'Mapped' : 'No data') },
              { icon: 'flask-outline', label: 'Soil pH', value: cond.soil?.pH !== undefined ? String(cond.soil.pH) : '—' },
              cond.slopeDeg !== undefined
                ? { icon: 'slope-uphill', label: 'Slope', value: `${cond.slopeDeg.toFixed(0)}°${cond.aspectDeg !== undefined ? ` ${compass(cond.aspectDeg)}` : ''}` }
                : { icon: 'water-outline', label: 'Drainage', value: cond.soil?.drainageClass ?? '—' },
            ]} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {cond.raised && <Pill icon="grid" text="Raised bed" tone="accent" />}
              {cond.covered && <Pill icon="greenhouse" text="Covered" tone="accent" />}
              {lightCal && <Pill icon="white-balance-sunny" text="Sensor-calibrated" tone="accent" />}
              {cond.coldPoolingM !== undefined && cond.coldPoolingM > 1 && <Pill icon="snowflake-alert" text={`Frost pocket (~${cond.coldPoolingM.toFixed(1)} m low)`} tone="warn" />}
            </View>
            <MoreInfo>
              <Body muted>
                Sun is modeled from terrain, mapped buildings and trees{ent.has('layers.canopyShade') ? ', canopy heights' : ''}, your design and other beds’ tall crops (April–September average).
                {lightCal ? ` Calibrated by the light sensor “${lightCal.sensor}” over ${lightCal.cal.clearDays} clear days (×${lightCal.cal.ratio!.toFixed(2)}).` : ' A sun check or a light sensor in the bed confirms it.'}
              </Body>
              {cond.soil ? (
                <Body muted>
                  Soil{cond.raised ? ' under the bed' : ''}: {cond.soilName ?? 'dominant map unit'}{cond.soilPercent !== undefined ? ` (${Math.round(cond.soilPercent)}% of the parcel)` : ''}
                  {[cond.soil.texture, cond.soil.drainageClass, cond.soil.pH !== undefined ? `pH ${cond.soil.pH}` : null].filter(Boolean).length ? ' · ' : ''}
                  {[cond.soil.texture, cond.soil.drainageClass, cond.soil.pH !== undefined ? `pH ${cond.soil.pH}` : null].filter(Boolean).join(' · ')}
                </Body>
              ) : <Body muted>Soil data unavailable for this parcel.</Body>}
              {soilLayer?.status === 'ok' && <Text style={{ color: t.muted, fontSize: 12 }}>{soilLayer.attribution.source}. Soil maps are drawn at field scale; a soil test of this bed is more reliable.</Text>}
              {cond.coldPoolingM !== undefined && cond.coldPoolingM > 1 && <Body muted>Frost pocket: this spot sits ~{cond.coldPoolingM.toFixed(1)} m below its surroundings, so expect later spring frosts than the parcel average.</Body>}
              {cond.raised && <Body muted>Raised or filled bed: drainage and texture come from what you fill it with.</Body>}
              {cond.covered && <Body muted>Covered beds extend the season by a few weeks at each end; the calendar still uses outdoor frost dates.</Body>}
            </MoreInfo>
          </View>
        )}
      </Card>

      <Card title={`In this bed (${year})`} icon="sprout-outline">
        {bedPlantings.length === 0 && <Body muted>Nothing planned yet. Pick a plant below.</Body>}
        {bedPlantings.map((p) => {
          const plant = plantById(p.plantId);
          return (
            <View key={p.id} style={styles.planting}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{plant?.commonName ?? p.plantId}{p.variety ? ` ‘${p.variety}’` : ''}</Text>
                <Body muted>{p.year} · {p.status}{p.plantedOn ? ` ${p.plantedOn}` : ''}{p.share < 1 ? ` · ${Math.round(p.share * 100)}% of the bed` : ''}</Body>
              </View>
              {STATUS_NEXT[p.status] && <Chip label={STATUS_ACTION[p.status]} active={false} onPress={() => advance(p)} />}
              <Chip label="Remove" active={false} onPress={() => Alert.alert('Remove planting?', `Remove ${plant?.commonName ?? 'this planting'} from ${name}? Its rotation history goes with it; mark it harvested instead to keep the history.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: async () => { await deletePlanting(p.id); await reload(); } },
              ])} />
            </View>
          );
        })}
        {bedPlantings.length > 0 && (
          <Button title="Planting calendar" kind="secondary" onPress={() => router.push({ pathname: '/calendar/[id]', params: { id: state.parcel.id } })} />
        )}
      </Card>

      {!isTreeSpot(bed) && gridPlantings.length > 0 && (() => {
        const grid = bedGrid(bed.width, bed.length);
        return (
          <Card title="Bed layout (1 ft squares)" icon="grid">
            {grid.cells > MAX_GRID_CELLS
              ? <Body muted>This bed is {grid.cols} × {grid.rows} ft ({grid.cells} squares), too big to lay out square by square on a phone. Use the row layout under each plant below.</Body>
              : <BedGridEditor grid={grid} plantings={gridPlantings} onSave={async (changes) => {
                  for (const { planting, cells } of changes) await savePlanting({ ...planting, cells });
                  await reload();
                }} />}
          </Card>
        );
      })()}

      <Card title="What grows best here" icon="star-outline">
        {!cond ? <ActivityIndicator /> : (
          <View>
            <Body muted>Ranked for this bed’s sun, soil and slope and your property’s climate.</Body>
            <View style={{ marginTop: 8, marginBottom: 4 }}>
              <SearchField value={q} onChangeText={setQ} placeholder={`Search all ${ranked.length} plants`} accessibilityLabel={`Search all ${ranked.length} plants for this spot`} />
            </View>
            {matchIds && visible.length === 0 && elsewhere.length === 0 && <Body muted>No plants match “{q}”.</Body>}
            {elsewhere.length > 0 && (
              <Body muted>
                {elsewhere.map((p) => p.commonName).join(', ')}: {elsewhere.every((p) => p.kind === 'fruit-tree' || p.kind === 'nut-tree')
                  ? 'trees go in a fruit or nut tree spot. Add one in Design, then plan it from there.'
                  : 'not for this kind of spot (tree spots take only trees; small containers skip plants over 6 ft).'}
              </Body>
            )}
            {visible.map((s) => {
              const plant = plantById(s.plantId)!;
              const isOpen = open === s.plantId;
              return (
                <View key={s.plantId} style={[styles.rank, { borderColor: t.border }]}>
                  <View style={styles.rankHead}>
                    <PlantArt plant={plant} size={40} />
                    <Text onPress={() => setOpen(isOpen ? null : s.plantId)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }} accessibilityHint="Shows reasons, layout and yield" style={{ color: t.text, fontSize: 16, fontWeight: '600', flex: 1 }}>
                      {plant.commonName} {isOpen ? '▾' : '▸'}
                    </Text>
                    <VerdictBadge s={s} />
                  </View>
                  {isOpen && <PlantPanel plant={plant} s={s} bedWidth={bedWidth} bedLength={bedLength} share={share} setShare={setShare} history={history} year={year} onAdd={() => add(plant)} parcelId={state.parcel.id} />}
                </View>
              );
            })}
            {!showAll && !matchIds && ranked.length > 15 && <Button title={`Show all ${ranked.length}`} kind="secondary" onPress={() => setShowAll(true)} />}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

function PlantPanel({ plant, s, bedWidth, bedLength, share, setShare, history, year, onAdd, parcelId }: {
  plant: PlantSpec; s: Suitability; bedWidth: number; bedLength: number; share: number; setShare: (n: number) => void;
  history: ReturnType<typeof bedHistory>; year: number; onAdd: () => void; parcelId: string;
}) {
  const t = useTheme();
  const ent = useEntitlements((st) => st.entitlements);
  const units = useSettings((st) => st.units);
  const perennial = plant.lifecycle === 'perennial';
  const layout = useMemo(() => layoutBed(plant, bedWidth, bedLength, share), [plant, bedWidth, bedLength, share]);
  const yieldLb = estimateYieldLb(plant, layout);
  const rot = rotationAdvice(plant, history, year);
  return (
    <View style={{ marginTop: 6 }}>
      <Body>{s.summary}</Body>
      {ent.has('planting.bedScoring') ? <View style={{ marginTop: 6 }}><FactorList factors={s.factors} /></View> : <Body muted>Grower shows the full factor breakdown.</Body>}
      {ent.has('planting.successionRotation') && !perennial && <Text style={{ color: rot.ok ? t.muted : t.warn, marginTop: 4 }}>Rotation: {rot.message}</Text>}
      {!perennial && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
          {SHARES.map(([v, label]) => <Chip key={v} label={label} active={share === v} onPress={() => setShare(v)} />)}
        </View>
      )}
      <LayoutSvg layout={layout} widthM={bedWidth} lengthM={bedLength} share={share} spreadM={plant.spreadIn * 0.0254} />
      <Body>
        {layout.plantCount} plant{layout.plantCount === 1 ? '' : 's'} · {layout.method === 'square-foot' ? `${plant.perSquareFoot} per square foot` : `${layout.rows} row${layout.rows === 1 ? '' : 's'} of ${layout.perRow}`}
      </Body>
      {ent.has('planting.yieldStorage') && yieldLb && (
        <Body>Typical yield: {units === 'imperial' ? `${Math.round(yieldLb[0])}–${Math.round(yieldLb[1])} lb` : `${Math.round(yieldLb[0] * 0.4536)}–${Math.round(yieldLb[1] * 0.4536)} kg`}{perennial ? ' a year once mature' : ' a season'} (home-garden ranges; varies a lot with care and weather)</Body>
      )}
      <Button title="Add to this bed" onPress={onAdd} disabled={s.verdict === 'not-suitable'} />
      <Button title="Details & calendar" kind="secondary" onPress={() => router.push({ pathname: '/plants/[plantId]', params: { plantId: plant.id, parcelId } })} />
    </View>
  );
}

function compass(deg: number): string {
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8]!;
}

const styles = StyleSheet.create({
  planting: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8, flexWrap: 'wrap' },
  rank: { borderTopWidth: 1, paddingVertical: 10 },
  rankHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
