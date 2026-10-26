/**
 * Home's homestead map: the property on aerial imagery with every design object drawn on it, small
 * animals walking around the housing they live in, and free-roaming animals (a guardian dog, barn
 * cats) wandering the property. Objects carry no labels, so the map stays clean; tap one for its name. The map holds still (no pan or zoom) so it reads like a picture and
 * the page scrolls; tap an object to see what's in it.
 *
 * The animals walk on a layer above the map: their homes are projected to screen points once the map
 * has settled, then each animal is animated natively from there, so the map itself never re-renders.
 */
import { Camera, GeoJSONSource, Layer, Map, RasterSource, type MapRef } from '@maplibre/maplibre-react-native';
import { bbox, footprintLonLat, frameForBoundary, objectType, type Areal, type Design } from '@plotwright/core';
import { OPENFREEMAP_STYLE_URL, imageryFor, maxUsefulZoom, type ImageryChoice } from '@plotwright/providers';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg from 'react-native-svg';
import type { Herd } from '../db/herds';
import { isCurrent } from '../services/animals';
import { animalById } from '@plotwright/core';
import { artForAnimal, drawAnimal } from './AnimalArt';
import { CATEGORY_COLOR } from './objectIcons';

/** Kinds of animal that don't walk about on the map (fish stay in the pond, worms in the bin). */
const STILL = new Set(['aquatic', 'invertebrate']);
/** Most sprites drawn for one group, so a flock of 30 doesn't fill the screen. */
const MAX_PER_GROUP = 3;

export interface HomeMapPadding { top: number; right: number; bottom: number; left: number }

export function HomeMap({ boundary, design, herds, stateFips, imageryChoice = 'best', selectedId, onSelect, padding, children }: {
  boundary: Areal; design: Design | undefined; herds: Herd[]; stateFips?: string; imageryChoice?: ImageryChoice;
  selectedId: string | null; onSelect: (objectId: string | null) => void; padding: HomeMapPadding; children?: ReactNode;
}) {
  const mapRef = useRef<MapRef>(null);
  // A tap on an object also reaches the map; the map's own tap (which closes the popup) skips it.
  const objectTapAt = useRef(0);
  const b = bbox(boundary);
  const frame = useMemo(() => frameForBoundary(boundary), [boundary]);
  const imagery = imageryFor(imageryChoice, stateFips);
  const res = 'resolutionM' in imagery ? imagery.resolutionM : 1;

  const objects = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (design?.objects ?? []).map((o) => {
      const t = objectType(o.kind);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [footprintLonLat(o, frame)] },
        properties: { id: o.id, color: o.existing ? '#9e9e9e' : CATEGORY_COLOR[t?.category ?? ''] ?? '#4F6E3A', selected: o.id === selectedId ? 1 : 0 },
      };
    }),
  }), [design, frame, selectedId]);

  // Where each animal group lives, as lon/lat with a wander radius (m): housing centre, or a free-roaming spot.
  const homes = useMemo(() => {
    const out: Array<{ key: string; speciesId: string; count: number; lon: number; lat: number; radiusM: number; roam: boolean }> = [];
    for (const h of herds.filter(isCurrent)) {
      const a = animalById(h.speciesId);
      if (!a || STILL.has(a.kind)) continue;
      if (h.objectId) {
        const o = design?.objects.find((x) => x.id === h.objectId);
        if (!o) continue;
        const ring = footprintLonLat(o, frame);
        const lon = ring.reduce((s, p) => s + p[0]!, 0) / ring.length, lat = ring.reduce((s, p) => s + p[1]!, 0) / ring.length;
        out.push({ key: h.id, speciesId: h.speciesId, count: Math.min(MAX_PER_GROUP, h.count), lon, lat, radiusM: Math.max(4, Math.max(o.width, o.length) * 0.75 + 2), roam: false });
      } else if (h.location) {
        out.push({ key: h.id, speciesId: h.speciesId, count: Math.min(MAX_PER_GROUP, h.count), lon: h.location.lon, lat: h.location.lat, radiusM: 0, roam: true });
      }
    }
    return out;
  }, [herds, design, frame]);

  // Screen positions once the map settles (the camera is fixed, so they hold until the layout changes).
  const [screen, setScreen] = useState<{ homes: Array<{ x: number; y: number; r: number }>; box: { x0: number; y0: number; x1: number; y1: number } } | null>(null);
  const measure = async () => {
    const m = mapRef.current;
    if (!m) return;
    try {
      const [sw, ne] = await Promise.all([m.project([b[0], b[1]]), m.project([b[2], b[3]])]);
      const pxPerM = Math.abs(ne[0] - sw[0]) / Math.max(1, (b[2] - b[0]) * 111_320 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180));
      const pts = await Promise.all(homes.map((h) => m.project([h.lon, h.lat])));
      setScreen({
        homes: pts.map((p, i) => ({ x: p[0], y: p[1], r: homes[i]!.roam ? 0 : Math.max(14, homes[i]!.radiusM * pxPerM) })),
        box: { x0: Math.min(sw[0], ne[0]) + 12, x1: Math.max(sw[0], ne[0]) - 12, y0: Math.min(sw[1], ne[1]) + 12, y1: Math.max(sw[1], ne[1]) - 12 },
      });
    } catch { /* map not ready yet; the next region change measures again */ }
  };
  useEffect(() => { void measure(); /* re-project when the animals change */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homes]);

  const [still, setStill] = useState(false);
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => undefined); }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Map ref={mapRef} style={StyleSheet.absoluteFill} mapStyle={OPENFREEMAP_STYLE_URL} attribution logoPosition={{ bottom: 8, left: 8 }} attributionPosition={{ bottom: 8, left: 92 }}
        dragPan={false} touchZoom={false} doubleTapZoom={false} doubleTapHoldZoom={false} touchRotate={false} touchPitch={false}
        onRegionDidChange={() => void measure()} onDidFinishLoadingMap={() => void measure()}
        onPress={() => { if (Date.now() - objectTapAt.current > 400) onSelect(null); }}>
        <Camera initialViewState={{ bounds: [b[0], b[1], b[2], b[3]], padding }} maxZoom={maxUsefulZoom(res, (b[1] + b[3]) / 2)} />
        <RasterSource id="home-img" tiles={imagery.tiles} tileSize={imagery.tileSize} maxzoom={imagery.maxzoom} attribution={imagery.attribution}>
          <Layer type="raster" id="home-img-l" />
        </RasterSource>
        <GeoJSONSource id="home-parcel" data={{ type: 'Feature', geometry: boundary, properties: {} }}>
          <Layer type="line" id="home-parcel-l" paint={{ 'line-color': '#F3E1B0', 'line-width': 2, 'line-dasharray': [3, 2] }} />
        </GeoJSONSource>
        <GeoJSONSource id="home-objects" data={objects} hitbox={{ top: 14, right: 14, bottom: 14, left: 14 }}
          onPress={(e) => { const id = e.nativeEvent.features?.[0]?.properties?.id; if (typeof id === 'string') { e.stopPropagation(); objectTapAt.current = Date.now(); onSelect(id); } }}>
          <Layer type="fill" id="home-obj-fill" paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.55 }} />
          <Layer type="line" id="home-obj-line" paint={{ 'line-color': ['case', ['==', ['get', 'selected'], 1], '#F3E1B0', '#ffffff'], 'line-width': ['case', ['==', ['get', 'selected'], 1], 4, 1.5] }} />
        </GeoJSONSource>
      </Map>

      {/* Animals: drawn above the map, never catching touches. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {screen && homes.map((h, i) => Array.from({ length: h.count }, (_, k) => (
          <Walker key={`${h.key}-${k}`} speciesId={h.speciesId} home={screen.homes[i]!} box={screen.box} roam={h.roam} still={still} seed={i * 7 + k} />
        )))}
      </View>
      {children}
    </View>
  );
}

/** Deterministic-ish randomness per sprite, so animals don't all move in step. */
function rand(seed: { v: number }): number {
  seed.v = (seed.v * 9301 + 49297) % 233280;
  return seed.v / 233280;
}

function Walker({ speciesId, home, box, roam, still, seed }: {
  speciesId: string; home: { x: number; y: number; r: number }; box: { x0: number; y0: number; x1: number; y1: number }; roam: boolean; still: boolean; seed: number;
}) {
  const a = animalById(speciesId);
  const size = a?.kind === 'pollinator' ? 14 : a?.kind === 'poultry' || a?.kind === 'waterfowl' ? 20 : a?.kind === 'small-stock' ? 20 : 28;
  const r = useRef({ v: seed * 1013 + 17 }).current;
  const start = roam ? { x: home.x, y: home.y } : { x: home.x + (rand(r) - 0.5) * home.r, y: home.y + (rand(r) - 0.5) * home.r };
  const pos = useRef(new Animated.ValueXY(start)).current;
  const face = useRef(new Animated.Value(1)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Measured again (the map finished zooming): start over from the new spot.
    // Roaming animals stay on the property, even if they were placed just over the line.
    const from = roam ? { x: Math.min(box.x1, Math.max(box.x0, home.x)), y: Math.min(box.y1, Math.max(box.y0, home.y)) } : { x: home.x + (rand(r) - 0.5) * home.r, y: home.y + (rand(r) - 0.5) * home.r };
    pos.stopAnimation();
    pos.setValue(from);
    if (still) return;
    let alive = true;
    let at = from;
    const step = () => {
      if (!alive) return;
      // Housed animals keep near home; roaming ones cross the property (a few body lengths at a time, sometimes further).
      const target = roam
        ? { x: Math.min(box.x1, Math.max(box.x0, at.x + (rand(r) - 0.5) * (rand(r) < 0.25 ? 260 : 90))), y: Math.min(box.y1, Math.max(box.y0, at.y + (rand(r) - 0.5) * (rand(r) < 0.25 ? 260 : 90))) }
        : { x: home.x + (rand(r) - 0.5) * 2 * home.r, y: home.y + (rand(r) - 0.5) * 2 * home.r };
      const dist = Math.hypot(target.x - at.x, target.y - at.y);
      const speed = a?.kind === 'pollinator' ? 40 : roam ? 18 : 10; // px per second
      face.setValue(target.x < at.x ? -1 : 1);
      at = target;
      Animated.sequence([
        Animated.timing(pos, { toValue: target, duration: Math.max(600, (dist / speed) * 1000), easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(800 + rand(r) * (roam ? 4000 : 2500)),
      ]).start(({ finished }) => { if (finished) step(); });
    };
    const t = setTimeout(step, rand(r) * 1500);
    const hop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: -1.5, duration: 220, useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]));
    hop.start();
    return () => { alive = false; clearTimeout(t); pos.stopAnimation(); hop.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home.x, home.y, home.r, box.x0, box.y0, box.x1, box.y1, roam, still]);

  return (
    <Animated.View style={{ position: 'absolute', left: -size / 2, top: -size / 2, transform: [{ translateX: pos.x }, { translateY: Animated.add(pos.y, bob) }, { scaleX: face }] }}>
      <View style={[styles.shadow, { width: size * 0.7, left: size * 0.15, top: size * 0.82 }]} />
      <Svg width={size} height={size} viewBox="0 0 48 48">{drawAnimal(artForAnimal(speciesId))}</Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.28)' },
});
