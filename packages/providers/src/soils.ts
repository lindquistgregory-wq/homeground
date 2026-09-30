/**
 * USDA-NRCS Soil Data Access (SSURGO) — free REST endpoint that accepts T-SQL with spatial macros.
 * It is a single-threaded federal server, so http.ts limits us to one request at a time and results
 * are cached for months. Two queries:
 *   1. Map units clipped to the parcel with their area (AOI macros). Falls back to a plain
 *      intersection (no areas) if the macro query is rejected.
 *   2. Properties for those map units: drainage, hydrologic group, available water, hydric rating,
 *      farmland class, and the dominant component's surface horizon (texture, pH, organic matter).
 */
import { toPolygons, sourced, unavailable, type Areal, type Layer } from '@plotwright/core';
import { type HttpClient, TTL } from './http';

export const SDA_SOURCE = 'USDA-NRCS Soil Data Access (SSURGO)';
const SDA_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
const LICENSE = 'Public domain (U.S. Government work)';

export interface SoilMapUnit {
  mukey: string;
  symbol?: string;
  name?: string;
  /** Share of the parcel covered, 0–100. Undefined if areas could not be computed. */
  percentOfParcel?: number;
  farmlandClass?: string;
  drainageClass?: string;
  hydrologicGroup?: string;
  /** Available water storage 0–150 cm, cm of water. */
  awsCm0to150?: number;
  hydricPercent?: number;
  dominantComponent?: string;
  dominantComponentPct?: number;
  surface?: { texture?: string; pH?: number; organicMatterPct?: number; depthCm?: number };
}

export interface SoilSummary {
  units: SoilMapUnit[];
  areasComputed: boolean;
}

/** WKT with 7-decimal precision (~1 cm). */
export function toWkt(g: Areal): string {
  const ring = (r: number[][]) => `(${r.map((p) => `${p[0]!.toFixed(7)} ${p[1]!.toFixed(7)}`).join(', ')})`;
  const poly = (rs: number[][][]) => `(${rs.map(ring).join(', ')})`;
  const polys = toPolygons(g);
  return polys.length === 1 ? `POLYGON ${poly(polys[0]!)}` : `MULTIPOLYGON (${polys.map(poly).join(', ')})`;
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function clippedMapunitsQuery(wkt: string): string {
  return [
    '~DeclareGeometry(@aoi)~',
    `select @aoi = geometry::STGeomFromText(${sqlString(wkt)}, 4326)`,
    '~DeclareIdGeomTable(@intersectedPolygonGeometries)~',
    '~GetClippedMapunits(@aoi,polygon,geo,@intersectedPolygonGeometries)~',
    '~DeclareIdGeogTable(@intersectedPolygonGeographies)~',
    '~GetGeogFromGeomWgs84(@intersectedPolygonGeometries,@intersectedPolygonGeographies)~',
    'select id as mukey, sum(geog.STArea()) as area_m2 from @intersectedPolygonGeographies group by id',
  ].join('\n');
}

export function intersectingMukeysQuery(wkt: string): string {
  return `select mukey from SDA_Get_Mukey_from_intersection_with_WktWgs84(${sqlString(wkt)})`;
}

export function propertiesQuery(mukeys: string[]): string {
  const list = mukeys.filter((k) => /^\d+$/.test(k)).join(',');
  return `
SELECT mu.mukey, mu.musym, mu.muname, mu.farmlndcl,
       ma.drclassdcd, ma.hydgrpdcd, ma.aws0150wta, ma.hydclprs,
       c.compname, c.comppct_r,
       h.hzdept_r, h.ph1to1h2o_r, h.om_r, tg.texdesc
FROM mapunit mu
LEFT JOIN muaggatt ma ON ma.mukey = mu.mukey
LEFT JOIN component c ON c.mukey = mu.mukey AND c.cokey =
  (SELECT TOP 1 c2.cokey FROM component c2 WHERE c2.mukey = mu.mukey ORDER BY c2.comppct_r DESC, c2.cokey)
LEFT JOIN chorizon h ON h.cokey = c.cokey AND h.chkey =
  (SELECT TOP 1 h2.chkey FROM chorizon h2 WHERE h2.cokey = c.cokey ORDER BY h2.hzdept_r ASC)
LEFT JOIN chtexturegrp tg ON tg.chkey = h.chkey AND tg.rvindicator = 'Yes'
WHERE mu.mukey IN (${list})`.trim();
}

interface SdaResponse {
  Table?: Array<Array<string | null>>;
}

/** SDA "JSON+COLUMNNAME" puts column names in the first row. */
export function parseSdaTable(resp: SdaResponse): Array<Record<string, string | null>> {
  const [head, ...rows] = resp.Table ?? [];
  if (!head) return [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [String(h).toLowerCase(), r[i] ?? null])));
}

async function runSda(http: HttpClient, query: string): Promise<Array<Record<string, string | null>>> {
  const { data } = await http.json<SdaResponse>(SDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, format: 'JSON+COLUMNNAME' }),
    ttlMs: TTL.terrain,
    timeoutMs: 45_000,
  });
  return parseSdaTable(data);
}

const n = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const s = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? undefined : v);

export function buildSoilUnits(
  areas: Array<{ mukey: string; areaM2?: number }>,
  props: Array<Record<string, string | null>>,
): SoilMapUnit[] {
  const total = areas.reduce((a, x) => a + (x.areaM2 ?? 0), 0);
  const byKey = new Map(props.map((p) => [String(p.mukey), p]));
  return areas
    .map(({ mukey, areaM2 }) => {
      const p = byKey.get(mukey) ?? {};
      const depth = n(p.hzdept_r);
      return {
        mukey,
        symbol: s(p.musym),
        name: s(p.muname),
        percentOfParcel: total > 0 && areaM2 !== undefined ? (areaM2 / total) * 100 : undefined,
        farmlandClass: s(p.farmlndcl),
        drainageClass: s(p.drclassdcd),
        hydrologicGroup: s(p.hydgrpdcd),
        awsCm0to150: n(p.aws0150wta),
        hydricPercent: n(p.hydclprs),
        dominantComponent: s(p.compname),
        dominantComponentPct: n(p.comppct_r),
        surface: { texture: s(p.texdesc), pH: n(p.ph1to1h2o_r), organicMatterPct: n(p.om_r), depthCm: depth },
      } satisfies SoilMapUnit;
    })
    .sort((a, b) => (b.percentOfParcel ?? 0) - (a.percentOfParcel ?? 0));
}

export async function parcelSoils(http: HttpClient, g: Areal): Promise<Layer<SoilSummary>> {
  const wkt = toWkt(g);
  try {
    let areas: Array<{ mukey: string; areaM2?: number }>;
    let areasComputed = true;
    try {
      areas = (await runSda(http, clippedMapunitsQuery(wkt)))
        .filter((r) => r.mukey)
        .map((r) => ({ mukey: String(r.mukey), areaM2: n(r.area_m2) }));
    } catch {
      areasComputed = false;
      areas = (await runSda(http, intersectingMukeysQuery(wkt))).filter((r) => r.mukey).map((r) => ({ mukey: String(r.mukey) }));
    }
    if (areas.length === 0) return unavailable(SDA_SOURCE, 'No SSURGO soil survey covers this parcel.', false);
    const props = await runSda(http, propertiesQuery(areas.map((a) => a.mukey)));
    return sourced(
      { units: buildSoilUnits(areas, props), areasComputed },
      {
        source: SDA_SOURCE,
        license: LICENSE,
        resolution: 'SSURGO map units (typically 1:12,000–1:24,000)',
        confidence: 'medium',
        basis: 'reference',
        notes: [
          'Soil survey map units can include small areas of other soils; a soil test tells you what is in your beds.',
          ...(areasComputed ? [] : ['Share of parcel could not be computed; map units are listed without percentages.']),
        ],
        url: 'https://websoilsurvey.nrcs.usda.gov/',
      },
    );
  } catch (e) {
    return unavailable(SDA_SOURCE, `Soil Data Access unreachable (${(e as Error).message}).`, true);
  }
}
