/**
 * Boundary import (§2.2 strategy 2): KML/KMZ, GeoJSON, zipped Shapefile, GPX, DXF.
 * Dependency-free parsers. Anything that isn't obviously WGS84 lon/lat (survey DXFs, projected
 * shapefiles) comes back with `needsGeoreference` and raw rings; the app then asks the user for the
 * coordinate system and reprojects with proj4 before calling `georeference`.
 */
import { normalizeAreal, ringSignedAreaDeg } from '../geo/measure';
import type { Areal, Ring } from '../geo/types';

export type BoundaryFormat = 'geojson' | 'kml' | 'kmz' | 'gpx' | 'shapefile' | 'dxf';

export interface ImportResult {
  format: BoundaryFormat;
  /** WGS84 geometry, when the input was already lon/lat. */
  geometry: Areal | null;
  /** Rings in source coordinates (always populated), for georeferencing. */
  rawPolygons: number[][][][];
  needsGeoreference: boolean;
  /** Coordinate-system hint: a .prj WKT, or a DXF $INSUNITS note. */
  crsHint?: string;
  warnings: string[];
}

export class BoundaryImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundaryImportError';
  }
}

function looksLonLat(polys: number[][][][]): boolean {
  let any = false;
  for (const poly of polys)
    for (const ring of poly)
      for (const p of ring) {
        any = true;
        if (!(Math.abs(p[0]!) <= 180 && Math.abs(p[1]!) <= 90)) return false;
      }
  return any;
}

function finish(format: BoundaryFormat, polys: number[][][][], warnings: string[], crsHint?: string, forceGeoref = false): ImportResult {
  const valid = polys
    .map((poly) => poly.filter((r) => r.length >= 3))
    .filter((poly) => poly.length > 0);
  if (valid.length === 0) throw new BoundaryImportError('No polygon boundary was found in this file.');
  const lonLat = !forceGeoref && looksLonLat(valid);
  let geometry: Areal | null = null;
  if (lonLat) {
    const rings = valid.map((poly) => poly.map((r) => r.map((p) => [p[0]!, p[1]!] as [number, number])));
    geometry = normalizeAreal(rings.length === 1 ? { type: 'Polygon', coordinates: rings[0]! } : { type: 'MultiPolygon', coordinates: rings });
  }
  return { format, geometry, rawPolygons: valid, needsGeoreference: !lonLat, crsHint, warnings };
}

/** Apply a source→WGS84 transform (e.g. from proj4) to a result that needs georeferencing. */
export function georeference(result: ImportResult, toLonLat: (x: number, y: number) => [number, number]): Areal {
  const polys: Ring[][] = result.rawPolygons.map((poly) => poly.map((ring) => ring.map((p) => toLonLat(p[0]!, p[1]!))));
  for (const poly of polys)
    for (const ring of poly)
      for (const [lon, lat] of ring)
        if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 90))
          throw new BoundaryImportError('The chosen coordinate system does not place this boundary on Earth — check the selection.');
  return normalizeAreal(polys.length === 1 ? { type: 'Polygon', coordinates: polys[0]! } : { type: 'MultiPolygon', coordinates: polys });
}

// ---------------- GeoJSON ----------------

export function parseGeoJson(text: string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new BoundaryImportError('This is not valid GeoJSON.');
  }
  const polys: number[][][][] = [];
  const warnings: string[] = [];
  const visit = (g: any): void => {
    if (!g || typeof g !== 'object') return;
    switch (g.type) {
      case 'FeatureCollection':
        (g.features ?? []).forEach(visit);
        break;
      case 'Feature':
        visit(g.geometry);
        break;
      case 'GeometryCollection':
        (g.geometries ?? []).forEach(visit);
        break;
      case 'Polygon':
        polys.push(g.coordinates);
        break;
      case 'MultiPolygon':
        polys.push(...g.coordinates);
        break;
      case 'LineString': {
        const c = g.coordinates as number[][];
        if (c.length >= 4 && c[0]![0] === c[c.length - 1]![0] && c[0]![1] === c[c.length - 1]![1]) polys.push([c]);
        else warnings.push('Skipped an open line.');
        break;
      }
    }
  };
  visit(doc);
  const crs = (doc as any)?.crs?.properties?.name as string | undefined;
  const nonWgs = !!crs && !/CRS84|4326/.test(crs);
  return finish('geojson', polys, warnings, crs, nonWgs);
}

// ---------------- KML ----------------

function tagContents(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!);
  return out;
}

function kmlCoords(s: string): number[][] {
  return s
    .trim()
    .split(/\s+/)
    .map((t) => t.split(',').map(Number))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0]!, p[1]!]);
}

export function parseKml(xml: string): ImportResult {
  const polys: number[][][][] = [];
  const warnings: string[] = [];
  for (const poly of tagContents(xml, 'Polygon')) {
    const outer = tagContents(poly, 'outerBoundaryIs').flatMap((b) => tagContents(b, 'coordinates')).map(kmlCoords);
    const inner = tagContents(poly, 'innerBoundaryIs').flatMap((b) => tagContents(b, 'coordinates')).map(kmlCoords);
    if (outer[0]) polys.push([outer[0], ...inner]);
  }
  if (polys.length === 0) {
    for (const ls of tagContents(xml, 'LineString')) {
      const c = tagContents(ls, 'coordinates').map(kmlCoords)[0] ?? [];
      if (c.length >= 3) {
        polys.push([c]);
        warnings.push('No polygon found; used a line as the boundary and closed it.');
      }
    }
  }
  return finish('kml', polys, warnings);
}

export type Unzip = (bytes: Uint8Array) => Record<string, Uint8Array>;
const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

export function parseKmz(bytes: Uint8Array, unzip: Unzip): ImportResult {
  const files = unzip(bytes);
  const name = Object.keys(files).find((n) => /(^|\/)doc\.kml$/i.test(n)) ?? Object.keys(files).find((n) => /\.kml$/i.test(n));
  if (!name) throw new BoundaryImportError('This KMZ has no KML inside.');
  return { ...parseKml(utf8(files[name]!)), format: 'kmz' };
}

// ---------------- GPX ----------------

function attrNum(tag: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
  return m ? Number(m[1]) : NaN;
}

export function parseGpx(xml: string): ImportResult {
  const warnings: string[] = [];
  const points = (tag: string) =>
    [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>`, 'gi'))]
      .map((m) => [attrNum(m[0], 'lon'), attrNum(m[0], 'lat')])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) as number[][];
  let ring = points('trkpt');
  if (ring.length < 3) ring = points('rtept');
  if (ring.length < 3) {
    ring = points('wpt');
    if (ring.length >= 3) warnings.push('Used waypoints in file order as boundary corners.');
  }
  if (ring.length >= 3) warnings.push('GPS tracks were closed into a polygon — review the corners before saving.');
  return finish('gpx', ring.length >= 3 ? [[ring]] : [], warnings);
}

// ---------------- Shapefile ----------------

export function parseShapefile(files: Record<string, Uint8Array>): ImportResult {
  const shpName = Object.keys(files).find((n) => /\.shp$/i.test(n));
  if (!shpName) throw new BoundaryImportError('The zip does not contain a .shp file.');
  const prjName = Object.keys(files).find((n) => /\.prj$/i.test(n));
  const prj = prjName ? utf8(files[prjName]!) : undefined;
  const buf = files[shpName]!;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 100 || dv.getInt32(0, false) !== 9994) throw new BoundaryImportError('The .shp file is not a valid shapefile.');
  const shapeType = dv.getInt32(32, true);
  if (![5, 15, 25].includes(shapeType)) throw new BoundaryImportError('The shapefile does not contain polygons.');

  const polys: number[][][][] = [];
  let off = 100;
  while (off + 8 <= buf.byteLength) {
    const contentBytes = dv.getInt32(off + 4, false) * 2;
    const rec = off + 8;
    off = rec + contentBytes;
    if (off > buf.byteLength) break;
    const t = dv.getInt32(rec, true);
    if (t === 0) continue; // null shape
    const numParts = dv.getInt32(rec + 36, true);
    const numPoints = dv.getInt32(rec + 40, true);
    const partsAt = rec + 44;
    const pointsAt = partsAt + numParts * 4;
    const rings: number[][][] = [];
    for (let p = 0; p < numParts; p++) {
      const start = dv.getInt32(partsAt + p * 4, true);
      const end = p + 1 < numParts ? dv.getInt32(partsAt + (p + 1) * 4, true) : numPoints;
      const ring: number[][] = [];
      for (let i = start; i < end; i++) ring.push([dv.getFloat64(pointsAt + i * 16, true), dv.getFloat64(pointsAt + i * 16 + 8, true)]);
      rings.push(ring);
    }
    // Shapefile: clockwise rings are outer shells, counter-clockwise are holes.
    let current: number[][][] | null = null;
    for (const r of rings) {
      if (ringSignedAreaDeg(r) < 0 || !current) {
        current = [r];
        polys.push(current);
      } else current.push(r);
    }
  }
  const projected = !!prj && /^\s*PROJCS/i.test(prj);
  const warnings: string[] = [];
  if (!prj) warnings.push('No .prj file: assuming longitude/latitude if the numbers fit.');
  else if (/NAD_?1983|NAD83/i.test(prj) && !projected) warnings.push('NAD83 coordinates used as WGS84 (difference is about 1–2 m).');
  return finish('shapefile', polys, warnings, prj, projected);
}

export function parseZippedShapefile(bytes: Uint8Array, unzip: Unzip): ImportResult {
  return parseShapefile(unzip(bytes));
}

// ---------------- DXF ----------------

export function parseDxf(text: string): ImportResult {
  const lines = text.split(/\r?\n/);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]!.trim()), lines[i + 1]!.trim()]);

  let units: string | undefined;
  const polys: number[][][][] = [];
  const warnings: string[] = [];
  let i = 0;
  while (i < pairs.length) {
    const [code, value] = pairs[i]!;
    if (code === 9 && value === '$INSUNITS') {
      const u = pairs[i + 1]?.[1];
      units = u === '1' ? 'inches' : u === '2' ? 'feet' : u === '6' ? 'metres' : u === '21' ? 'US survey feet' : undefined;
    }
    if (code === 0 && value === 'LWPOLYLINE') {
      const pts: number[][] = [];
      let closed = false;
      let x: number | undefined;
      i++;
      while (i < pairs.length && pairs[i]![0] !== 0) {
        const [c, v] = pairs[i]!;
        if (c === 70) closed = (Number(v) & 1) === 1;
        if (c === 10) x = Number(v);
        if (c === 20 && x !== undefined) {
          pts.push([x, Number(v)]);
          x = undefined;
        }
        i++;
      }
      if (pts.length >= 3) {
        polys.push([pts]);
        if (!closed) warnings.push('An open polyline was closed to form the boundary.');
      }
      continue;
    }
    if (code === 0 && value === 'POLYLINE') {
      const pts: number[][] = [];
      i++;
      while (i < pairs.length && !(pairs[i]![0] === 0 && pairs[i]![1] === 'SEQEND')) {
        if (pairs[i]![0] === 0 && pairs[i]![1] === 'VERTEX') {
          let x: number | undefined, y: number | undefined;
          i++;
          while (i < pairs.length && pairs[i]![0] !== 0) {
            if (pairs[i]![0] === 10) x = Number(pairs[i]![1]);
            if (pairs[i]![0] === 20) y = Number(pairs[i]![1]);
            i++;
          }
          if (x !== undefined && y !== undefined) pts.push([x, y]);
          continue;
        }
        i++;
      }
      if (pts.length >= 3) polys.push([pts]);
      continue;
    }
    i++;
  }
  if (polys.length > 1) warnings.push(`Found ${polys.length} closed shapes; the largest is usually the property line — pick the right one before saving.`);
  // Survey DXFs are almost always in a projected system (State Plane / UTM), so always confirm with the user.
  return finish('dxf', polys, warnings, units ? `Drawing units: ${units}` : undefined, !looksLonLat(polys));
}

export function detectFormat(fileName: string): BoundaryFormat | null {
  const n = fileName.toLowerCase();
  if (n.endsWith('.geojson') || n.endsWith('.json')) return 'geojson';
  if (n.endsWith('.kml')) return 'kml';
  if (n.endsWith('.kmz')) return 'kmz';
  if (n.endsWith('.gpx')) return 'gpx';
  if (n.endsWith('.zip') || n.endsWith('.shp')) return 'shapefile';
  if (n.endsWith('.dxf')) return 'dxf';
  return null;
}
