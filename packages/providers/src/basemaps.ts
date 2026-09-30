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

/**
 * Layers saved in an offline parcel pack (Pro): the aerial imagery the maps draw. Only USGS services, which are public domain and
 * publish `exportTilesAllowed: true` (checked 2026-09-29). Saved to zoom 16, the deepest scale the
 * imagery service advertises (maxScale 1:9,028); the offline map overzooms past it.
 */
export const OFFLINE_PACK_LAYERS = [
  { id: USGS_IMAGERY.id, template: USGS_IMAGERY.tiles[0]!, maxZoom: 16, avgTileKb: 30, ext: 'jpg' },
];
