/**
 * Weather for planting alerts (§7.3) and disease pressure:
 *  - NWS api.weather.gov (free, keyless; requires an identifying User-Agent, which HttpClient sends).
 *    /points/{lat},{lon} → the forecast office grid, then the 7-day, 12-hour forecast periods.
 *    US only. Forecasts are cached for 1 hour; the grid lookup for 30 days.
 *  - NASA POWER monthly relative-humidity climatology (RH2M), for fungal-disease pressure.
 */
import { sourced, unavailable, type ForecastPeriod, type LatLon, type Layer } from '@plotwright/core';
import { type HttpClient, TTL, DAY } from './http';
import { qs } from './qs';

export const NWS_SOURCE = 'National Weather Service (api.weather.gov)';

interface NwsPoints {
  properties?: {
    forecast?: string;
    timeZone?: string;
    relativeLocation?: { properties?: { city?: string; state?: string } };
  };
}
interface NwsPeriod {
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit?: string;
  windSpeed?: string;
  shortForecast?: string;
}
interface NwsForecast {
  properties?: { updated?: string; generatedAt?: string; periods?: NwsPeriod[] };
}

/** "10 to 15 mph" → 15; "5 mph" → 5. */
export function parseWindMph(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!nums.length) return undefined;
  const v = Math.max(...nums);
  return /km\/h/i.test(s) ? v * 0.621371 : v;
}

export function parseNwsPeriods(f: NwsForecast): ForecastPeriod[] {
  return (f.properties?.periods ?? []).map((p) => ({
    start: p.startTime,
    end: p.endTime,
    isNight: !p.isDaytime,
    temperatureF: p.temperatureUnit === 'C' ? (p.temperature * 9) / 5 + 32 : p.temperature,
    windMph: parseWindMph(p.windSpeed),
    summary: p.shortForecast,
  }));
}

export interface Forecast {
  periods: ForecastPeriod[];
  place?: string;
  timeZone?: string;
  updated?: string;
}

export async function nwsForecast(http: HttpClient, p: LatLon): Promise<Layer<Forecast>> {
  try {
    const pts = await http.json<NwsPoints>(`https://api.weather.gov/points/${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, {
      ttlMs: 30 * DAY, headers: { Accept: 'application/geo+json' },
    });
    const url = pts.data.properties?.forecast;
    if (!url || !/^https:\/\/api\.weather\.gov\//.test(url)) return unavailable(NWS_SOURCE, 'No NWS forecast for this location (the NWS covers the US only).', false);
    const fc = await http.json<NwsForecast>(url, { ttlMs: TTL.forecast, headers: { Accept: 'application/geo+json' } });
    const rel = pts.data.properties?.relativeLocation?.properties;
    return sourced(
      { periods: parseNwsPeriods(fc.data), place: rel?.city ? `${rel.city}, ${rel.state}` : undefined, timeZone: pts.data.properties?.timeZone, updated: fc.data.properties?.updated },
      {
        source: NWS_SOURCE, license: 'Public domain (U.S. Government work)', resolution: '2.5 km forecast grid, 12-hour periods',
        confidence: 'medium', basis: 'modeled', retrievedAt: new Date(fc.storedAt).toISOString(),
        notes: [
          'Forecast lows are air temperature about 5 ft up; on clear, calm nights the ground and low spots can be several degrees colder.',
          ...(fc.stale ? ['Offline: showing the last forecast downloaded.'] : []),
        ],
        url: 'https://www.weather.gov/',
      },
    );
  } catch (e) {
    return unavailable(NWS_SOURCE, `Forecast unavailable (${(e as Error).message}).`, true);
  }
}

// ---------------- Humidity climatology ----------------

export const POWER_RH_SOURCE = 'NASA POWER (relative humidity climatology)';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

interface PowerResponse {
  properties?: { parameter?: Record<string, Record<string, number>> };
}

/** Monthly mean relative humidity at 2 m (%), and the June–August mean. */
export async function humidityClimatology(http: HttpClient, p: LatLon): Promise<Layer<{ monthly: number[]; summer: number }>> {
  const lat = Math.round(p.lat * 2) / 2, lon = Math.round(p.lon * 2) / 2;
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?${qs({ parameters: 'RH2M', community: 'AG', latitude: lat, longitude: lon, format: 'JSON' })}`;
  try {
    const { data } = await http.json<PowerResponse>(url, { ttlMs: TTL.static });
    const s = data.properties?.parameter?.RH2M;
    const monthly = MONTHS.map((m) => s?.[m]);
    if (!s || monthly.some((v) => typeof v !== 'number' || v < 0 || v > 100)) return unavailable(POWER_RH_SOURCE, 'NASA POWER returned no humidity data here.', false);
    const m = monthly as number[];
    return sourced({ monthly: m, summer: (m[5]! + m[6]! + m[7]!) / 3 }, {
      source: POWER_RH_SOURCE, license: 'NASA open data; acknowledge "NASA Langley Research Center POWER Project"',
      resolution: '0.5° grid, long-term monthly means', confidence: 'medium', basis: 'reference', url: 'https://power.larc.nasa.gov/',
    });
  } catch (e) {
    return unavailable(POWER_RH_SOURCE, `NASA POWER unreachable (${(e as Error).message}).`, true);
  }
}
