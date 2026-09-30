/**
 * Offline parcel packs (§10, Homestead Pro). A pack saves, for one parcel plus a small buffer:
 *   - USGS aerial imagery tiles (public domain; the services allow tile export) as files,
 *     zoom 12–16, capped at PACK_MAX_TILES and downloaded politely (two at a time, identifying User-Agent);
 *   - a fresh Site Profile, saved in the database like any profile (cached data never expires locally).
 * The OpenFreeMap vector basemap isn't bulk-downloaded (its terms don't address it); MapLibre's own
 * cache keeps what you've viewed, and the saved imagery sits underneath the live layers so it shows
 * whenever the network doesn't.
 */
import { bbox as areaBbox, planPack, tilePath, tilesFor, tileUrl, type Bbox, type PackPlan } from '@plotwright/core';
import { OFFLINE_PACK_LAYERS, buildSiteProfile } from '@plotwright/providers';
import { bundledZoneTable } from '@plotwright/data';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { USER_AGENT } from '../config';
import { kvGet, kvSet } from '../db/database';
import { getParcel, saveSiteProfile } from '../db/parcels';
import { http } from './http';
import { track } from './metrics';

export interface PackInfo {
  parcelId: string;
  createdAt: string;
  bbox: Bbox;
  layers: Array<{ id: string; maxZoom: number; tiles: number; ext: string; saved: number }>;
  complete: boolean;
  /**
   * Filled in when read (never stored: the app's folder path changes on iOS updates): the imagery
   * layer's file:// template and deepest saved zoom, if the files are still there.
   */
  imagery?: { template: string; maxZoom: number };
  /** The phone removed the saved tiles to free space (they live in the cache folder). */
  cleared?: boolean;
}

const key = (parcelId: string) => `pack.${parcelId}`;
/**
 * Tiles can be downloaded again, so they go in the cache folder (Apple's storage guidelines keep
 * re-downloadable data out of iCloud backups). The OS may clear it when storage runs low; the pack
 * card then offers to download again.
 */
const packsDir = () => new Directory(Paths.cache, 'packs');
const root = (parcelId: string) => new Directory(Paths.cache, 'packs', parcelId);

/** Keep more of what the user has looked at on the vector basemap (MapLibre's ambient cache, 50 MB by default). */
export function configureMapCache(): void {
  // A static import: require() resolves MapLibre's CommonJS build while the map screens import the
  // ESM build, and loading both registers the native views twice ("MLRNCamera" invariant).
  try {
    void OfflineManager.setMaximumAmbientCacheSize(150 * 1024 * 1024).catch(() => undefined);
  } catch { /* not linked in this build */ }
}

export async function getPack(parcelId: string): Promise<PackInfo | undefined> {
  const raw = await kvGet(key(parcelId));
  if (!raw) return undefined;
  let info: PackInfo;
  try { info = JSON.parse(raw) as PackInfo; } catch { return undefined; }
  delete (info as { templates?: unknown }).templates; // stored by early Phase 6 builds
  const dir = root(parcelId);
  const layer = info.layers.find((l) => l.id === 'usgs-imagery');
  if (!dir.exists) return { ...info, imagery: undefined, cleared: true };
  return { ...info, cleared: false, imagery: layer ? { template: `${dir.uri.replace(/\/$/, '')}/${layer.id}/{z}/{x}/{y}.${layer.ext}`, maxZoom: layer.maxZoom } : undefined };
}

export async function planForParcel(parcelId: string): Promise<PackPlan | undefined> {
  const p = await getParcel(parcelId);
  if (!p) return undefined;
  return planPack(areaBbox(p.geometry) as Bbox, OFFLINE_PACK_LAYERS);
}

export type PackProgress = { done: number; total: number; stage: 'tiles' | 'profile' };

/**
 * Download (or resume) a pack. Existing tiles are skipped, so a cancelled or failed download picks up
 * where it stopped. `signal.cancelled` stops it between tiles.
 */
export async function downloadPack(parcelId: string, onProgress: (p: PackProgress) => void, signal: { cancelled: boolean }): Promise<PackInfo> {
  const parcel = await getParcel(parcelId);
  if (!parcel) throw new Error('Property not found.');
  const plan = planPack(areaBbox(parcel.geometry) as Bbox, OFFLINE_PACK_LAYERS);
  const dir = root(parcelId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const info: PackInfo = {
    parcelId, createdAt: new Date().toISOString(), bbox: plan.bbox, complete: false,
    layers: plan.layers.map((l) => ({ id: l.id, maxZoom: l.maxZoom, tiles: l.tiles, ext: OFFLINE_PACK_LAYERS.find((x) => x.id === l.id)!.ext, saved: 0 })),
  };
  const jobs: Array<{ url: string; rel: string; layer: PackInfo['layers'][number] }> = [];
  for (const l of info.layers) {
    const src = plan.layers.find((x) => x.id === l.id)!;
    for (const t of tilesFor(plan.bbox, plan.minZoom, l.maxZoom)) jobs.push({ url: tileUrl(src.template, t), rel: tilePath(l.id, t, l.ext), layer: l });
  }
  let done = 0;
  let failed = 0;
  const total = jobs.length;
  const worker = async () => {
    while (jobs.length && !signal.cancelled) {
      const j = jobs.shift()!;
      const parts = j.rel.split('/');
      const folder = new Directory(dir, ...parts.slice(0, -1));
      const file = new File(folder, parts[parts.length - 1]!);
      try {
        if (!file.exists) {
          if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
          await File.downloadFileAsync(j.url, file, { headers: { 'User-Agent': USER_AGENT }, idempotent: true });
        }
        j.layer.saved++;
      } catch {
        failed++;
      }
      onProgress({ done: ++done, total, stage: 'tiles' });
    }
  };
  await Promise.all([worker(), worker()]);
  if (signal.cancelled) {
    await kvSet(key(parcelId), JSON.stringify(info));
    throw new Error('Download stopped. Tap Update pack to continue where it left off.');
  }
  // Refresh the Site Profile so the pack carries current data (falls back to the cache offline).
  onProgress({ done, total, stage: 'profile' });
  try {
    const profile = await buildSiteProfile({ http, zoneTable: bundledZoneTable }, parcel.geometry, { countyFips: parcel.countyFips, zip: parcel.zip });
    await saveSiteProfile(parcelId, profile);
  } catch { /* keep the cached profile */ }
  info.complete = failed === 0;
  await kvSet(key(parcelId), JSON.stringify(info));
  track('offline_pack', { result: info.complete ? 'complete' : 'partial' });
  return (await getPack(parcelId)) ?? info;
}

export async function deletePack(parcelId: string): Promise<void> {
  const dir = root(parcelId);
  if (dir.exists) dir.delete();
  await kvSet(key(parcelId), '');
}

/** "Delete all my data": remove every saved pack. */
export function deleteAllPacks(): void {
  const dir = packsDir();
  if (dir.exists) dir.delete();
}
