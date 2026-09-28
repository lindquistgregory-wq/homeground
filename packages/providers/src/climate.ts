/**
 * NOAA NCEI U.S. Climate Normals 1991–2020 → parcel-adjusted frost dates.
 * Two keyless calls: the NCEI Search Service finds stations in a box around the parcel, then the
 * Access Data Service returns only the elements the frost engine needs for the nearest few.
 * Normals are static for a decade, so both are cached for a year.
 */
import {
  bufferBBox, distanceM, estimateFrostDates, normalsDataTypes, parseNormalsRow, sourced, unavailable,
  type FrostEstimate, type LatLon, type Layer, type StationNormals,
} from '@homeground/core';
import { type HttpClient, TTL } from './http';
import { qs } from './qs';

export const NORMALS_SOURCE = 'NOAA NCEI U.S. Climate Normals 1991–2020';
const LICENSE = 'Public domain (U.S. Government work)';
const DATASET = 'normals-annualseasonal-1991-2020';

interface SearchResult {
  filePath?: string;
  boundingPoints?: Array<{ coordinates?: number[] }>;
  stations?: Array<{ id?: string; coordinates?: number[]; dataTypes?: unknown[] }>;
}
export interface SearchResponse {
  results?: SearchResult[];
}

export interface StationRef {
  id: string;
  lat: number;
  lon: number;
}

export function parseStationSearch(resp: SearchResponse): StationRef[] {
  const out: StationRef[] = [];
  for (const r of resp.results ?? []) {
    const st = r.stations?.[0];
    const id = st?.id ?? /([A-Z0-9]{11})\.csv$/.exec(r.filePath ?? '')?.[1];
    const coords = st?.coordinates ?? r.boundingPoints?.[0]?.coordinates;
    const [lon, lat] = coords ?? [];
    if (id && Number.isFinite(lon) && Number.isFinite(lat) && usableForFrost(r, id)) out.push({ id, lon: lon!, lat: lat! });
  }
  return out;
}

/**
 * CoCoRaHS volunteer gauges (ids starting "US1") are precipitation-only and crowd populated areas, so
 * they're dropped before choosing which stations to fetch. When the search result says which elements
 * a station has, stations without freeze probabilities are dropped too.
 */
export function usableForFrost(r: SearchResult, id: string): boolean {
  if (/^US1/.test(id)) return false;
  const types = r.stations?.[0]?.dataTypes;
  if (Array.isArray(types) && types.length > 0) {
    const ids = types.map((t) => (typeof t === 'string' ? t : (t as { id?: string })?.id)).filter(Boolean) as string[];
    if (ids.length > 0) return ids.some((t) => /PRBLST-T32FP50/.test(t));
  }
  return true;
}

export async function findNormalsStations(http: HttpClient, p: LatLon, radiusKm = 60): Promise<StationRef[]> {
  const [w, s, e, n] = bufferBBox([p.lon, p.lat, p.lon, p.lat], radiusKm * 1000);
  const url = `https://www.ncei.noaa.gov/access/services/search/v1/data?${qs({
    dataset: DATASET,
    bbox: `${n.toFixed(4)},${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)}`,
    limit: 200,
    offset: 0,
  })}`;
  const { data } = await http.json<SearchResponse>(url, { ttlMs: TTL.static });
  return parseStationSearch(data).sort((a, b) => distanceM(p, a) - distanceM(p, b));
}

export async function fetchStationNormals(http: HttpClient, ids: string[]): Promise<StationNormals[]> {
  if (ids.length === 0) return [];
  const url = `https://www.ncei.noaa.gov/access/services/data/v1?${qs({
    dataset: DATASET,
    stations: ids.join(','),
    dataTypes: normalsDataTypes().join(','),
    includeStationName: 'true',
    includeStationLocation: '1',
    format: 'json',
  })}`;
  const { data } = await http.json<Array<Record<string, unknown>>>(url, { ttlMs: TTL.static });
  return (Array.isArray(data) ? data : []).map(parseNormalsRow).filter((s): s is StationNormals => !!s);
}

export interface ClimateSummary {
  frost: FrostEstimate;
  /** Nearest station's annual normals for context. */
  annual?: { tminF?: number; gddBase50F?: number; precipIn?: number; stationId: string };
}

export async function parcelClimate(
  http: HttpClient,
  p: LatLon & { elevationM: number | null },
  opts: { lapseRateCPerKm?: number; extraShiftDays?: number } = {},
): Promise<Layer<ClimateSummary>> {
  if (p.elevationM === null)
    return unavailable(NORMALS_SOURCE, 'Frost dates need the parcel elevation, which is unavailable.', true);
  try {
    // Try the local radius first, then widen if it yields no usable freeze statistics.
    let stations: StationNormals[] = [];
    let frost: FrostEstimate | null = null;
    let searched = 0;
    for (const radius of [60, 150]) {
      const refs = await findNormalsStations(http, p, radius);
      searched += refs.length;
      if (refs.length === 0) continue;
      stations = await fetchStationNormals(http, refs.slice(0, 12).map((r) => r.id));
      frost = estimateFrostDates({ lat: p.lat, lon: p.lon, elevationM: p.elevationM }, stations, { ...opts, maxRadiusKm: radius });
      if (frost) break;
    }
    if (searched === 0) return unavailable(NORMALS_SOURCE, 'No NOAA normals stations within 150 km.', false);
    if (!frost) return unavailable(NORMALS_SOURCE, 'Nearby stations do not publish freeze statistics.', false);
    const nearestTemp = stations
      .filter((s) => s.tminF.ANN !== undefined)
      .sort((a, b) => distanceM(p, a) - distanceM(p, b))[0];
    return sourced(
      {
        frost,
        annual: nearestTemp && {
          tminF: nearestTemp.tminF.ANN,
          gddBase50F: nearestTemp.gddBase50F,
          precipIn: nearestTemp.precipIn,
          stationId: nearestTemp.stationId,
        },
      },
      {
        source: NORMALS_SOURCE,
        license: LICENSE,
        resolution: 'Station-based, elevation-adjusted',
        confidence: frost.confidence,
        basis: 'modeled',
        notes: frost.notes,
        url: 'https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals',
      },
    );
  } catch (e) {
    return unavailable(NORMALS_SOURCE, `Climate normals unreachable (${(e as Error).message}).`, true);
  }
}
