/**
 * Map sources (§3): all keyless and free for commercial use. MapLibre renders these directly.
 */

export interface RasterSource {
  id: string;
  name: string;
  tiles: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  attribution: string;
  license: string;
  /** What we can honestly say about imagery age. */
  captureNote: string;
}

/** OpenFreeMap vector style (OpenStreetMap data, OpenMapTiles schema). No key, no usage limits. */
export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const OPENFREEMAP_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors';

export const USGS_IMAGERY: RasterSource = {
  id: 'usgs-imagery',
  name: 'Aerial imagery (USGS The National Map)',
  tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 19,
  attribution: 'USDA, USGS The National Map: Orthoimagery',
  license: 'Public domain (U.S. Government work)',
  captureNote:
    'Mostly USDA NAIP aerial photography, usually flown every 2–3 years per state. The service was last refreshed June 2024; exact flight dates vary by area.',
};

export const USGS_TOPO: RasterSource = {
  id: 'usgs-topo',
  name: 'Topographic (USGS The National Map)',
  tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 16,
  attribution: 'USGS The National Map',
  license: 'Public domain (U.S. Government work)',
  captureNote: 'Composite of national datasets; contours from 3DEP.',
};

export const USGS_HILLSHADE: RasterSource = {
  id: 'usgs-hillshade',
  name: 'Shaded relief (USGS The National Map)',
  tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}'],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 16,
  attribution: 'USGS The National Map: 3D Elevation Program',
  license: 'Public domain (U.S. Government work)',
  captureNote: 'Shaded relief from 3DEP elevation.',
};

export const RASTER_SOURCES = [USGS_IMAGERY, USGS_TOPO, USGS_HILLSHADE];

// ---------- Sharper aerial imagery (served by ArcGIS ImageServer exportImage, keyless) ----------

/** An aerial imagery source with its finest pixel size, so the map never zooms past what it holds. */
export interface ImagerySource extends RasterSource {
  /** Finest ground pixel, metres (where the source has it). */
  resolutionM: number;
  /** Plain-language label for the Layers picker. */
  short: string;
  /** Anything the owner still has to confirm before release (e.g. state terms). */
  termsNote?: string;
}

const exportTiles = (base: string) => [`${base}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image`];

/** USGS NAIP Plus: NAIP (about 0.6 m) mixed with sharper state and city orthoimagery (to 6 in) where USGS has it. */
export const USGS_NAIP_PLUS: ImagerySource = {
  id: 'usgs-naip-plus', short: 'USGS NAIP Plus',
  name: 'Aerial imagery (USGS NAIP Plus: NAIP and high-resolution orthoimagery)',
  tiles: exportTiles('https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer'),
  tileSize: 512, minzoom: 0, maxzoom: 20,
  attribution: 'USDA NAIP, USGS The National Map: Orthoimagery',
  license: 'Public domain (U.S. Government work)',
  resolutionM: 0.6,
  captureNote: 'NAIP is flown every 2–3 years per state at about 0.6 m; some areas have sharper state or city imagery (down to 6 in).',
};

/**
 * Statewide orthoimagery programs, by two-digit state FIPS. Add a state only after checking its
 * service answers without a login and its terms allow use in an app.
 */
export const STATE_IMAGERY: Record<string, ImagerySource> = {
  '37': {
    id: 'nc-onemap-ortho', short: 'NC OneMap 6-inch',
    name: 'Aerial imagery (NC OneMap statewide orthoimagery, latest)',
    tiles: exportTiles('https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer'),
    tileSize: 512, minzoom: 0, maxzoom: 21,
    attribution: 'NC OneMap, NC Center for Geographic Information and Analysis',
    license: 'North Carolina public data (NC OneMap terms)',
    resolutionM: 0.1524,
    captureNote: '6-inch imagery from the statewide program, re-flown about a quarter of the state each year (four-year cycle).',
    termsNote: 'Confirm NC OneMap’s terms of use allow display in a commercial app before release.',
  },
};

export type ImageryChoice = 'best' | 'state' | 'naip-plus' | 'standard';

/** The source for a choice and the parcel's state; best is the sharpest available there. */
export function imageryFor(choice: ImageryChoice, stateFips: string | undefined): ImagerySource | RasterSource {
  const state = stateFips ? STATE_IMAGERY[stateFips] : undefined;
  if (choice === 'standard') return USGS_IMAGERY;
  if (choice === 'naip-plus') return USGS_NAIP_PLUS;
  return state ?? USGS_NAIP_PLUS;
}

/**
 * The deepest zoom that still shows real detail: half a level past the zoom whose pixels match the
 * imagery's ground resolution at this latitude (so things look crisp, not smeared).
 */
export function maxUsefulZoom(resolutionM: number, latDeg: number): number {
  const z = Math.log2((156543.034 * Math.cos((latDeg * Math.PI) / 180)) / resolutionM);
  return Math.min(22, Math.max(15, Math.round((z + 0.5) * 10) / 10));
}

/** Levels the maps zoom past maxUsefulZoom: the imagery blurs, but small objects get big enough to see and tap. */
export const ZOOM_PAST_IMAGERY = 2;

/** The deepest zoom the maps allow over imagery of this resolution (MapLibre draws to about 24; 23 keeps a margin). */
export function mapMaxZoom(resolutionM: number, latDeg: number): number {
  return Math.min(23, Math.round((maxUsefulZoom(resolutionM, latDeg) + ZOOM_PAST_IMAGERY) * 10) / 10);
}

/**
 * Layers saved in an offline parcel pack (Pro): the aerial imagery the maps draw. Only USGS services, which are public domain and
 * publish `exportTilesAllowed: true` (checked 2026-09-29). Saved to zoom 16, the deepest scale the
 * imagery service advertises (maxScale 1:9,028); the offline map overzooms past it.
 */
export const OFFLINE_PACK_LAYERS = [
  { id: USGS_IMAGERY.id, template: USGS_IMAGERY.tiles[0]!, maxZoom: 16, avgTileKb: 30, ext: 'jpg' },
];
