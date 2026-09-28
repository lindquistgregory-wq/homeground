/**
 * File import for boundaries: KML/KMZ, GeoJSON, zipped Shapefile, GPX, DXF.
 * Parsing lives in @plotwright/core (tested); this file only picks and reads the file, unzips with
 * fflate (MIT) and reprojects with proj4 (MIT) when the source isn't lon/lat.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { unzipSync } from 'fflate';
import proj4 from 'proj4';
import {
  BoundaryImportError, centralMeridian, detectFormat, georeference, parseDxf, parseGeoJson, parseGpx, parseKml, parseKmz,
  parseZippedShapefile, type Areal, type ImportResult,
} from '@plotwright/core';

export interface PickedBoundary {
  fileName: string;
  result: ImportResult;
}

export async function pickBoundaryFile(): Promise<PickedBoundary | null> {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];
  const format = detectFormat(asset.name);
  if (!format) throw new BoundaryImportError('Choose a .kml, .kmz, .geojson, .gpx, .dxf, or a zipped shapefile (.zip).');
  const file = new File(asset.uri);
  const unzip = (b: Uint8Array) => unzipSync(b);
  let result: ImportResult;
  switch (format) {
    case 'geojson':
      result = parseGeoJson(await file.text());
      break;
    case 'kml':
      result = parseKml(await file.text());
      break;
    case 'gpx':
      result = parseGpx(await file.text());
      break;
    case 'dxf':
      result = parseDxf(await file.text());
      break;
    case 'kmz':
      result = parseKmz(await Promise.resolve(file.bytes()), unzip);
      break;
    case 'shapefile':
      result = parseZippedShapefile(await Promise.resolve(file.bytes()), unzip);
      break;
  }
  return { fileName: asset.name, result };
}

export type CrsChoice =
  | { kind: 'prj' } // use the .prj WKT that came with a shapefile
  | { kind: 'utm'; zone: number; south?: boolean; units: 'm' | 'us-ft' }
  | { kind: 'proj4'; definition: string };

/** Reproject an imported boundary to WGS84 using the user's choice of coordinate system. */
export function georeferenceWith(result: ImportResult, crs: CrsChoice): Areal {
  let def: string;
  if (crs.kind === 'prj') {
    if (!result.crsHint || !/PROJCS/i.test(result.crsHint)) throw new BoundaryImportError('This file has no projection (.prj) to use.');
    def = result.crsHint;
  } else if (crs.kind === 'utm') {
    const units = crs.units === 'us-ft' ? ' +units=us-ft' : ' +units=m';
    // PROJ always takes false easting/northing in metres, whatever +units says.
    def = `+proj=tmerc +lat_0=0 +lon_0=${centralMeridian(crs.zone)} +k=0.9996 +x_0=500000 +y_0=${crs.south ? 10000000 : 0} +datum=WGS84${units} +no_defs`;
  } else def = crs.definition;
  const t = proj4(def, 'EPSG:4326');
  return georeference(result, (x, y) => t.forward([x, y]) as [number, number]);
}
