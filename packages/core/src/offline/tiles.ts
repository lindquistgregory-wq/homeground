/**
 * Offline parcel packs (§10, Pro): which map tiles to save for a parcel. Pure tile math; the app does the
 * downloading. Only public-domain USGS raster layers are saved in bulk (their services allow tile export);
 * the OpenFreeMap vector basemap is left to MapLibre's ordinary cache, since OpenFreeMap's terms don't
 * address bulk offline downloads.
 */

export type Bbox = [west: number, south: number, east: number, north: number];

export interface TileId {
  z: number;
  x: number;
  y: number;
}

const MAX_LAT = 85.05112878;

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)));
}

export function tileRange(b: Bbox, z: number): { x0: number; x1: number; y0: number; y1: number } {
  return { x0: lonToTileX(b[0], z), x1: lonToTileX(b[2], z), y0: latToTileY(b[3], z), y1: latToTileY(b[1], z) };
}

export function tileCount(b: Bbox, minZ: number, maxZ: number): number {
  let n = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(b, z);
    n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  }
  return n;
}

export function* tilesFor(b: Bbox, minZ: number, maxZ: number): Generator<TileId> {
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(b, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield { z, x, y };
  }
}

export function tileUrl(template: string, t: TileId): string {
  return template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
}

/** Grow a bbox by `meters` on every side. */
export function bufferBbox(b: Bbox, meters: number): Bbox {
  const dLat = meters / 111_320;
  const midLat = ((b[1] + b[3]) / 2) * (Math.PI / 180);
  const dLon = meters / (111_320 * Math.max(0.01, Math.cos(midLat)));
  return [b[0] - dLon, Math.max(-MAX_LAT, b[1] - dLat), b[2] + dLon, Math.min(MAX_LAT, b[3] + dLat)];
}

export interface PackLayer {
  id: string;
  template: string;
  /** Deepest zoom the service publishes; the offline map overzooms past it. */
  maxZoom: number;
  /** Rough average tile size, for the size estimate. */
  avgTileKb: number;
}

export interface PackPlan {
  bbox: Bbox;
  minZoom: number;
  layers: Array<{ id: string; template: string; maxZoom: number; tiles: number }>;
  totalTiles: number;
  estimatedMb: number;
  /** Zoom levels dropped to stay under the tile limit. */
  trimmed: boolean;
}

/** Per-pack ceiling, to stay a courteous user of free public services. */
export const PACK_MAX_TILES = 3000;
export const PACK_BUFFER_M = 250;
export const PACK_MIN_ZOOM = 12;

/** Plan a pack: parcel bbox plus a buffer, zoom 12 to each layer's max, trimmed to the tile limit. */
export function planPack(parcelBbox: Bbox, layers: PackLayer[], opts: { bufferM?: number; maxTiles?: number } = {}): PackPlan {
  const bbox = bufferBbox(parcelBbox, opts.bufferM ?? PACK_BUFFER_M);
  const maxTiles = opts.maxTiles ?? PACK_MAX_TILES;
  const out = layers.map((l) => ({ id: l.id, template: l.template, maxZoom: l.maxZoom, avgKb: l.avgTileKb, tiles: tileCount(bbox, PACK_MIN_ZOOM, l.maxZoom) }));
  let trimmed = false;
  const total = () => out.reduce((a, l) => a + l.tiles, 0);
  while (total() > maxTiles) {
    // Drop the deepest zoom of the layer that reaches deepest.
    const deepest = out.reduce((a, l) => (l.maxZoom > a.maxZoom ? l : a));
    if (deepest.maxZoom <= PACK_MIN_ZOOM) break;
    deepest.maxZoom -= 1;
    deepest.tiles = tileCount(bbox, PACK_MIN_ZOOM, deepest.maxZoom);
    trimmed = true;
  }
  return {
    bbox, minZoom: PACK_MIN_ZOOM,
    layers: out.map(({ id, template, maxZoom, tiles }) => ({ id, template, maxZoom, tiles })),
    totalTiles: total(),
    estimatedMb: Math.round((out.reduce((a, l) => a + l.tiles * l.avgKb, 0) / 1024) * 10) / 10,
    trimmed,
  };
}

/** Relative path of a saved tile inside a pack folder: <layer>/<z>/<x>/<y>. */
export const tilePath = (layer: string, t: TileId, ext: string) => `${layer}/${t.z}/${t.x}/${t.y}.${ext}`;
