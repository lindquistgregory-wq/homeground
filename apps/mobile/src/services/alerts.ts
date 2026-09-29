/**
 * Frost, heat and wind alerts for what's actually planted (§7.3), as on-device local notifications.
 * The NWS forecast is free and keyless; notifications are scheduled locally (no push server, no
 * Firebase/APNs sender). A background task re-checks roughly twice a day when the OS allows it; the
 * app also checks whenever it opens.
 */
import { plantById, weatherAlerts, type PlantedCrop, type WeatherAlert } from '@plotwright/core';
import { nwsForecast } from '@plotwright/providers';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { getDb, kvGet, kvSet } from '../db/database';
import { getDesign } from '../db/designs';
import { listParcels, getSiteProfile } from '../db/parcels';
import { plantingsForParcel } from '../db/plantings';
import { bedName } from './garden';
import { http } from './http';

export const ALERT_TASK = 'plotwright-weather-alerts';
const ENABLED_KEY = 'alerts.enabled';
const SENT_KEY = 'alerts.sent';

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

/** Turn alerts on (asking for notification permission) or off. Returns the resulting state. */
export async function setAlertsEnabled(on: boolean): Promise<boolean> {
  if (on) {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
    await kvSet(ENABLED_KEY, '1');
    await BackgroundTask.registerTaskAsync(ALERT_TASK, { minimumInterval: 12 * 60 });
    void checkAlerts();
    return true;
  }
  await kvSet(ENABLED_KEY, '0');
  if (await TaskManager.isTaskRegisteredAsync(ALERT_TASK)) await BackgroundTask.unregisterTaskAsync(ALERT_TASK);
  return false;
}

/** Crops currently in the ground on a parcel, with the bed names people know them by. */
export async function plantedCrops(parcelId: string): Promise<PlantedCrop[]> {
  const year = new Date().getFullYear();
  const plantings = (await plantingsForParcel(parcelId)).filter((p) => p.status === 'planted' && p.year === year);
  if (!plantings.length) return [];
  const design = await getDesign(plantings[0]!.designId);
  const objs = design?.objects ?? [];
  const out: PlantedCrop[] = [];
  for (const p of plantings) {
    const plant = plantById(p.plantId);
    if (!plant) continue;
    const i = objs.findIndex((o) => o.id === p.bedObjectId);
    out.push({ plantingId: p.id, plant, bedName: i >= 0 ? bedName(objs[i]!, i) : 'a bed' });
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
  return { parcelId, parcelName, alerts: weatherAlerts(fc.value.periods, crops), forecastNote: fc.attribution.notes?.[0] };
}

/** Check every parcel with planted crops and post a notification for each new alert. */
export async function checkAlerts(): Promise<void> {
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
        trigger: null,
      });
    }
  }
  // Keep the de-duplication list short: alert keys older than a week can go.
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await kvSet(SENT_KEY, JSON.stringify([...sent].filter((k) => k.split('|')[2]! >= cutoff)));
}
