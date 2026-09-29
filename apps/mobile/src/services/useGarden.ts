/** Loads everything the planting screens share for one parcel: profile, design, plantings, site conditions. */
import type { Design, SiteConditions } from '@plotwright/core';
import { humidityClimatology, type SiteProfile } from '@plotwright/providers';
import { useCallback, useEffect, useState } from 'react';
import { getOrCreateDesign } from '../db/designs';
import { getParcel, getSiteProfile, type ParcelRecord } from '../db/parcels';
import { plantingsForParcel, type Planting } from '../db/plantings';
import { siteConditions } from './garden';
import { http } from './http';

export interface GardenState {
  parcel: ParcelRecord;
  profile?: SiteProfile;
  design: Design;
  plantings: Planting[];
  site: SiteConditions;
  /** Source line for the summer humidity used in disease-pressure scoring. */
  humiditySource?: string;
}

export function useGarden(parcelId: string | undefined): { state: GardenState | null; error: string | null; reload: () => Promise<void> } {
  const [state, setState] = useState<GardenState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!parcelId) return;
    try {
      const parcel = await getParcel(parcelId);
      if (!parcel) return setError('This property is no longer on this device.');
      const [profile, design, plantings] = await Promise.all([getSiteProfile(parcelId), getOrCreateDesign(parcelId), plantingsForParcel(parcelId)]);
      let rh: number | undefined, humiditySource: string | undefined;
      if (profile) {
        const h = await humidityClimatology(http, profile.centroid);
        if (h.status === 'ok') (rh = h.value.summer), (humiditySource = h.attribution.source);
      }
      setState({ parcel, profile, design, plantings, site: siteConditions(profile, rh), humiditySource });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [parcelId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, error, reload: load };
}
