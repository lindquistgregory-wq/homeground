/**
 * What the parcel's sensors mean for the plan (§8 "Uses"):
 *  - soil temperature for sowing dates: your soil sensor → nearest SCAN station (regional) → model
 *  - growing degree days from your own air temperatures
 *  - an irrigation suggestion: FAO-56 ET0 from your station (or thermometer) minus rain, or a soil-moisture reading
 *  - how much colder your low spot runs than the NWS forecast, for frost alerts
 */
import {
  blendSoilCurve, et0PenmanMonteith, forecastOffsetC, fullDay, gddFromDailyC, localDate, modeledSoilF, waterBalance,
  type DayAggregate, type MetricDay, type Offset, type SiteConditions, type WaterBalance,
} from '@plotwright/core';
import { regionalSoil, type SiteProfile } from '@plotwright/providers';
import { kvGet, kvSet } from '../db/database';
import { listSensors, sensorDays, type SensorRecord } from '../db/sensors';
import { http } from './http';

const DAY = 86_400_000;
const cToF = (c: number) => (c * 9) / 5 + 32;
const isoDate = (t: number, offset: Offset) => localDate(t, offset).date;

/**
 * The phone's UTC offset (minutes east) at a given moment, so daylight-saving changes land each reading
 * on the right local day. Parcels are assumed to be in the phone's time zone.
 */
const phoneOffset: Offset = (t: number) => -new Date(t).getTimezoneOffset();
export const localOffsetMin = (): Offset => phoneOffset;

/** Readings in at least three of the hours 2–7 am, when the overnight low happens. */
const coversPreDawn = (m: MetricDay | undefined) => {
  let n = 0;
  for (let h = 2; h <= 7; h++) if (((m?.hm ?? 0) >> h) & 1) n++;
  return n >= 3;
};

export interface SoilSource {
  kind: 'sensor' | 'regional' | 'model' | 'none';
  label: string;
  soilF?: (doy: number) => number;
  /** For the calendar's "based on" text. */
  basisLabel?: string;
}

/**
 * Soil temperature function for the calendar. Only the last 60 days of measurements are used, so this
 * spring's readings steer this spring's dates without rewriting the typical season for next year.
 */
export async function soilSourceFor(parcelId: string, profile: SiteProfile | undefined, site: SiteConditions): Promise<SoilSource> {
  const model = site.curves ? (d: number) => modeledSoilF(site.curves!, d) : undefined;
  const since = isoDate(Date.now() - 60 * DAY, localOffsetMin());
  for (const s of (await listSensors(parcelId)).filter((x) => x.exposure === 'soil')) {
    const days = (await sensorDays(s.id, since)).filter((d) => d.metrics.soilTemperature || d.metrics.temperature);
    if (days.length >= 3 && model) {
      const measured = days.map((d) => ({ doy: d.doy, meanF: cToF((d.metrics.soilTemperature ?? d.metrics.temperature)!.mean) }));
      return { kind: 'sensor', label: `your soil sensor “${s.name}”`, soilF: blendSoilCurve(model, measured), basisLabel: 'measured' };
    }
  }
  if (profile && model) {
    const elev = profile.elevation.status === 'ok' ? profile.elevation.value.centroidM : null;
    const r = await regionalSoil(http, { ...profile.centroid, elevationM: elev });
    if (r.status === 'ok') {
      const measured = r.value.days.filter((d) => d.soil2inF !== undefined).map((d) => ({ doy: d.doy, meanF: d.soil2inF! }));
      if (measured.length >= 3)
        return { kind: 'regional', label: `${r.value.station.name} SCAN station, ${Math.round(r.value.station.distanceKm)} km away (regional)`, soilF: blendSoilCurve(model, measured), basisLabel: 'regional station' };
    }
  }
  return model ? { kind: 'model', label: 'modeled from air-temperature normals', soilF: model, basisLabel: 'modeled' } : { kind: 'none', label: 'no soil temperature available' };
}

/** Outdoor air sensors on a parcel, best first (a station's outdoor channel, then pinned open-air sensors). */
async function airSensors(parcelId: string): Promise<SensorRecord[]> {
  const all = (await listSensors(parcelId)).filter((s) => s.exposure === 'open-air' && (s.channel === undefined || s.channel === 'outdoor' || s.channel.startsWith('th')));
  return all.sort((a, b) => Number(b.channel === 'outdoor') - Number(a.channel === 'outdoor'));
}

/** Degree days since `fromDate` (local YYYY-MM-DD) from your own air temperature, with the number of days covered. */
export async function measuredGdd(parcelId: string, fromDate: string, baseF = 50): Promise<{ gdd: number; days: number; sensor: string } | null> {
  for (const s of await airSensors(parcelId)) {
    const days = (await sensorDays(s.id, fromDate)).filter((d) => fullDay(d.metrics.temperature));
    if (days.length >= 3) return { gdd: gddFromDailyC(days.map((d) => ({ tminC: d.metrics.temperature!.min, tmaxC: d.metrics.temperature!.max })), baseF), days: days.length, sensor: s.name };
  }
  return null;
}

/**
 * Rain on a day: the larger of the station's daily counter (at its highest) and the sum of per-interval
 * rain. A day can have both (live snapshots plus archive records); the snapshots can stop before the
 * day's last rain, so neither alone is safe.
 */
function rainMm(d: DayAggregate): number | undefined {
  const daily = d.metrics.rainDaily?.max;
  const summed = d.metrics.rain ? d.metrics.rain.mean * d.metrics.rain.n : undefined;
  if (daily === undefined && summed === undefined) return undefined;
  return Math.max(daily ?? 0, summed ?? 0);
}

export interface WaterAdvice extends WaterBalance {
  basis: string;
  estimated: string[];
}

/** Irrigation suggestion for the last 7 days (FAO-56, single crop coefficient). */
export async function waterAdvice(parcelId: string, profile: SiteProfile | undefined, soil?: { vwcPct?: number; texture?: 'sandy' | 'loamy' | 'clayey' }, kc = 1.0): Promise<WaterAdvice | null> {
  if (!profile) return null;
  const offset = localOffsetMin();
  const since = isoDate(Date.now() - 8 * DAY, offset), today = isoDate(Date.now(), offset);
  const elevationM = profile.elevation.status === 'ok' ? profile.elevation.value.centroidM : 0;
  for (const s of await airSensors(parcelId)) {
    const days = (await sensorDays(s.id, since)).filter((d) => d.date < today && fullDay(d.metrics.temperature)).slice(-7);
    if (days.length < 3) continue;
    const estimated = new Set<string>();
    let rainKnown = true;
    const series = days.map((d) => {
      const m = d.metrics;
      const r = et0PenmanMonteith({
        latDeg: profile.centroid.lat, elevationM, doy: d.doy, tmaxC: m.temperature!.max, tminC: m.temperature!.min,
        rhMaxPct: m.humidity?.max, rhMinPct: m.humidity?.min, windMs: m.windSpeed?.mean, windHeightM: s.heightM ?? 2,
        solarMJ: fullDay(m.solarRadiation) ? m.solarRadiation!.mean * 0.0864 : undefined,
      });
      r.estimated.forEach((e) => estimated.add(e));
      const rain = rainMm(d);
      if (rain === undefined) rainKnown = false;
      return { et0Mm: r.et0Mm, rainMm: rain ?? 0 };
    });
    const w = waterBalance(series, kc, soil);
    return {
      ...w,
      message: rainKnown ? w.message : `${w.message} (This sensor doesn't measure rain; subtract what fell.)`,
      basis: `${days.length} days from “${s.name}”, FAO-56 Penman–Monteith`,
      estimated: [...estimated],
    };
  }
  return null;
}

// ---------------- Frost at your own low spot ----------------

const LOWS_KEY = (parcelId: string) => `forecastLows.${parcelId}`;

/** Remember forecast overnight lows (°F) by the local date the night starts, to compare with what sensors saw. */
export async function recordForecastLows(parcelId: string, nights: Array<{ date: string; lowF: number }>): Promise<void> {
  const prev = JSON.parse((await kvGet(LOWS_KEY(parcelId))) ?? '{}') as Record<string, number>;
  // Keep the latest forecast for each night; the first night's forecast is the one issued closest to it.
  for (const n of nights) prev[n.date] = n.lowF;
  const keep = Object.keys(prev).sort().slice(-90);
  await kvSet(LOWS_KEY(parcelId), JSON.stringify(Object.fromEntries(keep.map((k) => [k, prev[k]]))));
}

export interface FrostOffset {
  sensor: string;
  /** °F; negative = your spot runs colder than the forecast. */
  offsetF: number;
  nights: number;
}

/** The coldest-running pinned air sensor's median offset from the NWS forecast low (needs ≥ 5 nights). */
export async function frostOffset(parcelId: string): Promise<FrostOffset | null> {
  const lows = JSON.parse((await kvGet(LOWS_KEY(parcelId))) ?? '{}') as Record<string, number>;
  let best: FrostOffset | null = null;
  for (const s of await airSensors(parcelId)) {
    const days = new Map((await sensorDays(s.id)).map((d) => [d.date, d]));
    const pairs: Array<{ forecastLowC: number; observedMinC: number }> = [];
    for (const [date, lowF] of Object.entries(lows)) {
      // A night that starts on `date` bottoms out on the next morning.
      const next = new Date(Date.parse(`${date}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
      const t = days.get(next)?.metrics.temperature;
      if (t && coversPreDawn(t)) pairs.push({ forecastLowC: ((lowF - 32) * 5) / 9, observedMinC: t.min });
    }
    const off = forecastOffsetC(pairs);
    if (off !== null && (!best || off * 1.8 < best.offsetF)) best = { sensor: s.name, offsetF: off * 1.8, nights: pairs.length };
  }
  return best;
}
