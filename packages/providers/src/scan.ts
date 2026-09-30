/**
 * Regional soil temperature and moisture from the USDA NRCS Soil Climate Analysis Network (SCAN),
 * via the free, keyless AWDB REST API (§3 table: "NRCS SCAN / SNOTEL, nearest station, flagged as
 * regional"). The planting calendar prefers the user's own soil sensor, then this, then the model.
 * There is no spatial search: the station list is fetched once (cached) and the nearest is picked here.
 */
import { distanceM, sourced, unavailable, type LatLon, type Layer } from '@plotwright/core';
import { TTL, type HttpClient } from './http';
import { qs } from './qs';

export const SCAN_SOURCE = 'USDA NRCS Soil Climate Analysis Network (SCAN)';
const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1';

export interface ScanStation {
  triplet: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number;
  /** Fixed offset of the station's local standard time from UTC, hours (no daylight saving). */
  tzHours: number;
}

export interface RegionalSoilDay {
  /** Station-local date, YYYY-MM-DD. */
  date: string;
  doy: number;
  /** Daily mean soil temperature at 2 in, °F. */
  soil2inF?: number;
  soil4inF?: number;
  /** Mean volumetric soil moisture at 2 in, %. */
  moisture2inPct?: number;
}

export interface RegionalSoil {
  station: ScanStation & { distanceKm: number; elevationDiffM: number | null };
  days: RegionalSoilDay[];
}

interface AwdbStation { stationTriplet: string; name: string; latitude: number; longitude: number; elevation?: number; dataTimeZone?: number }
interface AwdbData { stationTriplet: string; data?: Array<{ stationElement: { elementCode: string; heightDepth: number; storedUnitCode?: string }; values?: Array<{ date: string; value: number | null }> }> }

export async function scanStations(http: HttpClient): Promise<ScanStation[]> {
  const r = await http.json<AwdbStation[]>(`${AWDB}/stations?${qs({ stationTriplets: '*:*:SCAN', returnStationElements: false, activeOnly: true })}`, { ttlMs: 30 * 24 * 3_600_000 });
  return r.data
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
    .map((s) => ({ triplet: s.stationTriplet, name: s.name, lat: s.latitude, lon: s.longitude, elevationM: (s.elevation ?? 0) * 0.3048, tzHours: s.dataTimeZone ?? 0 }));
}

/** Nearest station within `maxKm`, or null. */
export function nearestScan(stations: ScanStation[], p: LatLon, maxKm = 100): (ScanStation & { distanceKm: number }) | null {
  let best: (ScanStation & { distanceKm: number }) | null = null;
  for (const s of stations) {
    const d = distanceM(p, { lat: s.lat, lon: s.lon }) / 1000;
    if (d <= maxKm && (!best || d < best.distanceKm)) best = { ...s, distanceKm: d };
  }
  return best;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "yyyy-MM-dd HH:mm" in the station's local standard time. */
function awdbDate(utcMs: number, tzHours: number): string {
  const d = new Date(utcMs + tzHours * 3_600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const doyOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
};

/** Aggregate hourly AWDB values into daily means per element (dates are station-local already). */
export function parseScanHourly(body: AwdbData[]): RegionalSoilDay[] {
  const days = new Map<string, { t2: number[]; t4: number[]; m2: number[] }>();
  for (const st of body) {
    for (const series of st.data ?? []) {
      const { elementCode, heightDepth, storedUnitCode } = series.stationElement;
      for (const v of series.values ?? []) {
        if (v.value === null || !Number.isFinite(v.value)) continue;
        const date = v.date.slice(0, 10);
        const d = days.get(date) ?? { t2: [], t4: [], m2: [] };
        days.set(date, d);
        const f = elementCode === 'STO' && storedUnitCode === 'degC' ? (v.value * 9) / 5 + 32 : v.value;
        if (elementCode === 'STO' && heightDepth === -2) d.t2.push(f);
        if (elementCode === 'STO' && heightDepth === -4) d.t4.push(f);
        if (elementCode === 'SMS' && heightDepth === -2) d.m2.push(v.value);
      }
    }
  }
  const mean = (a: number[]) => (a.length >= 12 ? a.reduce((s, x) => s + x, 0) / a.length : undefined); // need at least half a day of hours
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({ date, doy: doyOf(date), soil2inF: mean(d.t2), soil4inF: mean(d.t4), moisture2inPct: mean(d.m2) }))
    .filter((d) => d.soil2inF !== undefined || d.soil4inF !== undefined || d.moisture2inPct !== undefined);
}

/**
 * The last `days` of daily soil temperature and moisture at the nearest SCAN station (≤ 100 km).
 * Flagged regional: a station under sod tens of kilometres away is a guide, not your garden bed.
 */
export async function regionalSoil(http: HttpClient, p: LatLon & { elevationM?: number | null }, days = 30, now = Date.now()): Promise<Layer<RegionalSoil>> {
  try {
    const st = nearestScan(await scanStations(http), p);
    if (!st) return unavailable(SCAN_SOURCE, 'No SCAN soil station within 100 km.', false);
    const url = `${AWDB}/data?${qs({
      stationTriplets: st.triplet, elements: 'STO:-2:1,STO:-4:1,SMS:-2:1', duration: 'HOURLY',
      beginDate: awdbDate(now - days * 86_400_000, st.tzHours), endDate: awdbDate(now, st.tzHours),
    })}`;
    const r = await http.json<AwdbData[]>(url, { ttlMs: 6 * 3_600_000 });
    const out = parseScanHourly(r.data);
    if (!out.length) return unavailable(SCAN_SOURCE, `${st.name} (SCAN) has no recent soil readings.`, true);
    const elevationDiffM = p.elevationM === null || p.elevationM === undefined ? null : p.elevationM - st.elevationM;
    return sourced({ station: { ...st, elevationDiffM }, days: out }, {
      source: SCAN_SOURCE, license: 'Public domain (U.S. Government work)', resolution: `station ${Math.round(st.distanceKm)} km away`,
      confidence: st.distanceKm < 40 && Math.abs(elevationDiffM ?? 0) < 200 ? 'medium' : 'low', basis: 'measured', retrievedAt: new Date(r.storedAt).toISOString(),
      notes: [
        `Regional reading from ${st.name}, ${Math.round(st.distanceKm)} km away${elevationDiffM !== null ? ` and ${Math.abs(Math.round(elevationDiffM))} m ${elevationDiffM > 0 ? 'lower' : 'higher'} than your parcel` : ''}, measured under sod. Bare, sunny beds warm faster; a soil thermometer or sensor in your bed is better.`,
        ...(r.stale ? ['Offline: showing the last readings downloaded.'] : []),
      ],
      url: 'https://www.nrcs.usda.gov/resources/data-and-reports/soil-climate-analysis-network',
    });
  } catch (e) {
    return unavailable(SCAN_SOURCE, `SCAN soil network unreachable (${(e as Error).message}).`, true);
  }
}
