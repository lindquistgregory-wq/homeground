/**
 * Phase 2 raster providers (§3, §5):
 *  - USGS 3DEP bare-earth DEM windows from the 3DEP ImageServer `exportImage`, requested directly in
 *    the parcel's UTM zone so pixels are square metres (public domain, keyless).
 *  - Which native resolution exists (1 m lidar vs ~10 m) via the TNM Access API, for attribution.
 *  - Meta/WRI Canopy Height Maps v2: zoom-10 quadkey Cloud-Optimized GeoTIFFs (EPSG:3857, uint8 metres)
 *    on AWS Open Data, read with HTTP Range requests and warped onto the parcel grid (CC BY 4.0).
 *  - NASA POWER monthly solar climatology (free; acknowledge NASA).
 */
import {
  bufferSource, cachedSource, fromUtm, makeGrid, openGeoTiff, pickImage, readWindow, sourced, toUtm, unavailable,
  type ByteSource, type Grid, type Inflate, type LatLon, type Layer, type UtmZone, utmEpsg,
} from '@plotwright/core';
import { type HttpClient, TTL } from './http';
import { qs } from './qs';

export const DEM_SOURCE = 'USGS 3D Elevation Program (3DEP)';
export const CANOPY_SOURCE = 'Meta & WRI High Resolution Canopy Height Maps v2';
export const POWER_SOURCE = 'NASA POWER';
const PD = 'Public domain (U.S. Government work)';

export interface UtmBox {
  zone: UtmZone;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

const EXPORT = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';

/** Bare-earth DEM for a UTM box at `cellM` resolution (≤ 4000 px a side). */
export async function fetchDem(http: HttpClient, box: UtmBox, cellM: number, inflate?: Inflate): Promise<Grid> {
  const w = Math.max(2, Math.min(4000, Math.round((box.xmax - box.xmin) / cellM)));
  const h = Math.max(2, Math.min(4000, Math.round((box.ymax - box.ymin) / cellM)));
  const cell = (box.xmax - box.xmin) / w;
  const ymax = box.ymin + h * cell;
  const epsg = utmEpsg(box.zone);
  const url = `${EXPORT}?${qs({
    bbox: `${box.xmin.toFixed(2)},${box.ymin.toFixed(2)},${box.xmax.toFixed(2)},${ymax.toFixed(2)}`,
    bboxSR: epsg,
    imageSR: epsg,
    size: `${w},${h}`,
    format: 'tiff',
    pixelType: 'F32',
    noData: -9999,
    noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  })}`;
  const { data } = await http.bytes(url, { ttlMs: TTL.terrain, timeoutMs: 60_000 });
  const tiff = await openGeoTiff(bufferSource(data));
  const im = tiff.images[0]!;
  if (im.width !== w || im.height !== h) throw new Error(`3DEP returned ${im.width}×${im.height}, expected ${w}×${h}`);
  const px = await readWindow(tiff, im, { x: 0, y: 0, width: w, height: h }, inflate);
  for (let k = 0; k < px.length; k++) if (px[k]! <= -9000) px[k] = NaN;
  return { width: w, height: h, cell, x0: box.xmin, y0: ymax, zone: box.zone, data: px };
}

interface TnmResponse {
  items?: Array<{ title?: string; publicationDate?: string }>;
}

/** Whether 1 m lidar-derived 3DEP exists here (TNM Access), for honest resolution labels. */
export async function lidarAvailability(http: HttpClient, p: LatLon): Promise<{ has1m: boolean; project?: string; published?: string; unknown?: boolean }> {
  const d = 0.002;
  const url = `https://tnmaccess.nationalmap.gov/api/v1/products?${qs({
    datasets: 'Digital Elevation Model (DEM) 1 meter',
    bbox: `${(p.lon - d).toFixed(4)},${(p.lat - d).toFixed(4)},${(p.lon + d).toFixed(4)},${(p.lat + d).toFixed(4)}`,
    max: 5,
  })}`;
  try {
    const { data } = await http.json<TnmResponse>(url, { ttlMs: TTL.terrain });
    const newest = [...(data.items ?? [])].sort((a, b) => String(b.publicationDate).localeCompare(String(a.publicationDate)))[0];
    return { has1m: !!newest, project: newest?.title, published: newest?.publicationDate };
  } catch {
    return { has1m: false, unknown: true };
  }
}

export interface ParcelTerrain {
  /** Fine DEM around the parcel (parcel + buffer), for near shading and design analysis. */
  near: Grid;
  /** Coarse DEM out to several km, for the far horizon. */
  far: Grid;
  has1m: boolean;
  lidarProject?: string;
}

export async function parcelTerrain(
  http: HttpClient,
  parcelBox: UtmBox,
  opts: { bufferM?: number; farRadiusM?: number; inflate?: Inflate } = {},
): Promise<Layer<ParcelTerrain>> {
  try {
    const cx = (parcelBox.xmin + parcelBox.xmax) / 2, cy = (parcelBox.ymin + parcelBox.ymax) / 2;
    const c = fromUtm(cx, cy, parcelBox.zone);
    const lidar = await lidarAvailability(http, c);
    const buf = opts.bufferM ?? 120;
    const nearBox = { ...parcelBox, xmin: parcelBox.xmin - buf, ymin: parcelBox.ymin - buf, xmax: parcelBox.xmax + buf, ymax: parcelBox.ymax + buf };
    const span = Math.max(nearBox.xmax - nearBox.xmin, nearBox.ymax - nearBox.ymin);
    const nearCell = Math.max(lidar.has1m ? 1 : 3, span / 1500); // cap ~1500 px a side
    const R = opts.farRadiusM ?? 5000;
    const [near, far] = await Promise.all([
      fetchDem(http, nearBox, nearCell, opts.inflate),
      fetchDem(http, { zone: parcelBox.zone, xmin: cx - R, ymin: cy - R, xmax: cx + R, ymax: cy + R }, 30, opts.inflate),
    ]);
    return sourced(
      { near, far, has1m: lidar.has1m, lidarProject: lidar.project },
      {
        source: DEM_SOURCE,
        license: PD,
        resolution: lidar.has1m ? `1 m lidar (${lidar.project ?? '3DEP'})` : lidar.unknown ? 'best available 3DEP (lidar availability could not be checked)' : '~10 m (1/3 arc-second); no lidar here yet',
        confidence: lidar.has1m ? 'high' : 'medium',
        basis: 'reference',
        notes: [
          `Near-field grid ${near.cell.toFixed(1)} m over the parcel plus ${buf} m; far horizon from a 30 m grid out to ${(R / 1000).toFixed(0)} km.`,
          ...(lidar.has1m ? [] : ['Without lidar, small berms, ditches and hedges are not in the terrain model.']),
        ],
        url: 'https://www.usgs.gov/3d-elevation-program',
      },
    );
  } catch (e) {
    return unavailable(DEM_SOURCE, `Elevation grid unavailable (${(e as Error).message}).`, true);
  }
}

// ---------------- Canopy heights (Meta/WRI CHMv2) ----------------

const CHM_BASE = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm';
const R_MERC = 6378137;
const mercX = (lon: number) => (R_MERC * lon * Math.PI) / 180;
const mercY = (lat: number) => R_MERC * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

export function quadkey(lon: number, lat: number, z = 10): string {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const s = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  let q = '';
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1);
    q += String((x & m ? 1 : 0) + (y & m ? 2 : 0));
  }
  return q;
}

function rangeSource(http: HttpClient, url: string): ByteSource {
  return cachedSource({ read: async (o, l) => (await http.bytes(url, { range: [o, l], ttlMs: TTL.terrain, timeoutMs: 60_000 })).data }, 256 * 1024);
}

/** Canopy height (m) resampled onto `target`'s cells. NaN where there is no data. */
export async function fetchCanopy(http: HttpClient, target: Grid, inflate?: Inflate): Promise<Grid> {
  const out = makeGrid({ width: target.width, height: target.height, cell: target.cell, x0: target.x0, y0: target.y0, zone: target.zone }, NaN);
  // Corner lon/lats → the set of z10 tiles touched (usually one).
  const corners = [
    fromUtm(target.x0, target.y0, target.zone),
    fromUtm(target.x0 + target.width * target.cell, target.y0, target.zone),
    fromUtm(target.x0, target.y0 - target.height * target.cell, target.zone),
    fromUtm(target.x0 + target.width * target.cell, target.y0 - target.height * target.cell, target.zone),
  ];
  const keys = [...new Set(corners.map((c) => quadkey(c.lon, c.lat)))];
  for (const key of keys) {
    const tiff = await openGeoTiff(rangeSource(http, `${CHM_BASE}/${key}.tif`));
    const im = pickImage(tiff, target.cell * 0.9);
    if (!im.scale || !im.origin) throw new Error('Canopy tile is missing georeferencing');
    // Pixel window in the tile covering the target (in Web Mercator).
    const mx = corners.map((c) => mercX(c.lon)), my = corners.map((c) => mercY(c.lat));
    const px0 = Math.floor((Math.min(...mx) - im.origin[0]) / im.scale[0]) - 1;
    const px1 = Math.ceil((Math.max(...mx) - im.origin[0]) / im.scale[0]) + 1;
    const py0 = Math.floor((im.origin[1] - Math.max(...my)) / im.scale[1]) - 1;
    const py1 = Math.ceil((im.origin[1] - Math.min(...my)) / im.scale[1]) + 1;
    const win = { x: px0, y: py0, width: px1 - px0, height: py1 - py0 };
    const px = await readWindow(tiff, im, win, inflate);
    for (let j = 0; j < target.height; j++)
      for (let i = 0; i < target.width; i++) {
        const k = j * target.width + i;
        if (!Number.isNaN(out.data[k]!)) continue;
        const ll = fromUtm(target.x0 + (i + 0.5) * target.cell, target.y0 - (j + 0.5) * target.cell, target.zone);
        if (quadkey(ll.lon, ll.lat) !== key) continue;
        const u = Math.floor((mercX(ll.lon) - im.origin[0]) / im.scale[0]) - win.x;
        const v = Math.floor((im.origin[1] - mercY(ll.lat)) / im.scale[1]) - win.y;
        if (u < 0 || v < 0 || u >= win.width || v >= win.height) continue;
        const h = px[v * win.width + u]!;
        out.data[k] = h >= 255 ? NaN : h;
      }
  }
  return out;
}

export async function parcelCanopy(http: HttpClient, target: Grid, inflate?: Inflate): Promise<Layer<Grid>> {
  try {
    const g = await fetchCanopy(http, target, inflate);
    return sourced(g, {
      source: CANOPY_SOURCE,
      license: 'CC BY 4.0. Credit: Meta and World Resources Institute, Canopy Height Maps v2 (2026)',
      resolution: '≈1 m (satellite-derived)',
      confidence: 'medium',
      basis: 'modeled',
      notes: [
        'Tree heights are estimated from satellite imagery and can be off by several metres; imagery dates vary.',
        'Tap a tree to correct its height, crown width or leaf type.',
      ],
      url: 'https://registry.opendata.aws/dataforgood-fb-forestsv2/',
    });
  } catch (e) {
    return unavailable(CANOPY_SOURCE, `Canopy heights unavailable (${(e as Error).message}).`, true);
  }
}

// ---------------- NASA POWER solar climatology ----------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

interface PowerResponse {
  properties?: { parameter?: Record<string, Record<string, number>> };
}

/** Monthly mean daily GHI, kWh/m²/day. Coordinates snap to the 0.5° grid so neighbours share cache. */
export async function solarClimatology(http: HttpClient, p: LatLon): Promise<Layer<{ ghi: number[]; annual: number }>> {
  const lat = Math.round(p.lat * 2) / 2, lon = Math.round(p.lon * 2) / 2;
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?${qs({
    parameters: 'ALLSKY_SFC_SW_DWN', community: 'RE', latitude: lat, longitude: lon, format: 'JSON', // RE = kWh/m²/day (AG would be MJ)
  })}`;
  try {
    const { data } = await http.json<PowerResponse>(url, { ttlMs: TTL.static });
    const s = data.properties?.parameter?.ALLSKY_SFC_SW_DWN;
    const ghi = MONTHS.map((m) => s?.[m]);
    if (!s || ghi.some((v) => typeof v !== 'number' || v < 0)) return unavailable(POWER_SOURCE, 'NASA POWER returned no solar data here.', false);
    return sourced({ ghi: ghi as number[], annual: s.ANN ?? (ghi as number[]).reduce((a, b) => a + b, 0) / 12 }, {
      source: POWER_SOURCE,
      license: 'NASA open data; acknowledge "NASA Langley Research Center POWER Project"',
      resolution: '0.5° grid, long-term monthly means',
      confidence: 'medium',
      basis: 'reference',
      url: 'https://power.larc.nasa.gov/',
    });
  } catch (e) {
    return unavailable(POWER_SOURCE, `NASA POWER unreachable (${(e as Error).message}).`, true);
  }
}

/** UTM box around a parcel bbox in lon/lat. */
export function utmBoxFor(bbox: [number, number, number, number], zone?: UtmZone): UtmBox {
  const z = zone ?? toUtm((bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2);
  const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([lon, lat]) => toUtm(lat!, lon!, z));
  return {
    zone: { zone: z.zone, hemisphere: z.hemisphere },
    xmin: Math.min(...pts.map((p) => p.easting)), xmax: Math.max(...pts.map((p) => p.easting)),
    ymin: Math.min(...pts.map((p) => p.northing)), ymax: Math.max(...pts.map((p) => p.northing)),
  };
}
