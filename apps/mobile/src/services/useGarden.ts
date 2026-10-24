/** Loads everything the planting screens share for one parcel: profile, design, plantings, site conditions. */
import type { Design, SiteConditions } from '@plotwright/core';
import { SITE_PROFILE_VERSION, humidityClimatology, type SiteProfile } from '@plotwright/providers';
import { useCallback, useEffect, useState } from 'react';
import { getOrCreateDesign } from '../db/designs';
import { getParcel, getSiteProfile, type ParcelRecord } from '../db/parcels';
import { plantingsForParcel, type Planting } from '../db/plantings';
import { siteConditions } from './garden';
import { soilSourceFor, type SoilSource } from './sensorInsights';
import { http } from './http';

export interface GardenState {
  parcel: ParcelRecord;
  profile?: SiteProfile;
  design: Design;
  plantings: Planting[];
  site: SiteConditions;
  /** Source line for the summer humidity used in disease-pressure scoring. */
  humiditySource?: string;
  /** Profile was built by an older version and lacks what the planting guide needs (e.g. climate curves). */
  profileStale: boolean;
  /** Soil temperature for sowing dates: your sensor → regional SCAN station → model. */
  soil: SoilSource;
}

/** Everything the planting screens share for one parcel, or null when the parcel is gone. */
export async function gardenState(parcelId: string): Promise<GardenState | null> {
  const parcel = await getParcel(parcelId);
  if (!parcel) return null;
  const [profile, design, plantings] = await Promise.all([getSiteProfile(parcelId), getOrCreateDesign(parcelId), plantingsForParcel(parcelId)]);
  let rh: number | undefined, humiditySource: string | undefined;
  if (profile) {
    // Humidity only refines disease scoring: never let a slow first download hold the screen up.
    const h = await Promise.race([humidityClimatology(http, profile.centroid), new Promise<null>((r) => setTimeout(() => r(null), 8000))]).catch(() => null);
    if (h?.status === 'ok') (rh = h.value.summer), (humiditySource = h.attribution.source);
  }
  const site = siteConditions(profile, rh);
  // The regional soil station is a network lookup too: give up after a few seconds rather than hold the screen.
  const none: SoilSource = { kind: 'none', label: 'soil temperature unavailable' };
  const soil = await Promise.race([soilSourceFor(parcelId, profile, site), new Promise<SoilSource>((r) => setTimeout(() => r(none), 8000))]).catch(() => none);
  return { parcel, profile, design, plantings, site, humiditySource, profileStale: !profile || profile.version < SITE_PROFILE_VERSION, soil };
}

export function useGarden(parcelId: string | undefined): { state: GardenState | null; error: string | null; reload: () => Promise<void> } {
  const [state, setState] = useState<GardenState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!parcelId) return;
    try {
      const st = await gardenState(parcelId);
      if (!st) return setError('This property is no longer on this device.');
      setState(st);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [parcelId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, error, reload: load };
}
