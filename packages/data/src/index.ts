import registry from '../registry/parcel-endpoints.json';

export interface ParcelEndpointCoverage {
  /** 2-digit state FIPS. */
  stateFips: string;
  /** 5-digit county FIPS codes covered. Omit for statewide services. */
  countyFips?: string[];
}

export interface ParcelEndpoint {
  id: string;
  name: string;
  coverage: ParcelEndpointCoverage;
  /** ArcGIS REST layer URL (…/MapServer/<n> or …/FeatureServer/<n>). */
  url: string;
  /** Field holding the parcel identifier. The only attribute fields ever requested are idField and acresField. */
  idField?: string;
  acresField?: string;
  attribution: string;
  license: string;
  /** Terms allow on-screen display only; never export or redistribute the geometry. */
  displayOnly: boolean;
  verifiedAt: string;
  /** Where the entry came from. Bundled/remote entries are curated; user entries live only on that device. */
  origin?: 'bundled' | 'remote' | 'user';
}

export interface ParcelRegistry {
  version: number;
  updatedAt: string;
  endpoints: ParcelEndpoint[];
}

export const bundledParcelRegistry: ParcelRegistry = {
  version: registry.version,
  updatedAt: registry.updatedAt,
  endpoints: (registry.endpoints as ParcelEndpoint[]).map((e) => ({ ...e, origin: 'bundled' as const })),
};

/**
 * Remote copy of the registry on the free static host, so new counties can be added without an app release.
 * Published from this repo's `packages/data/registry` folder via GitHub Pages (see docs/STATIC_HOSTING.md).
 */
export const REMOTE_REGISTRY_URL =
  'https://lindquistgregory-wq.github.io/homeground/registry/parcel-endpoints.json';
export * from './sources';

import zones from '../zones/phzm-zip.json';
/**
 * Bundled ZIP → hardiness-zone table (2023 PHZM). Empty until `pnpm build:zones` has been run; the app
 * then falls back to phzmapi.org per ZIP. Commit the generated file so the table ships offline.
 */
export const bundledZoneTable: Record<string, string> = zones as Record<string, string>;
