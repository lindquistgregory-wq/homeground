/**
 * Planting calendar (§7.3) for everything planned or planted on a property this year: the next six
 * weeks of tasks, the whole season month by month, and frost/heat/wind alerts from the NWS forecast
 * for crops already in the ground.
 */
import { formatDoy, plantById, upcomingTasks, type PlantCalendar } from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useEntitlements } from '../../src/billing/entitlements';
import { Chip, StaleProfileNotice } from '../../src/components/plants';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { alertsEnabled, alertsForParcel, type ParcelAlerts } from '../../src/services/alerts';
import { activePlantings, bedName, calendarFor } from '../../src/services/garden';
import { useGarden } from '../../src/services/useGarden';
import { dominantSoil } from '../../src/services/garden';
import { frostOffset, measuredGdd, waterAdvice, type FrostOffset, type WaterAdvice } from '../../src/services/sensorInsights';
import { latestValues, listSensors } from '../../src/db/sensors';
import type { SiteProfile } from '@plotwright/providers';
import { useSettings } from '../../src/services/settings';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (doy: number) => new Date(Date.UTC(2023, 0, doy)).getUTCMonth();
const todayDoy = () => {
  const n = new Date();
  return Math.floor((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(n.getFullYear(), 0, 0)) / 86_400_000);
};

export default function CalendarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const ent = useEntitlements((s) => s.entitlements);
  const { state, error } = useGarden(id);
  const [risk, setRisk] = useState<'cautious' | 'typical'>('cautious');
  const [dynamic, setDynamic] = useState(false);
  const [alerts, setAlerts] = useState<ParcelAlerts | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [notifyOn, setNotifyOn] = useState<boolean | null>(null);
  const year = new Date().getFullYear();

  const active = useMemo(() => (state ? activePlantings(state.plantings, year) : []), [state, year]);
  const cals = useMemo(() => {
    if (!state) return [] as Array<PlantCalendar & { beds: string[] }>;
    const byPlant = new Map<string, string[]>();
    for (const p of active) {
      const i = state.design.objects.findIndex((o) => o.id === p.bedObjectId);
      const name = i >= 0 ? bedName(state.design.objects[i]!, i) : 'removed bed';
      byPlant.set(p.plantId, [...(byPlant.get(p.plantId) ?? []), name]);
    }
    const out: Array<PlantCalendar & { beds: string[] }> = [];
    for (const [plantId, beds] of byPlant) {
      const plant = plantById(plantId);
      const cal = plant && calendarFor(plant, state.site, { risk, dynamicGdd: dynamic && ent.has('planting.dynamicScheduling'), soilF: state.soil.soilF, soilLabel: state.soil.basisLabel });
      if (cal) out.push({ ...cal, beds });
    }
    return out;
  }, [state, active, risk, dynamic, ent]);

  useEffect(() => {
    if (!state?.profile) return;
    void alertsEnabled().then(setNotifyOn);
    const c = state.profile.centroid;
    alertsForParcel(state.parcel.id, state.parcel.name, c.lat, c.lon).then(setAlerts).catch((e: Error) => setAlertsError(e.message));
  }, [state]);

  if (error) return <Body>{error}</Body>;
  if (!state) return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading calendar" />;

  const today = todayDoy();
  const soon = upcomingTasks(cals, today, Math.min(365, today + 42));
  const byMonth = new Map<number, Array<{ plantId: string; label: string; start: number; end: number }>>();
  for (const c of cals) for (const e of c.events) {
    const m = monthOf(e.start);
    byMonth.set(m, [...(byMonth.get(m) ?? []), { plantId: c.plantId, label: e.label, start: e.start, end: e.end }]);
  }
  const frost = state.site.frost;
  const climate = state.profile?.climate;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {state.profileStale && <StaleProfileNotice parcelId={state.parcel.id} />}
      <Card title="Weather alerts">
        {!state.profile ? <Body muted>Build the site profile first.</Body>
          : alertsError ? <Body muted>Couldn’t check the forecast ({alertsError}).</Body>
          : !alerts ? <ActivityIndicator accessibilityLabel="Checking the forecast" />
            : alerts.alerts.length ? alerts.alerts.map((a, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={{ color: a.kind === 'heat' || a.kind === 'wind' ? t.warn : t.bad, fontWeight: '700' }}>{a.title}</Text>
                <Body>{a.body}</Body>
              </View>
            )) : (
              <Body muted>{active.some((p) => p.status === 'planted') ? 'No frost, heat or wind trouble in the 7-day forecast for what’s planted.' : 'Mark crops as planted in the bed planner to get alerts for them.'}</Body>
            )}
        {alerts?.forecastNote && <Text style={{ color: t.muted, fontSize: 12 }}>{alerts.forecastNote}</Text>}
        <Text style={{ color: t.muted, fontSize: 12 }}>Forecast: National Weather Service (public domain).</Text>
        {notifyOn === false && <Button title="Turn on alert notifications" kind="secondary" onPress={() => router.push('/settings')} />}
      </Card>

      <SensorCard parcelId={state.parcel.id} profile={state.profile} year={year} />

      <Card title="Timing">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="Cautious" active={risk === 'cautious'} onPress={() => setRisk('cautious')} />
          <Chip label="Typical" active={risk === 'typical'} onPress={() => setRisk('typical')} />
          <Chip label={ent.has('planting.dynamicScheduling') ? 'Heat-unit harvest dates' : 'Heat-unit dates (Pro)'} active={dynamic} disabled={!ent.has('planting.dynamicScheduling')} onPress={() => setDynamic((d) => !d)} />
        </View>
        <Body muted>
          Cautious waits for the 1-in-10-years late frost before setting out frost-tender crops; typical uses the median.
          {frost?.lastSpring[32][50] != null && ` Median last frost ${formatDoy(frost.lastSpring[32][50]!)}`}
          {frost?.firstFall[32][50] != null && `, first frost ${formatDoy(frost.firstFall[32][50]!)}.`}
        </Body>
        {climate?.status === 'ok' && <Text style={{ color: t.muted, fontSize: 12 }}>{climate.attribution.source}, adjusted to the parcel’s elevation.</Text>}
        <Text style={{ color: t.muted, fontSize: 12 }}>Soil temperature: {state.soil.label}.</Text>
      </Card>

      {cals.length === 0 ? (
        <Card title="Nothing planned yet">
          <Body>Add crops to your beds in the bed planner (open Design, tap a bed, then “Plan this bed”).</Body>
          <Button title="Open design" onPress={() => router.push({ pathname: '/design/[id]', params: { id: state.parcel.id } })} />
        </Card>
      ) : (
        <>
          <Card title="Next 6 weeks">
            {soon.length ? soon.map((e, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{plantById(e.plantId)?.commonName}: {e.label}</Text>
                <Body muted>{formatDoy(e.start)}{e.end !== e.start ? ` – ${formatDoy(e.end)}` : ''} · {e.basis}</Body>
              </View>
            )) : <Body muted>No tasks in the next six weeks.</Body>}
          </Card>

          <Card title={`Season ${year}`}>
            {[...byMonth.keys()].sort((a, b) => a - b).map((m) => (
              <View key={m} style={{ marginBottom: 10 }}>
                <Text style={{ color: t.accent, fontWeight: '700' }} accessibilityRole="header">{MONTHS[m]}</Text>
                {byMonth.get(m)!.sort((a, b) => a.start - b.start).map((e, i) => (
                  <Body key={i}>{formatDoy(e.start)}{e.end !== e.start ? `–${formatDoy(e.end)}` : ''} · {plantById(e.plantId)?.commonName}: {e.label}</Body>
                ))}
              </View>
            ))}
          </Card>

          <Card title="Where it’s planted">
            {cals.map((c) => (
              <View key={c.plantId} style={{ marginBottom: 6 }}>
                <Body>{plantById(c.plantId)?.commonName}: {c.beds.join(', ')}</Body>
                {c.warnings.map((w, i) => <Text key={i} style={{ color: t.warn, fontSize: 13 }}>• {w}</Text>)}
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function SensorCard({ parcelId, profile, year }: { parcelId: string; profile?: SiteProfile; year: number }) {
  const t = useTheme();
  const ent = useEntitlements((st) => st.entitlements);
  const imperial = useSettings((st) => st.units) === 'imperial';
  const [info, setInfo] = useState<{ any: boolean; gdd: Awaited<ReturnType<typeof measuredGdd>>; water: WaterAdvice | null; low: FrostOffset | null } | null>(null);
  useEffect(() => {
    void (async () => {
      const sensors = await listSensors(parcelId);
      if (!sensors.length) return setInfo({ any: false, gdd: null, water: null, low: null });
      // A soil-moisture probe overrides the estimate.
      let vwc: number | undefined;
      for (const s of sensors.filter((x) => x.exposure === 'soil')) {
        const v = (await latestValues(s.id)).soilMoisture;
        if (v && Date.now() - v.t < 6 * 3_600_000) { vwc = v.value; break; }
      }
      const tex = dominantSoil(profile)?.texture?.toLowerCase();
      const texture = tex ? (/sand/.test(tex) ? 'sandy' : /clay/.test(tex) ? 'clayey' : 'loamy') : undefined;
      const [gdd, water, low] = await Promise.all([
        measuredGdd(parcelId, `${year}-01-01`), waterAdvice(parcelId, profile, { vwcPct: vwc, texture }), frostOffset(parcelId),
      ]);
      setInfo({ any: true, gdd, water, low });
    })();
  }, [parcelId, profile, year]);
  if (!info) return null;
  const mm = (v: number) => (imperial ? `${(v / 25.4).toFixed(2)} in` : `${Math.round(v)} mm`);
  return (
    <Card title="From your sensors">
      {!info.any ? (
        <View>
          <Body muted>Add a thermometer, soil sensor or weather station to fine-tune planting dates, watering and frost alerts with your own readings.</Body>
          <Button title="Add sensors" kind="secondary" onPress={() => router.push({ pathname: '/sensors', params: { parcelId } })} />
        </View>
      ) : (
        <View>
          {info.water ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>Watering, last 7 days</Text>
              <Body>{info.water.needMm > 0 && !/refill point/.test(info.water.message) ? `Water about ${mm(info.water.needMm)} this week. ` : ''}{info.water.message}</Body>
              <Text style={{ color: t.muted, fontSize: 12 }}>{info.water.basis}{info.water.estimated.length ? `; estimated: ${info.water.estimated.join(', ')}` : ''}. Assumes full-grown vegetables (crop coefficient 1.0).</Text>
            </View>
          ) : <Body muted>Watering suggestions need a few days of outdoor temperature readings.</Body>}
          {info.gdd && (ent.has('planting.dynamicScheduling')
            ? <Body>Heat units since Jan 1: {Math.round(info.gdd.gdd)} GDD (base 50 °F), measured by “{info.gdd.sensor}” over {info.gdd.days} days.</Body>
            : <Body muted>Homestead Pro tracks measured heat units against each crop’s needs.</Body>)}
          {info.low && (
            <Body>
              {info.low.offsetF <= -1
                ? `Low spot: “${info.low.sensor}” runs about ${Math.round(-info.low.offsetF)} °F colder than the forecast (${info.low.nights} nights). Frost alerts allow for it.`
                : `“${info.low.sensor}” tracks the forecast lows within about ${Math.max(1, Math.round(Math.abs(info.low.offsetF)))} °F (${info.low.nights} nights).`}
            </Body>
          )}
          <Button title="Sensors" kind="secondary" onPress={() => router.push({ pathname: '/sensors', params: { parcelId } })} />
        </View>
      )}
    </Card>
  );
}
