/**
 * Health reminders (livestock phase 5; free): a local notification a week before, and on the
 * morning of, each next-due date people (or their vets) entered. Rebuilt from the records whenever
 * they change or the app opens, so edits and records synced from another device are picked up.
 * Nothing is chosen for the user: only dates they entered are scheduled.
 */
import { HEALTH_TYPES, animalById, healthDue, HOUSEHOLD, isHousehold, type HealthRecord } from '@plotwright/core';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { kvGet, kvSet } from '../db/database';
import { herdsForParcel } from '../db/herds';
import { allRecords, listAnimals } from '../db/records';
import { herdLabel, localToday } from './animals';

const IDS_KEY = 'health.reminderIds';
const CHANNEL_ID = 'health-reminders';

/** Who a record is about, in plain words ("Daisy", "6 laying hens"). */
export async function healthSubjects(): Promise<(r: HealthRecord) => string> {
  const animals = new Map((await listAnimals()).map((a) => [a.id, a.name]));
  const herdNames = new Map<string, string>();
  const parcels = new Set((await allRecords('healthRecords')).filter((r) => r.herdId && r.parcelId).map((r) => r.parcelId!));
  for (const p of parcels) for (const h of await herdsForParcel(p)) herdNames.set(h.id, herdLabel(h));
  return (r) => (r.animalId ? animals.get(r.animalId) : r.herdId ? herdNames.get(r.herdId) : undefined) ?? 'your animal';
}

export async function remindersAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Ask for notification permission (from a button on the records screens). */
export async function enableReminders(): Promise<boolean> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Animal health reminders', importance: Notifications.AndroidImportance.DEFAULT });
  const ok = (await Notifications.requestPermissionsAsync()).granted;
  if (ok) await refreshHealthReminders();
  return ok;
}

let running: Promise<number> | null = null;

/** Cancel and re-create every health reminder from the stored records. Returns how many are scheduled. */
export function refreshHealthReminders(): Promise<number> {
  running ??= (async () => {
    if (!(await remindersAllowed())) return 0;
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Animal health reminders', importance: Notifications.AndroidImportance.DEFAULT });
    const old = JSON.parse((await kvGet(IDS_KEY)) ?? '[]') as string[];
    for (const id of old) await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
    const today = localToday();
    const due = healthDue(await allRecords('healthRecords'), today, 400).filter((d) => d.days >= 0);
    const nameOf = await healthSubjects();
    const ids: string[] = [];
    const at9 = (iso: string, minusDays: number) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y!, m! - 1, d! - minusDays, 9, 0, 0); };
    for (const d of due.slice(0, 40)) {
      const r = d.record;
      const what = r.product ? `${r.product} (${HEALTH_TYPES[r.type].toLowerCase()})` : HEALTH_TYPES[r.type];
      const who = nameOf(r);
      for (const before of [7, 0]) {
        const when = at9(r.nextDue!, before);
        if (when.getTime() <= Date.now()) continue;
        ids.push(await Notifications.scheduleNotificationAsync({
          content: { title: before ? `${who}: ${what} due in a week` : `${who}: ${what} due today`, body: `Due ${r.nextDue}, as you recorded. Check with your veterinarian if you’re unsure.`, data: { healthRecordId: r.id } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}) },
        }));
      }
    }
    await kvSet(IDS_KEY, JSON.stringify(ids));
    return ids.length;
  })().finally(() => { running = null; });
  return running;
}

/** A species label for any record, including household pets. */
export function speciesName(speciesId: string): string {
  return isHousehold(speciesId) ? HOUSEHOLD[speciesId] : animalById(speciesId)?.commonName ?? speciesId;
}
