/**
 * County/state ArcGIS REST parcel lookup (§2.2 strategy 1).
 * Privacy (§2.2): we request ONLY the allow-listed id/acreage fields via `outFields`, so owner names
 * and mailing addresses are never downloaded; `sanitizeAttributes` is a second line of defence.
 */
import { areaM2, normalizeAreal, pointInAreal, ringSignedAreaDeg, type Areal, type LatLon, type Ring } from '@plotwright/core';
import type { ParcelEndpoint, ParcelRegistry } from '@plotwright/data';
import { type HttpClient, HttpError, TTL } from '../http';
import { hostname, qs } from '../qs';

export interface ParcelCandidate {
  geometry: Areal;
  parcelId?: string;
  /** Acreage as published by the source (may differ from the computed area). */
  publishedAcres?: number;
  /** Area computed on-device in the parcel's UTM zone. */
  computedAreaM2: number;
  endpointId: string;
  attribution: string;
  license: string;
  displayOnly: boolean;
  containsPoint: boolean;
}

/** Patterns that must never be stored even if a service returns them. */
const PII_FIELD = /owner|own_?n|ownr|mail|pstl|name|addr|adres|grantee|grantor|taxpayer|care_?of|phone|email|contact/i;

export function sanitizeAttributes(attrs: Record<string, unknown>, allow: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    if (!(k in attrs) || PII_FIELD.test(k)) continue;
    out[k] = attrs[k];
  }
  return out;
}

export function endpointsFor(registry: ParcelRegistry, countyFips: string | undefined, extra: ParcelEndpoint[] = []): ParcelEndpoint[] {
  if (!countyFips || countyFips.length !== 5) return [];
  const stateFips = countyFips.slice(0, 2);
  const all = [...extra, ...registry.endpoints];
  const county = all.filter((e) => e.coverage.stateFips === stateFips && e.coverage.countyFips?.includes(countyFips));
  const statewide = all.filter((e) => e.coverage.stateFips === stateFips && !e.coverage.countyFips);
  const seen = new Set<string>();
  return [...county, ...statewide].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

/** Merge a remote registry over the bundled one; newer `verifiedAt` wins per id. */
export function mergeRegistries(bundled: ParcelRegistry, remote: ParcelRegistry | undefined): ParcelRegistry {
  if (!remote) return bundled;
  const byId = new Map(bundled.endpoints.map((e) => [e.id, e]));
  for (const e of remote.endpoints) {
    const cur = byId.get(e.id);
    if (!cur || e.verifiedAt > cur.verifiedAt) byId.set(e.id, { ...e, origin: 'remote' });
  }
  return { version: Math.max(bundled.version, remote.version), updatedAt: remote.updatedAt, endpoints: [...byId.values()] };
}

interface EsriPolygon {
  rings?: number[][][];
}
interface EsriFeature {
  attributes?: Record<string, unknown>;
  geometry?: EsriPolygon;
}
interface EsriQueryResponse {
  features?: EsriFeature[];
  error?: { code?: number; message?: string };
}

/**
 * Esri polygons are a flat list of rings: clockwise rings are outer shells, counter-clockwise rings
 * are holes belonging to the shell that contains them.
 */
export function esriRingsToGeoJson(rings: number[][][]): Areal | null {
  const shells: Ring[][] = [];
  const holes: Ring[] = [];
  for (const raw of rings) {
    const ring = raw.filter((p) => p.length >= 2).map((p) => [p[0]!, p[1]!] as [number, number]);
    if (ring.length < 4) continue;
    if (ringSignedAreaDeg(ring) < 0) shells.push([ring]); // clockwise in lon/lat → outer
    else holes.push(ring);
  }
  if (shells.length === 0 && holes.length > 0) {
    // Some servers emit CCW shells; treat all rings as shells in that case.
    for (const h of holes.splice(0)) shells.push([h]);
  }
  for (const hole of holes) {
    const probe = hole[0]!;
    const owner = shells.find((s) => pointInAreal({ lon: probe[0], lat: probe[1] }, { type: 'Polygon', coordinates: [s[0]!] }));
    if (owner) owner.push(hole);
  }
  if (shells.length === 0) return null;
  const g: Areal = shells.length === 1 ? { type: 'Polygon', coordinates: shells[0]! } : { type: 'MultiPolygon', coordinates: shells };
  return normalizeAreal(g);
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function queryParcelAt(http: HttpClient, endpoint: ParcelEndpoint, point: LatLon): Promise<ParcelCandidate[]> {
  const outFields = [endpoint.idField, endpoint.acresField].filter((f): f is string => !!f && !PII_FIELD.test(f));
  const q = qs({
    geometry: `${point.lon.toFixed(7)},${point.lat.toFixed(7)}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.length ? outFields.join(',') : 'OBJECTID',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  const { data } = await http.json<EsriQueryResponse>(`${endpoint.url.replace(/\/+$/, '')}/query?${q}`, { ttlMs: TTL.parcel });
  if (data.error) throw new HttpError(`Parcel service error: ${data.error.message ?? data.error.code}`, null, false, endpoint.url);

  const out: ParcelCandidate[] = [];
  for (const f of data.features ?? []) {
    const geometry = f.geometry?.rings ? esriRingsToGeoJson(f.geometry.rings) : null;
    if (!geometry) continue;
    const attrs = sanitizeAttributes(f.attributes ?? {}, outFields);
    out.push({
      geometry,
      parcelId: endpoint.idField && attrs[endpoint.idField] != null ? String(attrs[endpoint.idField]) : undefined,
      publishedAcres: endpoint.acresField ? toNumber(attrs[endpoint.acresField]) : undefined,
      computedAreaM2: areaM2(geometry),
      endpointId: endpoint.id,
      attribution: endpoint.attribution,
      license: endpoint.license,
      displayOnly: endpoint.displayOnly,
      containsPoint: pointInAreal(point, geometry),
    });
  }
  // Prefer the parcel that actually contains the point, then the smallest (avoids huge ROW/common-area polygons).
  return out.sort((a, b) => Number(b.containsPoint) - Number(a.containsPoint) || a.computedAreaM2 - b.computedAreaM2);
}

export interface ParcelLookupResult {
  candidates: ParcelCandidate[];
  tried: Array<{ endpointId: string; ok: boolean; error?: string }>;
}

/** Try each endpoint covering the county until one returns a parcel. Never throws. */
export async function findParcel(
  http: HttpClient,
  registry: ParcelRegistry,
  countyFips: string | undefined,
  point: LatLon,
  userEndpoints: ParcelEndpoint[] = [],
): Promise<ParcelLookupResult> {
  const tried: ParcelLookupResult['tried'] = [];
  for (const ep of endpointsFor(registry, countyFips, userEndpoints)) {
    try {
      const candidates = await queryParcelAt(http, ep, point);
      tried.push({ endpointId: ep.id, ok: true });
      if (candidates.length) return { candidates, tried };
    } catch (e) {
      tried.push({ endpointId: ep.id, ok: false, error: (e as Error).message });
    }
  }
  return { candidates: [], tried };
}

// ---------- User-contributed endpoints (§2.2 strategy 3, validated on-device) ----------

interface EsriLayerInfo {
  type?: string;
  name?: string;
  geometryType?: string;
  capabilities?: string;
  copyrightText?: string;
  fields?: Array<{ name: string; type?: string; alias?: string }>;
  error?: { message?: string };
}

export interface EndpointValidation {
  ok: boolean;
  problems: string[];
  suggested?: ParcelEndpoint;
  /** Result of a test query at the user's location, when validation got that far. */
  sample?: ParcelCandidate;
}

const ID_FIELD_HINTS = [/^parcel_?id$/i, /^pin$/i, /^parcelid$/i, /^print_?key$/i, /^apn$/i, /^sbl$/i, /parcel.*(no|num|id)/i, /^tax.*id/i];
const ACRE_FIELD_HINTS = [/^gis_?acres$/i, /^calc_?acres$/i, /^acres$/i, /^deed_?acres$/i, /acre/i];

function pickField(fields: string[], hints: RegExp[]): string | undefined {
  for (const h of hints) {
    const f = fields.find((n) => h.test(n) && !PII_FIELD.test(n));
    if (f) return f;
  }
  return undefined;
}

export function normalizeLayerUrl(input: string): string | null {
  const url = input.trim().replace(/\?.*$/, '').replace(/\/query\/?$/i, '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+\/.+\/(MapServer|FeatureServer)\/\d+$/i.test(url)) return null;
  return url;
}

export async function validateUserEndpoint(
  http: HttpClient,
  rawUrl: string,
  countyFips: string,
  testPoint: LatLon,
): Promise<EndpointValidation> {
  const problems: string[] = [];
  const url = normalizeLayerUrl(rawUrl);
  if (!url) return { ok: false, problems: ['Enter an https ArcGIS layer URL ending in /MapServer/<number> or /FeatureServer/<number>.'] };

  let info: EsriLayerInfo;
  try {
    info = (await http.json<EsriLayerInfo>(`${url}?f=json`)).data;
  } catch (e) {
    return { ok: false, problems: [`Could not reach the service: ${(e as Error).message}`] };
  }
  if (info.error) return { ok: false, problems: [`Service error: ${info.error.message ?? 'unknown'}`] };
  if (info.geometryType !== 'esriGeometryPolygon') problems.push('Layer does not contain polygons.');
  if (info.capabilities && !/query/i.test(info.capabilities)) problems.push('Layer does not allow queries.');
  const fieldNames = (info.fields ?? []).map((f) => f.name);

  const suggested: ParcelEndpoint = {
    id: `user-${countyFips}-${Math.abs(hash(url)).toString(36)}`,
    name: info.name ?? 'User-added parcel service',
    coverage: { stateFips: countyFips.slice(0, 2), countyFips: [countyFips] },
    url,
    idField: pickField(fieldNames, ID_FIELD_HINTS),
    acresField: pickField(fieldNames, ACRE_FIELD_HINTS),
    attribution: info.copyrightText?.trim() || hostname(url),
    license: 'User-supplied public service. Terms not reviewed. Displayed on this device only.',
    displayOnly: true,
    verifiedAt: new Date().toISOString().slice(0, 10),
    origin: 'user',
  };
  if (problems.length) return { ok: false, problems, suggested };

  try {
    const [sample] = await queryParcelAt(http, suggested, testPoint);
    if (!sample) return { ok: false, problems: ['The service works but returned no parcel at your location.'], suggested };
    return { ok: true, problems: [], suggested, sample };
  } catch (e) {
    return { ok: false, problems: [`Test query failed: ${(e as Error).message}`], suggested };
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
