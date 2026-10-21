/**
 * Animal photos (prompt §6, Photos): taken with the camera or picked with the system photo picker, re-encoded once on the
 * phone (long edge 1280 px, WebP ~0.6, retried at ~0.45 if over 150 KB; a 320 px thumbnail), the
 * original never kept, and anything still carrying EXIF (GPS location) refused. The full-size file
 * stays in the app's documents; only the thumbnail travels, inside the synced record.
 */
import { PHOTO, containsExif, fitLongEdge, type AnimalRecord } from '@plotwright/core';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { newId } from './identity';

type Photo = NonNullable<AnimalRecord['photos']>[number];

const dir = () => {
  const d = new Directory(Paths.document, 'animal-photos');
  if (!d.exists) d.create({ intermediates: true });
  return d;
};

async function encode(uri: string, w: number, h: number, edge: number, quality: number): Promise<{ file: File; bytes: Uint8Array }> {
  const size = fitLongEdge(w, h, edge);
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize(size);
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: quality, format: SaveFormat.WEBP });
  const file = new File(out.uri);
  return { file, bytes: await file.bytes() };
}

export type PhotoSource = 'camera' | 'library';

/**
 * Take or pick one photo and store it compressed. Null when cancelled. Throws with a plain message on
 * failure. The camera asks for permission the first time; the photo picker needs none.
 */
export async function pickAnimalPhoto(source: PhotoSource = 'library'): Promise<Photo | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off for Plotwright. You can allow it in your phone’s settings, or choose a photo from your library instead.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false, allowsEditing: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  const original = new File(a.uri);
  try {
    let full = await encode(a.uri, a.width, a.height, PHOTO.longEdge, PHOTO.quality);
    if (full.bytes.length > PHOTO.targetBytes) {
      full.file.delete();
      full = await encode(a.uri, a.width, a.height, PHOTO.longEdge, PHOTO.fallbackQuality);
    }
    const thumb = await encode(a.uri, a.width, a.height, PHOTO.thumbEdge, PHOTO.thumbQuality);
    if (containsExif(full.bytes) || containsExif(thumb.bytes)) {
      full.file.delete();
      thumb.file.delete();
      throw new Error('This photo kept its location data after re-encoding, so it wasn’t saved.');
    }
    const id = newId();
    const name = `${id}.webp`;
    full.file.move(new File(dir(), name));
    const thumbUri = `data:image/webp;base64,${await thumb.file.base64()}`;
    thumb.file.delete();
    return { id, addedOn: new Date().toISOString().slice(0, 10), thumb: thumbUri, file: name };
  } finally {
    // Never keep the original (the picker's copy in the cache).
    try { if (original.exists) original.delete(); } catch { /* not ours to delete on some devices */ }
  }
}

/** The full-size file on this phone, if it's still here (another device only has the thumbnail). */
export function photoUri(p: Photo): string {
  if (p.file) {
    const f = new File(dir(), p.file);
    if (f.exists) return f.uri;
  }
  return p.thumb;
}

/** Remove the full-size files of a group's or animal's photos (when it's deleted). */
export function deletePhotoFiles(list: Photo[] | undefined): void {
  for (const p of list ?? []) deletePhotoFile(p);
}

export function deletePhotoFile(p: Photo): void {
  if (!p.file) return;
  const f = new File(dir(), p.file);
  if (f.exists) f.delete();
}

/** Bytes used by full-size photos on this phone. */
export function photoStorage(): { files: number; bytes: number } {
  const files = dir().list().filter((x): x is File => x instanceof File);
  return { files: files.length, bytes: files.reduce((n, f) => n + (f.size ?? 0), 0) };
}

/** "Free up space": remove full-size photos older than `days`; thumbnails stay in the records. */
export function freeUpPhotos(days: number): number {
  const cutoff = Date.now() - days * 86_400_000;
  let removed = 0;
  for (const f of dir().list()) {
    if (f instanceof File && (f.modificationTime ?? Date.now()) < cutoff) { f.delete(); removed++; }
  }
  return removed;
}

/** "Delete all my data": remove every full-size photo on this phone. */
export function deleteAllPhotos(): void {
  const d = new Directory(Paths.document, 'animal-photos');
  if (d.exists) d.delete();
}

/** Full-size photos as base64, for the JSON export (so they go wherever the user's export goes). */
export async function photoBase64(p: Photo): Promise<string | undefined> {
  if (!p.file) return undefined;
  const f = new File(dir(), p.file);
  return f.exists ? f.base64() : undefined;
}
