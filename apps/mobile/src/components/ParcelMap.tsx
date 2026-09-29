/**
 * Map used by onboarding, boundary editing and the profile. MapLibre (open source) with the keyless
 * OpenFreeMap vector basemap and USGS public-domain aerial imagery on top. API: @maplibre/maplibre-react-native v11.
 */
import { Camera, GeoJSONSource, Layer, Map, RasterSource } from '@maplibre/maplibre-react-native';
import { bbox, type Areal, type Position } from '@plotwright/core';
import { OPENFREEMAP_STYLE_URL, USGS_IMAGERY } from '@plotwright/providers';
import { StyleSheet, View } from 'react-native';

export interface ParcelMapProps {
  center?: [number, number];
  zoom?: number;
  /** Saved or selected boundary. */
  boundary?: Areal | null;
  /** Alternative candidates (e.g. neighbouring parcels returned by a county service), drawn faintly. */
  candidates?: Areal[];
  /** Vertices of a boundary being drawn. */
  draft?: Position[];
  showImagery?: boolean;
  /** Pins (e.g. sensors), drawn as labelled dots. */
  markers?: Array<{ id: string; lon: number; lat: number; label?: string; highlight?: boolean }>;
  onPress?: (lon: number, lat: number) => void;
  style?: object;
}

const PARCEL = '#f2c14e';
const DRAFT = '#4ea8f2';

export function ParcelMap({ center, zoom = 17, boundary, candidates = [], draft = [], showImagery = true, markers = [], onPress, style }: ParcelMapProps) {
  const bounds = boundary ? bbox(boundary) : undefined;
  const draftLine = draft.length >= 2 ? [...draft, ...(draft.length >= 3 ? [draft[0]!] : [])] : [];

  return (
    <View style={[styles.wrap, style]}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={OPENFREEMAP_STYLE_URL}
        attribution
        onPress={(e) => {
          const [lon, lat] = e.nativeEvent.lngLat;
          onPress?.(lon, lat);
        }}
      >
        {bounds ? (
          <Camera bounds={[bounds[0], bounds[1], bounds[2], bounds[3]]} padding={{ top: 48, right: 48, bottom: 48, left: 48 }} />
        ) : center ? (
          <Camera center={center} zoom={zoom} />
        ) : null}

        {showImagery && (
          <RasterSource
            id="usgs-imagery"
            tiles={USGS_IMAGERY.tiles}
            tileSize={USGS_IMAGERY.tileSize}
            maxzoom={USGS_IMAGERY.maxzoom}
            attribution={USGS_IMAGERY.attribution}
          >
            <Layer type="raster" id="usgs-imagery-layer" paint={{ 'raster-opacity': 1 }} />
          </RasterSource>
        )}

        {candidates.length > 0 && (
          <GeoJSONSource
            id="candidates"
            data={{ type: 'FeatureCollection', features: candidates.map((g) => ({ type: 'Feature', geometry: g, properties: {} })) }}
          >
            <Layer type="line" id="candidates-line" paint={{ 'line-color': '#ffffff', 'line-opacity': 0.6, 'line-width': 1 }} />
          </GeoJSONSource>
        )}

        {boundary && (
          <GeoJSONSource id="parcel" data={{ type: 'Feature', geometry: boundary, properties: {} }}>
            <Layer type="fill" id="parcel-fill" paint={{ 'fill-color': PARCEL, 'fill-opacity': 0.15 }} />
            <Layer type="line" id="parcel-line" paint={{ 'line-color': PARCEL, 'line-width': 3 }} />
          </GeoJSONSource>
        )}

        {draft.length > 0 && (
          <GeoJSONSource
            id="draft"
            data={{
              type: 'FeatureCollection',
              features: [
                ...(draftLine.length ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: draftLine }, properties: {} }] : []),
                ...draft.map((p) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: p }, properties: {} })),
              ],
            }}
          >
            <Layer type="line" id="draft-line" paint={{ 'line-color': DRAFT, 'line-width': 2, 'line-dasharray': [2, 1] }} />
            <Layer type="circle" id="draft-pts" paint={{ 'circle-color': DRAFT, 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 }} />
          </GeoJSONSource>
        )}
        {markers.length > 0 && (
          <GeoJSONSource
            id="markers"
            data={{ type: 'FeatureCollection', features: markers.map((m) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] }, properties: { label: m.label ?? '', hl: m.highlight ? 1 : 0 } })) }}
          >
            <Layer type="circle" id="markers-pt" paint={{ 'circle-color': ['case', ['==', ['get', 'hl'], 1], '#4ea8f2', '#ffffff'], 'circle-radius': 7, 'circle-stroke-color': '#1c1f1a', 'circle-stroke-width': 2 }} />
            <Layer type="symbol" id="markers-label" layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' }} paint={{ 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5 }} />
          </GeoJSONSource>
        )}
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1, overflow: 'hidden' } });
