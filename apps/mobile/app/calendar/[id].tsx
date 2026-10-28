/**
 * Calendar (§7.3): a month view of everything on the property — planting tasks, animal care,
 * breeding and health dates, planner tasks, weather alerts and the user's own events — as title
 * cards on each day. Tapping a day lists it; tapping an event shows its details. Frost, heat and
 * wind alerts from the NWS forecast sit on top.
 */
import { formatDoy, formatGdd, formatTempDeltaF, isoAdd, itemsOn, plantById, type AgendaItem, type CustomEvent } from '@plotwright/core';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Text } from '../../src/components/Text';
import { useEntitlements } from '../../src/billing/entitlements';
import { Chip, StaleProfileNotice } from '../../src/components/plants';
import { MoreInfo, Pill } from '../../src/components/kit';
import { EventEditor, EventRow, EventSheet, MonthCalendar } from '../../src/components/calendar';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { alertsEnabled, alertsForParcel, setAlertsEnabled, type ParcelAlerts } from '../../src/services/alerts';
import { agendaFor, monthRange } from '../../src/services/agenda';
import { localToday } from '../../src/services/animals';
import { activePlantings, bedName, calendarFor } from '../../src/services/garden';
import { useGarden } from '../../src/services/useGarden';
import { dominantSoil } from '../../src/services/garden';
import { frostOffset, measuredGdd, waterAdvice, type FrostOffset, type WaterAdvice } from '../../src/services/sensorInsights';
import { latestValues, listSensors } from '../../src/db/sensors';
import { deleteEvent, eventsForParcel, saveEvent } from '../../src/db/calendarEvents';
import { ensureReminderPermission, refreshEventReminders } from '../../src/services/eventReminders';
import type { SiteProfile } from '@plotwright/providers';
import { useSettings } from '../../src/services/settings';

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
  const animalsOn = useSettings((s) => s.animals) === 'yes';
  const today = localToday();
  const [ym, setYm] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [selected, setSelected] = useState(today);
  const [items, setItems] = useState<AgendaItem[] | null>(null);
  const [open, setOpen] = useState<AgendaItem | null>(null);
  const [editor, setEditor] = useState<{ initial?: CustomEvent } | null>(null);
  const [version, setVersion] = useState(0);
  const year = Number(today.slice(0, 4));

  useEffect(() => {
    if (!state?.profile) return;
    void alertsEnabled().then(setNotifyOn);
    const c = state.profile.centroid;
    alertsForParcel(state.parcel.id, state.parcel.name, c.lat, c.lon).then(setAlerts).catch((e: Error) => setAlertsError(e.message));
  }, [state]);

  // Everything on the calendar for the visible month (and the next two weeks for "Coming up").
  const load = useCallback(async () => {
    if (!state) return;
    const r = monthRange(ym.year, ym.month);
    const from = today < r.from ? today : r.from, to = isoAdd(today, 14) > r.to ? isoAdd(today, 14) : r.to;
    const all = alerts ? [...alerts.alerts, ...(animalsOn ? alerts.animalAlerts : [])] : [];
    setItems(await agendaFor(state, { from, to, risk, dynamicGdd: dynamic && ent.has('planting.dynamicScheduling'), alerts: all }));
  }, [state, ym, today, alerts, animalsOn, risk, dynamic, ent]);
  useEffect(() => { void load(); }, [load, version]);
  useFocusEffect(useCallback(() => { setVersion((v) => v + 1); }, []));

  const day = useMemo(() => (items ? itemsOn(items, selected) : { shown: [], ongoing: [] }), [items, selected]);
  const soon = useMemo(() => (items ?? []).filter((i) => i.start > today && i.start <= isoAdd(today, 14)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 8), [items, today]);
  const active = useMemo(() => (state ? activePlantings(state.plantings, year) : []), [state, year]);

  if (error) return <Body>{error}</Body>;
  if (!state) return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading calendar" />;

  const frost = state.site.frost;
  const climate = state.profile?.climate;
  const weatherAlerts = alerts ? [...alerts.alerts, ...(animalsOn ? alerts.animalAlerts : [])] : [];

  const saveCustom = async (e: Parameters<Parameters<typeof EventEditor>[0]['onSave']>[0]) => {
    if (e.remindMinutes !== null && !(await ensureReminderPermission()))
      Alert.alert('Reminders', 'Notifications are off for Plotwright, so this event is saved without a reminder. You can allow them in your phone’s settings.');
    await saveEvent({ ...(editor?.initial ?? {}), ...e, parcelId: state.parcel.id });
    setEditor(null);
    setOpen(null);
    setSelected(e.date);
    void refreshEventReminders();
    setVersion((v) => v + 1);
  };
  const removeCustom = (customId: string) => Alert.alert('Delete event?', 'This removes every repeat of it too.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { await deleteEvent(customId); setOpen(null); void refreshEventReminders(); setVersion((v) => v + 1); } },
  ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {state.profileStale && <StaleProfileNotice parcelId={state.parcel.id} />}
      {(weatherAlerts.length > 0 || alertsError || notifyOn === false) && (
        <Card title="Weather alerts" icon="weather-lightning-rainy">
          {alertsError && <Body muted>Couldn’t check the forecast ({alertsError}).</Body>}
          {weatherAlerts.map((a, i) => (
            <View key={i} style={{ marginBottom: 8 }}>
              <Text style={{ color: a.kind === 'heat' || a.kind === 'wind' ? t.warn : t.bad, fontWeight: '700' }}>{a.title}</Text>
              <Body>{a.body}</Body>
            </View>
          ))}
          {alerts?.forecastNote && <Text style={{ color: t.muted, fontSize: 12 }}>{alerts.forecastNote}</Text>}
          <Text style={{ color: t.muted, fontSize: 12 }}>Not an official warning. For watches and warnings, see weather.gov. Forecast: National Weather Service (public domain).</Text>
          {notifyOn === false && <Button title="Turn on alert notifications (free)" kind="secondary" onPress={async () => {
            const r = await setAlertsEnabled(true).catch(() => ({ on: false, denied: false }));
            if ('denied' in r && r.denied) Alert.alert('Notifications are off', 'Allow notifications for Plotwright in your phone’s settings, then try again.');
            setNotifyOn(r.on);
          }} />}
        </Card>
      )}

      <Card title="Calendar" icon="calendar-month" right={<Chip label="+ Event" active onPress={() => setEditor({})} />}>
        {!items ? <ActivityIndicator accessibilityLabel="Loading the calendar" /> : (
          <MonthCalendar year={ym.year} month={ym.month} items={items} selected={selected} today={today}
            onSelect={setSelected} onMonth={(y, m) => setYm({ year: y, month: m })} />
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          {!weatherAlerts.length && alerts && !alertsError && <Text style={{ color: t.muted, fontSize: 12 }}>No frost, heat or wind trouble in the 7-day forecast.</Text>}
        </View>
      </Card>

      <Card title={selected === today ? 'Today' : new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} icon="calendar-today">
        {day.shown.map((i) => <EventRow key={i.id} item={i} onPress={() => setOpen(i)} />)}
        {day.shown.length === 0 && <Body muted>Nothing starts this day.</Body>}
        {day.ongoing.length > 0 && (
          <MoreInfo label={`Ongoing (${day.ongoing.length})`}>
            {day.ongoing.map((i) => <EventRow key={i.id} item={i} onPress={() => setOpen(i)} />)}
          </MoreInfo>
        )}
        <Button title="Add an event this day" kind="secondary" icon="calendar-plus" onPress={() => setEditor({})} />
      </Card>

      {soon.length > 0 && (
        <Card title="Next two weeks" icon="calendar-clock">
          {soon.map((i) => <EventRow key={i.id} item={i} onPress={() => setOpen(i)} />)}
        </Card>
      )}

      {active.length === 0 && (
        <Card title="Nothing planted yet" icon="sprout-outline">
          <Body muted>Add crops to a bed (Design, tap a bed, Plan this bed) and their sowing, planting and harvest dates appear on the calendar.</Body>
          <Button title="Open Design" kind="secondary" onPress={() => router.push({ pathname: '/design/[id]', params: { id: state.parcel.id } })} />
        </Card>
      )}

      <SensorCard parcelId={state.parcel.id} profile={state.profile} year={year} />

      <Card title="Timing" icon="clock-outline">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="Cautious" active={risk === 'cautious'} onPress={() => setRisk('cautious')} />
          <Chip label="Typical" active={risk === 'typical'} onPress={() => setRisk('typical')} />
          <Chip label={ent.has('planting.dynamicScheduling') ? 'Heat-unit harvest dates' : 'Heat-unit dates (Pro)'} active={dynamic} disabled={!ent.has('planting.dynamicScheduling')} onPress={() => setDynamic((d) => !d)} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {frost?.lastSpring[32][50] != null && <Pill icon="snowflake" text={`Last frost ${formatDoy(frost.lastSpring[32][50]!)}`} />}
          {frost?.firstFall[32][50] != null && <Pill icon="snowflake-alert" text={`First frost ${formatDoy(frost.firstFall[32][50]!)}`} />}
        </View>
        <MoreInfo>
          <Body muted>Cautious waits for the 1-in-10-years late frost before setting out frost-tender crops; typical uses the median date.</Body>
          {climate?.status === 'ok' && <Text style={{ color: t.muted, fontSize: 12 }}>{climate.attribution.source}, adjusted to the parcel’s elevation.</Text>}
          <Text style={{ color: t.muted, fontSize: 12 }}>Soil temperature: {state.soil.label}.</Text>
        </MoreInfo>
      </Card>

      {active.length > 0 && <PlantedCard state={state} year={year} risk={risk} />}

      <EventSheet item={open} onClose={() => setOpen(null)}
        onEdit={async () => { const e = (await eventsForParcel(state.parcel.id)).find((x) => x.id === open?.customId); setOpen(null); if (e) setEditor({ initial: e }); }}
        onDelete={() => open?.customId && removeCustom(open.customId)} />
      {editor && <EventEditor visible initial={editor.initial} date={selected} onClose={() => setEditor(null)} onSave={saveCustom} />}
    </ScrollView>
  );
}

/** Which beds each crop is in, with its calendar warnings. */
function PlantedCard({ state, year, risk }: { state: NonNullable<ReturnType<typeof useGarden>['state']>; year: number; risk: 'cautious' | 'typical' }) {
  const t = useTheme();
  const byPlant = new Map<string, string[]>();
  for (const p of activePlantings(state.plantings, year)) {
    const i = state.design.objects.findIndex((o) => o.id === p.bedObjectId);
    byPlant.set(p.plantId, [...(byPlant.get(p.plantId) ?? []), i >= 0 ? bedName(state.design.objects[i]!, i) : 'removed bed']);
  }
  return (
    <Card title="Where it’s planted" icon="map-marker-outline">
      {[...byPlant].map(([plantId, beds]) => {
        const plant = plantById(plantId);
        const cal = plant && calendarFor(plant, state.site, { risk, soilF: state.soil.soilF, soilLabel: state.soil.basisLabel });
        return (
          <View key={plantId} style={{ marginBottom: 6 }}>
            <Body>{plant?.commonName ?? plantId}: {beds.join(', ')}</Body>
            {cal?.warnings.map((w, i) => <Text key={i} style={{ color: t.warn, fontSize: 13 }}>• {w}</Text>)}
          </View>
        );
      })}
    </Card>
  );
}

function SensorCard({ parcelId, profile, year }: { parcelId: string; profile?: SiteProfile; year: number }) {
  const t = useTheme();
  const ent = useEntitlements((st) => st.entitlements);
  const units = useSettings((st) => st.units);
  const imperial = units === 'imperial';
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
    <Card title="From your sensors" icon="thermometer">
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
            ? <Body>Heat units since Jan 1: {formatGdd(info.gdd.gdd, units)}, measured by “{info.gdd.sensor}” over {info.gdd.days} days.</Body>
            : <Body muted>Homestead Pro tracks measured heat units against each crop’s needs.</Body>)}
          {info.low && (
            <Body>
              {info.low.offsetF <= -1
                ? `Low spot: “${info.low.sensor}” runs about ${formatTempDeltaF(-info.low.offsetF, units)} colder than the forecast (${info.low.nights} nights). Frost alerts allow for it.`
                : `“${info.low.sensor}” tracks the forecast lows within about ${formatTempDeltaF(Math.max(1, Math.abs(info.low.offsetF)), units)} (${info.low.nights} nights).`}
            </Body>
          )}
          <Button title="Sensors" kind="secondary" onPress={() => router.push({ pathname: '/sensors', params: { parcelId } })} />
        </View>
      )}
    </Card>
  );
}
