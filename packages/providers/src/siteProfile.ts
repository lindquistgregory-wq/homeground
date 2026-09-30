/**
 * SiteProfileService (§3): assembles every Phase 1 layer for a parcel. Each layer independently
 * resolves to data-with-attribution or an explicit "unavailable" reason; one failing service never
 * blocks the others. Elevation is fetched first because the frost engine needs it.
 */
import { areaM2, centroid, perimeterM, type Areal, type LatLon, type Layer } from '@plotwright/core';
import type { HttpClient } from './http';
import { parcelElevation, type ElevationSummary } from './elevation';
import { hardinessZone, type HardinessZone, type ZoneTable } from './hardiness';
import { parcelClimate, type ClimateSummary } from './climate';
import { parcelSoils, type SoilSummary } from './soils';
import { parcelFlood, parcelWater, type FloodSummary, type WaterSummary } from './hazards';
import { reverseCensus, type CensusPlace } from './geocode';
import { USGS_IMAGERY } from './basemaps';

/** 2: climate curves, chill hours and peak summer heat for the planting guide (Phase 3). */
export const SITE_PROFILE_VERSION = 2;

export interface SiteProfile {
  version: number;
  computedAt: string;
  centroid: LatLon;
  areaM2: number;
  perimeterM: number;
  place: CensusPlace;
  elevation: Layer<ElevationSummary>;
  hardiness: Layer<HardinessZone>;
  climate: Layer<ClimateSummary>;
  soils: Layer<SoilSummary>;
  flood: Layer<FloodSummary>;
  water: Layer<WaterSummary>;
  imagery: { source: string; attribution: string; captureNote: string };
  /** Milliseconds each layer took, for the < 30 s cold / < 2 s cached acceptance targets. */
  timings: Record<string, number>;
  /** How many layers came from cache vs network is not tracked per layer yet; total wall time is. */
  totalMs: number;
}

export interface SiteProfileDeps {
  http: HttpClient;
  zoneTable?: ZoneTable;
  now?: () => number;
  lapseRateCPerKm?: number;
}

export type ProgressFn = (layer: keyof SiteProfile, status: 'started' | 'done') => void;

export async function buildSiteProfile(
  deps: SiteProfileDeps,
  boundary: Areal,
  known: Partial<CensusPlace> & { zip?: string } = {},
  onProgress: ProgressFn = () => {},
): Promise<SiteProfile> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const timings: Record<string, number> = {};
  const timed = async <T>(name: keyof SiteProfile, fn: () => Promise<T>): Promise<T> => {
    const s = now();
    onProgress(name, 'started');
    try {
      return await fn();
    } finally {
      timings[name] = now() - s;
      onProgress(name, 'done');
    }
  };

  const c = centroid(boundary);
  const placeP = timed('place', async (): Promise<CensusPlace> => {
    if (known.countyFips && (known.zcta || known.zip)) return { ...known, zcta: known.zcta ?? known.zip };
    try {
      return { ...(await reverseCensus(deps.http, c.lat, c.lon)), ...stripUndefined(known) };
    } catch {
      return { ...known };
    }
  });
  const elevationP = timed('elevation', () => parcelElevation(deps.http, boundary));
  const soilsP = timed('soils', () => parcelSoils(deps.http, boundary));
  const floodP = timed('flood', () => parcelFlood(deps.http, boundary));
  const waterP = timed('water', () => parcelWater(deps.http, boundary));

  const hardinessP = placeP.then((place) =>
    timed('hardiness', () => hardinessZone(deps.http, known.zip ?? place.zcta, deps.zoneTable)),
  );
  const climateP = elevationP.then((elev) =>
    timed('climate', () =>
      parcelClimate(
        deps.http,
        { ...c, elevationM: elev.status === 'ok' ? elev.value.centroidM : null },
        { lapseRateCPerKm: deps.lapseRateCPerKm },
      ),
    ),
  );

  const [place, elevation, hardiness, climate, soils, flood, water] = await Promise.all([
    placeP, elevationP, hardinessP, climateP, soilsP, floodP, waterP,
  ]);

  return {
    version: SITE_PROFILE_VERSION,
    computedAt: new Date(now()).toISOString(),
    centroid: c,
    areaM2: areaM2(boundary),
    perimeterM: perimeterM(boundary),
    place,
    elevation,
    hardiness,
    climate,
    soils,
    flood,
    water,
    imagery: { source: USGS_IMAGERY.name, attribution: USGS_IMAGERY.attribution, captureNote: USGS_IMAGERY.captureNote },
    timings,
    totalMs: now() - t0,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
