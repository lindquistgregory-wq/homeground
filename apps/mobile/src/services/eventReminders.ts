/**
 * Reminders for the user's own calendar events: a local notification at the time they chose (or 8:00
 * on the day for all-day events), rebuilt whenever events change or the app opens, like health
 * reminders. Only events with a reminder set are scheduled; nothing leaves the phone.
 */
import { expandCustom, isoAdd } from '@plotwright/core';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { kvGet, kvSet } from '../db/database';
import { allEvents } from '../db/calendarEvents';
import { localToday } from './animals';

const IDS_KEY = 'events.reminderIds';
const CHANNEL_ID = 'calendar-reminders';

export async function ensureReminderPermission(): Promise<boolean> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Calendar reminders', importance: Notifications.AndroidImportance.DEFAULT });
  const cur = await Notifications.getPermissionsAsync();
  return cur.granted || (await Notifications.requestPermissionsAsync()).granted;
}

let running: Promise<number> | null = null;

export function refreshEventReminders(): Promise<number> {
  running ??= (async () => {
    let granted = false;
    try { granted = (await Notifications.getPermissionsAsync()).granted; } catch { granted = false; }
    if (!granted) return 0;
    const old = JSON.parse((await kvGet(IDS_KEY)) ?? '[]') as string[];
    for (const id of old) await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
    const today = localToday(), until = isoAdd(today, 60);
    const ids: string[] = [];
    for (const e of (await allEvents()).filter((x) => x.remindMinutes !== null && x.remindMinutes !== undefined)) {
      for (const occ of expandCustom(e, today, until)) {
        const [y, m, d] = occ.start.split('-').map(Number);
        const [hh, mm] = (e.time ?? '08:00').split(':').map(Number);
        const when = new Date(y!, m! - 1, d!, hh!, mm! - (e.remindMinutes ?? 0), 0);
        if (when.getTime() <= Date.now() || ids.length >= 40) continue;
        ids.push(await Notifications.scheduleNotificationAsync({
          content: { title: e.title, body: `${e.time ? `At ${e.time}` : 'Today'}${e.notes ? ` · ${e.notes}` : ''}`, data: { eventId: e.id } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}) },
        }));
      }
    }
    await kvSet(IDS_KEY, JSON.stringify(ids));
    return ids.length;
  })().finally(() => { running = null; });
  return running;
}

/** "Delete all my data": cancel every scheduled event reminder. */
export async function cancelEventReminders(): Promise<void> {
  const old = JSON.parse((await kvGet(IDS_KEY)) ?? '[]') as string[];
  for (const id of old) await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  await kvSet(IDS_KEY, '[]');
}
