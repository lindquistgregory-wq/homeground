/**
 * The homestead's daily brief for Home: today's forecast in a line, today's weather alerts, and
 * what's on the calendar today. The forecast is the free NWS one (cached), so it works offline from
 * the last fetch and says so when there's nothing to show.
 */
import { itemsOn, type AgendaItem, type ForecastPeriod } from '@plotwright/core';
import { nwsForecast } from '@plotwright/providers';
import { agendaFor } from './agenda';
import { alertsForParcel } from './alerts';
import { localToday } from './animals';
import { http } from './http';
import { gardenState } from './useGarden';
import { useSettings } from './settings';

export interface DailyBrief {
  /** "Mostly sunny · high 72 °F · tonight 48 °F · wind to 12 mph", or why there's none. */
  weather: string | null;
  weatherNote?: string;
  alerts: Array<{ title: string; urgent: boolean }>;
  events: AgendaItem[];
  ongoing: AgendaItem[];
}

export function summarizeDay(periods: ForecastPeriod[], today: string): string | null {
  const day = periods.find((p) => !p.isNight && p.start.slice(0, 10) === today);
  const night = periods.find((p) => p.isNight && p.start.slice(0, 10) === today);
  if (!day && !night) return null;
  const wind = Math.max(day?.windMph ?? 0, night?.windMph ?? 0);
  return [
    (day ?? night)?.summary,
    day ? `high ${Math.round(day.temperatureF)} °F` : null,
    night ? `tonight ${Math.round(night.temperatureF)} °F` : null,
    wind >= 10 ? `wind to ${Math.round(wind)} mph` : null,
  ].filter(Boolean).join(' · ');
}

export async function dailyBrief(parcelId: string): Promise<DailyBrief | null> {
  const state = await gardenState(parcelId);
  if (!state) return null;
  const today = localToday();
  let weather: string | null = null, weatherNote: string | undefined;
  const c = state.profile?.centroid;
  const animalsOn = useSettings.getState().animals === 'yes';
  let alertList: Awaited<ReturnType<typeof alertsForParcel>> | null = null;
  if (c) {
    const fc = await nwsForecast(http, { lat: c.lat, lon: c.lon }).catch(() => null);
    if (fc?.status === 'ok') weather = summarizeDay(fc.value.periods, today);
    else weatherNote = fc ? fc.reason : 'The forecast couldn’t be reached.';
    alertList = await alertsForParcel(parcelId, state.parcel.name, c.lat, c.lon).catch(() => null);
  } else weatherNote = 'Build the site profile to get the forecast.';
  const alerts = alertList ? [...alertList.alerts, ...(animalsOn ? alertList.animalAlerts : [])] : [];
  const todays = alerts.filter((a) => a.at.slice(0, 10) === today);
  const items = await agendaFor(state, { from: today, to: today });
  const on = itemsOn(items, today);
  return { weather, weatherNote, alerts: todays.map((a) => ({ title: a.title, urgent: a.kind !== 'heat' && a.kind !== 'wind' })), events: on.shown, ongoing: on.ongoing };
}
