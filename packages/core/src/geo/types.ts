/** Minimal GeoJSON geometry types (RFC 7946). Coordinates are [longitude, latitude] in WGS84 / EPSG:4326. */

export type Position = [number, number] | [number, number, number];
export type Ring = Position[];

export interface Point {
  type: 'Point';
  coordinates: Position;
}
export interface LineString {
  type: 'LineString';
  coordinates: Position[];
}
export interface Polygon {
  type: 'Polygon';
  coordinates: Ring[];
}
export interface MultiPolygon {
  type: 'MultiPolygon';
  coordinates: Ring[][];
}
export type Areal = Polygon | MultiPolygon;
export type Geometry = Point | LineString | Polygon | MultiPolygon;

export interface GeoFeature<G extends Geometry = Geometry, P = Record<string, unknown>> {
  type: 'Feature';
  geometry: G;
  properties: P;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

export function toPolygons(g: Areal): Ring[][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

export function isValidLatLon(p: LatLon): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}
