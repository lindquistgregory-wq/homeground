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
import { activePlantings, bedName } from './garden';
import { http } from './http';

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
    await checkAlerts();
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
}

/** Alerts for one parcel (used by the calendar screen, with or without notifications on). */
export async function alertsForParcel(parcelId: string, parcelName: string, lat: number, lon: number): Promise<ParcelAlerts> {
  const crops = await plantedCrops(parcelId);
  if (!crops.length) return { parcelId, parcelName, alerts: [] };
  const fc = await nwsForecast(http, { lat, lon });
  if (fc.status !== 'ok') return { parcelId, parcelName, alerts: [], forecastNote: fc.reason };
  // An offline, cached forecast may include nights that have already passed.
  const now = Date.now();
  const periods = fc.value.periods.filter((p) => Date.parse(p.end) > now);
  return { parcelId, parcelName, alerts: weatherAlerts(periods, crops), forecastNote: fc.attribution.notes?.[0] };
}

let inFlight: Promise<void> | null = null;

/** Check every parcel with planted crops and post a notification for each new alert (one check at a time). */
export function checkAlerts(): Promise<void> {
  inFlight ??= runCheck().finally(() => { inFlight = null; });
  return inFlight;
}

async function runCheck(): Promise<void> {
  if (!(await alertsEnabled())) return;
  const sent = new Set<string>(JSON.parse((await kvGet(SENT_KEY)) ?? '[]') as string[]);
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
