/**
 * Frost, heat and wind alerts for what's actually planted (§7.3), as on-device local notifications.
 * The NWS forecast is free and keyless; notifications are scheduled locally (no push server, no
 * Firebase/APNs sender). A background task re-checks roughly twice a day when the OS allows it; the
 * app also checks whenever it opens.
 */
import { plantById, weatherAlerts, type Design, type PlantedCrop, type WeatherAlert } from '@plotwright/core';
import { nwsForecast } from '@plotwright/providers';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { getDb, kvGet, kvSet } from '../db/database';
import { getDesign } from '../db/designs';
import { listParcels, getSiteProfile } from '../db/parcels';
import { plantingsForParcel } from '../db/plantings';
import { checkThresholds, METRIC_LABEL } from '@plotwright/core';
import { latestValues, listSensors } from '../db/sensors';
import { activePlantings, bedName } from './garden';
import { frostOffset, localOffsetMin, recordForecastLows } from './sensorInsights';
import { refreshAllStations } from './stations';
import { http } from './http';
import { initIdentity } from './identity';
import { useEntitlements } from '../billing/entitlements';

export const ALERT_TASK = 'plotwright-weather-alerts';
const ENABLED_KEY = 'alerts.enabled';
const SENT_KEY = 'alerts.sent';
const CHANNEL_ID = 'weather-alerts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

// Must be defined at module scope so the OS can run it without the UI.
TaskManager.defineTask(ALERT_TASK, async () => {
  try {
    await getDb();
    // A headless run starts without the app's startup: set up the device id and clock first.
    await initIdentity();
    await checkAlerts({ background: true });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function alertsEnabled(): Promise<boolean> {
  return (await kvGet(ENABLED_KEY)) === '1';
}

export interface AlertsState {
  on: boolean;
  /** False when the OS won't run background checks (Low Power Mode, Background App Refresh off); alerts then come when the app opens. */
  background: boolean;
  /** Notification permission was refused. */
  denied?: boolean;
}

/** Turn alerts on (asking for notification permission) or off. */
export async function setAlertsEnabled(on: boolean): Promise<AlertsState> {
  if (!on) {
    await kvSet(ENABLED_KEY, '0');
    try {
      if (await TaskManager.isTaskRegisteredAsync(ALERT_TASK)) await BackgroundTask.unregisterTaskAsync(ALERT_TASK);
    } catch {
      // Nothing registered to remove.
    }
    return { on: false, background: false };
  }
  // Android 13+ only shows the permission prompt once a notification channel exists.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Frost & weather alerts', importance: Notifications.AndroidImportance.HIGH });
  }
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return { on: false, background: false, denied: true };
  let background = false;
  try {
    if ((await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(ALERT_TASK, { minimumInterval: 12 * 60 });
      background = true;
    }
  } catch {
    background = false;
  }
  // Foreground checks work even without background refresh, so alerts stay on either way.
  await kvSet(ENABLED_KEY, '1');
  void checkAlerts();
  return { on: true, background };
}

/** Crops currently in the ground on a parcel, with the bed names people know them by. */
export async function plantedCrops(parcelId: string): Promise<PlantedCrop[]> {
  const year = new Date().getFullYear();
  // In the ground now: this year's plantings plus perennials and overwintering crops.
  const plantings = activePlantings(await plantingsForParcel(parcelId), year).filter((p) => p.status === 'planted');
  const designs = new Map<string, Design | undefined>();
  const out: PlantedCrop[] = [];
  for (const p of plantings) {
    const plant = plantById(p.plantId);
    if (!plant) continue;
    if (!designs.has(p.designId)) designs.set(p.designId, await getDesign(p.designId));
    const objs = designs.get(p.designId)?.objects ?? [];
    const i = objs.findIndex((o) => o.id === p.bedObjectId);
    if (i < 0) continue; // bed no longer in the design
    out.push({ plantingId: p.id, plant, bedName: bedName(objs[i]!, i) });
  }
  return out;
}

export interface ParcelAlerts {
  parcelId: string;
  parcelName: string;
  alerts: WeatherAlert[];
  forecastNote?: string;
  /** Applied when a pinned sensor has shown the spot runs colder than the forecast. */
  lowSpot?: { sensor: string; offsetF: number; nights: number };
}

/** Alerts for one parcel (used by the calendar screen, with or without notifications on). */
export async function alertsForParcel(parcelId: string, parcelName: string, lat: number, lon: number): Promise<ParcelAlerts> {
  const crops = await plantedCrops(parcelId);
  const hasAirSensor = (await listSensors(parcelId)).some((x) => x.exposure === 'open-air');
  if (!crops.length && !hasAirSensor) return { parcelId, parcelName, alerts: [] };
  const fc = await nwsForecast(http, { lat, lon });
  if (fc.status !== 'ok') return { parcelId, parcelName, alerts: [], forecastNote: fc.reason };
  // Remember tonight's forecast lows so pinned sensors can show how much colder the low spot runs.
  await recordForecastLows(parcelId, fc.value.periods.filter((p) => p.isNight).map((p) => ({ date: p.start.slice(0, 10), lowF: p.temperatureF })));
  if (!crops.length) return { parcelId, parcelName, alerts: [] };
  // An offline, cached forecast may include nights that have already passed.
  const now = Date.now();
  let periods = fc.value.periods.filter((p) => Date.parse(p.end) > now);
  const low = await frostOffset(parcelId);
  // Only ever make alerts more cautious: apply the offset when the spot runs colder than forecast.
  const lowSpot = low && low.offsetF <= -1 ? low : undefined;
  if (lowSpot) periods = periods.map((p) => (p.isNight ? { ...p, temperatureF: p.temperatureF + lowSpot.offsetF } : p));
  const alerts = weatherAlerts(periods, crops).map((a) =>
    lowSpot && (a.kind === 'frost' || a.kind === 'freeze')
      ? { ...a, body: `${a.body} Adjusted for your low spot: “${lowSpot.sensor}” has run about ${Math.round(-lowSpot.offsetF)} °F colder than the forecast over ${lowSpot.nights} nights.` }
      : a);
  return { parcelId, parcelName, alerts, forecastNote: fc.attribution.notes?.[0], lowSpot };
}

/** Threshold checks right after readings arrive (the scan screen); cheap, no forecast fetch. */
let thresholdsInFlight: Promise<void> | null = null;
export function checkThresholdsNow(): Promise<void> {
  thresholdsInFlight ??= (async () => {
    // Share the sent-list with a full check that's already running rather than racing it.
    if (inFlight) await inFlight;
    if (!(await alertsEnabled())) return;
    const sent = new Set<string>(JSON.parse((await kvGet(SENT_KEY)) ?? '[]') as string[]);
    await checkSensorThresholds(sent);
    await kvSet(SENT_KEY, JSON.stringify([...sent]));
  })().finally(() => { thresholdsInFlight = null; });
  return thresholdsInFlight;
}

let inFlight: Promise<void> | null = null;

/** Check every parcel with planted crops and post a notification for each new alert (one check at a time). */
export function checkAlerts(opts: { background?: boolean } = {}): Promise<void> {
  inFlight ??= runCheck(opts).finally(() => { inFlight = null; });
  return inFlight;
}

async function runCheck(opts: { background?: boolean }): Promise<void> {
  // Don't race a threshold check that's already writing the sent-list. Captured before any await: a
  // threshold check that starts after this one waits for it instead, so the two can't wait on each other.
  const earlier = thresholdsInFlight;
  if (!(await alertsEnabled())) return;
  if (earlier) await earlier.catch(() => undefined);
  const sent = new Set<string>(JSON.parse((await kvGet(SENT_KEY)) ?? '[]') as string[]);
  // Station accounts can be read from anywhere; fetch fresh readings before checking thresholds.
  // In the background (about 30 s allowed) only a short gap of missed history is pulled.
  await refreshAllStations(localOffsetMin(), false, opts.background ? 1 : 14).catch(() => undefined);
  await checkSensorThresholds(sent);
  await kvSet(SENT_KEY, JSON.stringify([...sent]));
  for (const parcel of await listParcels()) {
    const profile = await getSiteProfile(parcel.id);
    const c = profile?.centroid;
    if (!c) continue;
    const { alerts } = await alertsForParcel(parcel.id, parcel.name, c.lat, c.lon);
    for (const a of alerts) {
      const key = `${parcel.id}|${a.kind}|${a.at.slice(0, 10)}`;
      if (sent.has(key)) continue;
      sent.add(key);
      await Notifications.scheduleNotificationAsync({
        content: { title: `${a.title} · ${parcel.name}`, body: a.body, data: { parcelId: parcel.id } },
        // Immediate; on Android it goes to the alerts channel.
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
      });
    }
  }
  // Keep the de-duplication list short: alert keys older than a week can go.
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await kvSet(SENT_KEY, JSON.stringify([...sent].filter((k) => k.split('|')[2]! >= cutoff)));
}

/**
 * Greenhouse / cold-frame / low-spot thresholds on individual sensors (Homestead Pro; set in the
 * sensor's settings). Uses readings from the last 30 minutes; at most one notification per sensor,
 * metric and direction per hour.
 */
async function checkSensorThresholds(sent: Set<string>): Promise<void> {
  // A headless run hasn't loaded the plan yet; and thresholds stop when Homestead Pro lapses.
  try {
    await useEntitlements.getState().refresh();
  } catch {
    // keep the last known plan
  }
  if (!useEntitlements.getState().entitlements.has('sensors.greenhouseAlerts')) return;
  const now = Date.now();
  for (const s of await listSensors()) {
    if (!s.thresholds) continue;
    const latest = await latestValues(s.id);
    const fresh = Object.fromEntries(Object.entries(latest).filter(([, v]) => v && now - v.t < 30 * 60_000).map(([m, v]) => [m, v!.value]));
    for (const b of checkThresholds(fresh, s.thresholds)) {
      const key = `${s.id}|th-${b.metric}-${b.kind}|${new Date(now).toISOString().slice(0, 13)}`;
      if (sent.has(key)) continue;
      sent.add(key);
      const isTemp = b.metric === 'temperature';
      const fmt = (v: number) => (isTemp ? `${Math.round((v * 9) / 5 + 32)} °F` : `${Math.round(v)} %`);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${s.name}: ${METRIC_LABEL[b.metric].toLowerCase()} ${b.kind} ${fmt(b.limit)}`,
          body: `Now ${fmt(b.value)}. ${isTemp ? (b.kind === 'above' ? 'Open vents or add shade.' : 'Close up, cover plants or add heat.') : b.metric === 'humidity' ? 'Ventilate to keep leaves dry.' : 'Time to water.'}`,
          data: { sensorId: s.id },
        },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
      });
    }
  }
}
