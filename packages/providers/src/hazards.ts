/**
 * FEMA National Flood Hazard Layer (layer 28 "Flood Hazard Zones") and USGS National Hydrography
 * Dataset (layers 6 "Flowline - Large Scale", 12 "Waterbody - Large Scale"). Both are free public
 * ArcGIS services. Parcel polygons are sent by POST so long boundaries don't exceed URL limits.
 */
import {
  bbox, bufferBBox, centroid, localFrame, project, sourced, toPolygons, unavailable,
  type Areal, type Layer, type LineString, type Polygon, type Position,
} from '@plotwright/core';
import { type HttpClient, TTL } from './http';
import { qs } from './qs';

export const NFHL_SOURCE = 'FEMA National Flood Hazard Layer';
export const NHD_SOURCE = 'USGS National Hydrography Dataset';
const NFHL_ZONES = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';
const NHD = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer';
const PD = 'Public domain (U.S. Government work)';

function esriPolygon(g: Areal) {
  return JSON.stringify({ rings: toPolygons(g).flat(), spatialReference: { wkid: 4326 } });
}

interface EsriFeatures {
  features?: Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][]; rings?: number[][][] } }>;
  error?: { message?: string };
}

async function postQuery(http: HttpClient, layerUrl: string, params: Record<string, string>, ttlMs: number): Promise<EsriFeatures> {
  const { data } = await http.json<EsriFeatures>(`${layerUrl}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({ f: 'json', ...params }),
    ttlMs,
  });
  if (data.error) throw new Error(data.error.message ?? 'service error');
  return data;
}

// ---------------- Flood ----------------

export interface FloodZone {
  zone: string;
  subtype?: string;
  /** Special Flood Hazard Area (1 % annual chance), i.e. zones A*, V*. */
  sfha: boolean;
  staticBfeFt?: number;
}
export interface FloodSummary {
  zones: FloodZone[];
  inSpecialFloodHazardArea: boolean;
  /** Plain-language one-liner for the profile card. */
  headline: string;
}

/** Trust FEMA's SFHA_TF flag when present; otherwise A and V zones (but not "AREA NOT INCLUDED") are SFHA. */
export function isSfha(zone: string, flag: unknown): boolean {
  const f = typeof flag === 'string' ? flag.trim().toUpperCase() : '';
  if (f === 'T') return true;
  if (f === 'F') return false;
  return /^(A|V)(?!REA)/i.test(zone) && !/OPEN WATER/i.test(zone);
}

export function summarizeFlood(features: EsriFeatures['features']): FloodSummary {
  const seen = new Map<string, FloodZone>();
  for (const f of features ?? []) {
    const a = f.attributes ?? {};
    const zone = String(a.FLD_ZONE ?? '').trim();
    if (!zone) continue;
    const subtype = a.ZONE_SUBTY ? String(a.ZONE_SUBTY).trim() : undefined;
    const bfe = Number(a.STATIC_BFE);
    const key = `${zone}|${subtype ?? ''}`;
    if (!seen.has(key))
      seen.set(key, { zone, subtype, sfha: isSfha(zone, a.SFHA_TF), staticBfeFt: bfe > -9000 && Number.isFinite(bfe) ? bfe : undefined });
  }
  const zones = [...seen.values()].filter((z) => !/^AREA NOT INCLUDED$/i.test(z.zone));
  const notIncluded = seen.size > zones.length;
  const sfha = zones.some((z) => z.sfha);
  const headline = zones.length === 0
    ? notIncluded
      ? 'This area is not included in FEMA flood mapping.'
      : 'No mapped flood zone touches this parcel (the area may be unmapped).'
    : sfha
      ? `Part of this parcel is in a high-risk flood zone (${zones.filter((z) => z.sfha).map((z) => z.zone).join(', ')}).`
      : `Mapped as minimal/moderate flood risk (${zones.map((z) => z.zone).join(', ')}).`;
  return { zones, inSpecialFloodHazardArea: sfha, headline };
}

export async function parcelFlood(http: HttpClient, g: Areal): Promise<Layer<FloodSummary>> {
  try {
    const data = await postQuery(http, NFHL_ZONES, {
      geometry: esriPolygon(g),
      geometryType: 'esriGeometryPolygon',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE',
      returnGeometry: 'false',
    }, TTL.regulatory);
    const summary = summarizeFlood(data.features);
    return sourced(summary, {
      source: NFHL_SOURCE,
      license: PD,
      resolution: 'FIRM panel scale',
      confidence: summary.zones.length ? 'high' : 'medium',
      basis: 'reference',
      notes: ['For insurance or permitting, use the official FEMA Flood Map Service Center determination.'],
      url: 'https://msc.fema.gov/portal/home',
    });
  } catch (e) {
    return unavailable(NFHL_SOURCE, `Flood map service unreachable (${(e as Error).message}).`, true);
  }
}

// ---------------- Water features ----------------

export interface WaterFeature {
  kind: 'stream' | 'waterbody';
  name?: string;
  type?: string;
  geometry: LineString | Polygon;
  /** Distance from the parcel centroid to the feature's nearest edge, metres. */
  distanceM: number;
}
export interface WaterSummary {
  features: WaterFeature[];
  nearest?: WaterFeature;
  searchRadiusM: number;
}

function pick(attrs: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const [k, v] of Object.entries(attrs)) if (names.includes(k.toLowerCase()) && v != null && v !== '') return String(v);
  return undefined;
}

export async function parcelWater(http: HttpClient, g: Areal, searchRadiusM = 300): Promise<Layer<WaterSummary>> {
  try {
    const [w, s, e, n] = bufferBBox(bbox(g), searchRadiusM);
    const envelope = JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n, spatialReference: { wkid: 4326 } });
    const common = {
      geometry: envelope, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: 'gnis_name,ftype', returnGeometry: 'true',
    };
    const [flow, body] = await Promise.all([
      postQuery(http, `${NHD}/6`, common, TTL.terrain),
      postQuery(http, `${NHD}/12`, common, TTL.terrain),
    ]);
    const c = centroid(g);
    const frame = localFrame(c);
    const [cx, cy] = project(frame, [c.lon, c.lat]);
    // Distance from the centroid to the nearest segment of the feature, in ground metres.
    const dist = (coords: Position[]) => {
      const pts = coords.map((p) => project(frame, p));
      let best = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i]!;
        const [bx, by] = pts[Math.min(i + 1, pts.length - 1)]!;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx - cx, ay + t * dy - cy));
      }
      return best / frame.scale;
    };

    const features: WaterFeature[] = [];
    for (const f of flow.features ?? [])
      for (const path of f.geometry?.paths ?? []) {
        const coords = path.map((p) => [p[0]!, p[1]!] as Position);
        if (coords.length < 2) continue;
        features.push({ kind: 'stream', name: pick(f.attributes ?? {}, 'gnis_name'), type: pick(f.attributes ?? {}, 'ftype'), geometry: { type: 'LineString', coordinates: coords }, distanceM: dist(coords) });
      }
    for (const f of body.features ?? []) {
      const rings = (f.geometry?.rings ?? []).map((r) => r.map((p) => [p[0]!, p[1]!] as Position));
      if (!rings[0] || rings[0].length < 4) continue;
      features.push({ kind: 'waterbody', name: pick(f.attributes ?? {}, 'gnis_name'), type: pick(f.attributes ?? {}, 'ftype'), geometry: { type: 'Polygon', coordinates: rings }, distanceM: dist(rings[0]) });
    }
    features.sort((a, b) => a.distanceM - b.distanceM);
    return sourced({ features, nearest: features[0], searchRadiusM }, {
      source: NHD_SOURCE,
      license: PD,
      resolution: 'High resolution (1:24,000 or better)',
      confidence: 'medium',
      basis: 'reference',
      notes: ['Small ditches, springs and seasonal streams may be missing; check setback rules with your county.'],
      url: 'https://www.usgs.gov/national-hydrography',
    });
  } catch (e) {
    return unavailable(NHD_SOURCE, `Hydrography service unreachable (${(e as Error).message}).`, true);
  }
}
