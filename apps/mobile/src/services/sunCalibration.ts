/**
 * Measured vs modeled sun for a light sensor pinned on the parcel (§5.8, §8): on clear days (from
 * NASA POWER's all-sky/clear-sky ratio) compare when the sensor saw direct sun with when the shade
 * model says that spot is sunny. With ≥ 3 clear days the ratio adjusts the bed's modeled sun-hours.
 */
import { compareSun, localDate, type SunCalibration } from '@plotwright/core';
import { dailyClearness } from '@plotwright/providers';
import { kvGet, kvSet } from '../db/database';
import { getDesign } from '../db/designs';
import { getParcel, getSiteProfile } from '../db/parcels';
import { plantingsForParcel } from '../db/plantings';
import { readingsBetween, type SensorRecord } from '../db/sensors';
import { loadAnalysis, modeledSunSeries } from './analysis';
import { activePlantings, cropShadeObjects } from './garden';
import { http } from './http';
import { localOffsetMin } from './sensorInsights';

export interface StoredCalibration extends SunCalibration {
  computedAt: string;
  sensorId: string;
}

const KEY = (id: string) => `sunCal.${id}`;
const DAY = 86_400_000;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

export async function getCalibration(sensorId: string): Promise<StoredCalibration | null> {
  const v = await kvGet(KEY(sensorId));
  return v ? (JSON.parse(v) as StoredCalibration) : null;
}

export async function calibrateLightSensor(sensor: SensorRecord, days = 30): Promise<StoredCalibration | { error: string }> {
  if (!sensor.location) return { error: 'Pin the sensor on the map first, so the model knows where it is.' };
  const parcel = await getParcel(sensor.parcelId);
  const profile = await getSiteProfile(sensor.parcelId);
  if (!parcel || !profile) return { error: 'The property’s site profile is missing.' };
  const now = Date.now(), from = now - days * DAY;
  const raw = await readingsBetween(sensor.id, from, now, 'illuminance');
  if (raw.length < 12) return { error: 'Not enough light readings yet. Leave the sensor out for a few sunny days.' };
  // 15-minute means keep the model runs few.
  const buckets = new Map<number, { s: number; n: number }>();
  for (const r of raw) {
    if (r.quality === 'suspect') continue;
    const b = Math.floor(r.t / 900_000) * 900_000;
    const x = buckets.get(b) ?? { s: 0, n: 0 };
    x.s += r.value; x.n++;
    buckets.set(b, x);
  }
  const samples: Array<[number, number]> = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, x]) => [t + 450_000, x.s / x.n]);
  const clear = await dailyClearness(http, profile.centroid, ymd(from), ymd(now));
  if (clear.status !== 'ok') return { error: clear.reason };
  const clearDays = new Set(Object.entries(clear.value).filter(([, k]) => k >= 0.8).map(([d]) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`));
  if (!clearDays.size) return { error: 'No clear days in the period yet (NASA data lags a few days). Try again after some sunny weather.' };
  const c = profile.climate.status === 'ok' ? profile.climate.value.frost.dates : undefined;
  const a = await loadAnalysis(parcel.id, parcel.geometry, { canopy: true, frost: c ? { lastSpringDoy: c.lastSpring[32][50], firstFallDoy: c.firstFall[32][50] } : undefined });
  const design = await getDesign(`design-${parcel.id}`);
  const objects = design?.objects ?? [];
  const crops = cropShadeObjects(objects, activePlantings(await plantingsForParcel(parcel.id), new Date().getFullYear()), a.frame);
  const offset = localOffsetMin();
  const times = samples.map(([t]) => new Date(t));
  const modeled = modeledSunSeries(a, [...objects, ...crops], sensor.location.lat, sensor.location.lon, times);
  const byT = new Map(times.map((d, i) => [d.getTime(), modeled[i] ?? null]));
  const cal = compareSun(samples, sensor.location.lat, sensor.location.lon, (d) => byT.get(d.getTime()) ?? null, (date) => clearDays.has(date), (t) => localDate(t, offset).date);
  const stored: StoredCalibration = { ...cal, computedAt: new Date().toISOString(), sensorId: sensor.id };
  await kvSet(KEY(sensor.id), JSON.stringify(stored));
  return stored;
}
