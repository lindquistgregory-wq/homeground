/**
 * USGS 3DEP point elevation via the Elevation Point Query Service (EPQS v1).
 * Public domain, keyless. Endpoint: https://epqs.nationalmap.gov/v1/json (the old nationalmap.gov/epqs was retired 2023).
 * Real response (2026-09-28): {"location":{...},"locationId":0,"value":"208.355560303","rasterId":73791,"resolution":1}
 */
import { bbox, centroid, sourced, unavailable, type Areal, type Layer, type LatLon } from '@plotwright/core';
import { type HttpClient, TTL } from './http';
import { qs } from './qs';

const EPQS = 'https://epqs.nationalmap.gov/v1/json';
export const EPQS_SOURCE = 'USGS 3DEP (Elevation Point Query Service)';
const LICENSE = 'Public domain (U.S. Government work)';

interface EpqsResponse {
  value?: string | number;
  resolution?: number;
}

export interface PointElevation {
  elevationM: number;
  /** Native resolution of the DEM that answered, metres (1 = lidar-derived 1 m). */
  resolutionM?: number;
  /** Human label for that resolution, e.g. "1 m" or "~3 m (1/9 arc-second)". */
  resolutionLabel?: string;
}

const M_PER_DEGREE = 111_320;

/**
 * EPQS reports the answering raster's cell size in its own units: metres for projected lidar DEMs
 * (e.g. 1), degrees for the geographic national DEMs (e.g. 3.0864e-5 = 1/9 arc-second, 9.259e-5 = 1/3).
 */
export function demResolution(raw: number | undefined): { resolutionM: number; resolutionLabel: string } | undefined {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return undefined;
  if (raw >= 0.01) return { resolutionM: raw, resolutionLabel: `${raw} m` };
  const arcsec = raw * 3600;
  const named = Math.abs(arcsec - 1 / 9) < 0.01 ? '1/9' : Math.abs(arcsec - 1 / 3) < 0.02 ? '1/3' : Math.abs(arcsec - 1) < 0.05 ? '1' : arcsec.toFixed(2);
  const m = raw * M_PER_DEGREE;
  return { resolutionM: m, resolutionLabel: `~${Math.round(m)} m (${named} arc-second)` };
}

export async function pointElevation(http: HttpClient, p: LatLon): Promise<PointElevation | null> {
  const url = `${EPQS}?${qs({ x: p.lon.toFixed(6), y: p.lat.toFixed(6), units: 'Meters', wkid: 4326, includeDate: false })}`;
  const { data } = await http.json<EpqsResponse>(url, { ttlMs: TTL.terrain });
  const v = typeof data.value === 'number' ? data.value : Number(data.value);
  // EPQS returns -1000000 (or a non-number) where there is no data, e.g. offshore.
  if (!Number.isFinite(v) || v <= -1000) return null;
  return { elevationM: v, ...demResolution(typeof data.resolution === 'number' ? data.resolution : undefined) };
}

export interface ElevationSummary {
  centroidM: number;
  minM: number;
  maxM: number;
  /** max − min over the sampled points; a rough indication of relief until Phase 2's DEM analysis. */
  reliefM: number;
  samples: number;
  resolutionM?: number;
}

/** Centroid plus the four bbox-edge midpoints nudged inside the parcel bbox. */
export function elevationSamplePoints(g: Areal): LatLon[] {
  const c = centroid(g);
  const [w, s, e, n] = bbox(g);
  const inset = (a: number, b: number) => a + (b - a) * 0.25;
  return [
    c,
    { lat: inset(n, s), lon: c.lon },
    { lat: inset(s, n), lon: c.lon },
    { lat: c.lat, lon: inset(e, w) },
    { lat: c.lat, lon: inset(w, e) },
  ];
}

export async function parcelElevation(http: HttpClient, g: Areal): Promise<Layer<ElevationSummary>> {
  try {
    const pts = elevationSamplePoints(g);
    const results = await Promise.all(pts.map((p) => pointElevation(http, p).catch(() => null)));
    const center = results[0];
    const vals = results.filter((r): r is PointElevation => r !== null);
    if (!center || vals.length === 0) return unavailable(EPQS_SOURCE, 'No elevation data at this location.', false);
    const es = vals.map((v) => v.elevationM);
    const minM = Math.min(...es), maxM = Math.max(...es);
    const res = center.resolutionM;
    return sourced(
      { centroidM: center.elevationM, minM, maxM, reliefM: maxM - minM, samples: vals.length, resolutionM: res },
      {
        source: EPQS_SOURCE,
        license: LICENSE,
        resolution: center.resolutionLabel ? `${center.resolutionLabel} DEM` : undefined,
        // 1 m and 1/9 arc-second (~3 m) DEMs are lidar-derived; 1/3 arc-second (~10 m) is the national fallback.
        confidence: res !== undefined && res <= 5 ? 'high' : 'medium',
        basis: 'reference',
        notes: [
          `Sampled at ${vals.length} points; full slope/aspect analysis arrives with the DEM engine.`,
          ...(res !== undefined && res > 5 ? ['No lidar DEM here; values come from the ~10 m national DEM.'] : []),
        ],
        url: 'https://www.usgs.gov/3d-elevation-program',
      },
    );
  } catch (e) {
    return unavailable(EPQS_SOURCE, `Elevation service unreachable (${(e as Error).message}).`, true);
  }
}
