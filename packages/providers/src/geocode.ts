/**
 * Geocoding (§2.1). US: Census Bureau Geocoder (public domain, keyless). Non-US: OSM Nominatim,
 * used lightly per its policy — explicit search only (no autocomplete), ≤1 req/s (see http.ts), cached.
 * GPS and tap-on-map skip geocoding entirely but still use `reverseCensus` to get county FIPS and ZCTA.
 */
import { type HttpClient, TTL } from './http';
import { qs } from './qs';

export interface GeocodeResult {
  lat: number;
  lon: number;
  label: string;
  source: 'census' | 'nominatim';
  /** 5-digit county FIPS (state+county), US only. */
  countyFips?: string;
  countyName?: string;
  stateFips?: string;
  zip?: string;
  accuracy: 'address' | 'street' | 'place' | 'unknown';
}

export interface CensusPlace {
  countyFips?: string;
  countyName?: string;
  stateFips?: string;
  zcta?: string;
}

const CENSUS = 'https://geocoding.geo.census.gov/geocoder';

interface CensusCounty {
  GEOID?: string;
  STATE?: string;
  NAME?: string;
}
interface CensusAddressMatch {
  matchedAddress: string;
  coordinates: { x: number; y: number };
  addressComponents?: { zip?: string };
  geographies?: { Counties?: CensusCounty[] };
}
interface CensusAddressResponse {
  result?: { addressMatches?: CensusAddressMatch[] };
}
interface CensusCoordinatesResponse {
  result?: { geographies?: Record<string, Array<Record<string, unknown>>> };
}

export async function geocodeCensus(http: HttpClient, address: string): Promise<GeocodeResult[]> {
  const q = qs({
    address,
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'Counties',
    format: 'json',
  });
  const { data } = await http.json<CensusAddressResponse>(`${CENSUS}/geographies/onelineaddress?${q}`, {
    ttlMs: TTL.geocode,
  });
  return (data.result?.addressMatches ?? []).map((m) => {
    const county = m.geographies?.Counties?.[0];
    return {
      lat: m.coordinates.y,
      lon: m.coordinates.x,
      label: m.matchedAddress,
      source: 'census' as const,
      countyFips: county?.GEOID,
      countyName: county?.NAME,
      stateFips: county?.STATE,
      zip: m.addressComponents?.zip,
      accuracy: 'address' as const,
    };
  });
}

/** County FIPS and ZCTA for a coordinate (GPS / tap-on-map). */
export async function reverseCensus(http: HttpClient, lat: number, lon: number): Promise<CensusPlace> {
  const q = qs({
    x: lon.toFixed(6),
    y: lat.toFixed(6),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'all',
    format: 'json',
  });
  const { data } = await http.json<CensusCoordinatesResponse>(`${CENSUS}/geographies/coordinates?${q}`, {
    ttlMs: TTL.geocode,
  });
  const g = data.result?.geographies ?? {};
  const county = g['Counties']?.[0];
  const zctaLayer = Object.keys(g).find((k) => /ZIP Code Tabulation/i.test(k));
  const zcta = zctaLayer ? g[zctaLayer]?.[0] : undefined;
  return {
    countyFips: typeof county?.GEOID === 'string' ? county.GEOID : undefined,
    countyName: typeof county?.NAME === 'string' ? county.NAME : undefined,
    stateFips: typeof county?.STATE === 'string' ? county.STATE : undefined,
    zcta: typeof zcta?.ZCTA5 === 'string' ? zcta.ZCTA5 : typeof zcta?.GEOID === 'string' ? zcta.GEOID : undefined,
  };
}

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  addresstype?: string;
  address?: { postcode?: string };
}

export async function geocodeNominatim(http: HttpClient, query: string, email?: string): Promise<GeocodeResult[]> {
  const q = qs({ q: query, format: 'jsonv2', addressdetails: '1', limit: '5', email });
  const { data } = await http.json<NominatimItem[]>(`https://nominatim.openstreetmap.org/search?${q}`, {
    ttlMs: TTL.geocode,
  });
  return data.map((d) => ({
    lat: Number(d.lat),
    lon: Number(d.lon),
    label: d.display_name,
    source: 'nominatim' as const,
    zip: d.address?.postcode,
    accuracy: d.addresstype === 'house' || d.addresstype === 'building' ? 'address' : d.addresstype === 'road' ? 'street' : 'place',
  }));
}

/** US-first router: Census for US-looking queries, Nominatim otherwise or as fallback. */
export async function geocode(
  http: HttpClient,
  query: string,
  opts: { region?: 'US' | 'intl'; contactEmail?: string } = {},
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  if (opts.region !== 'intl') {
    const us = await geocodeCensus(http, trimmed).catch(() => []);
    if (us.length > 0 || opts.region === 'US') return us;
  }
  return geocodeNominatim(http, trimmed, opts.contactEmail);
}
