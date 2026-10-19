/**
 * Animal photos (prompt §6, Photos): the size plan and a metadata check. The app re-encodes every
 * photo once when it's picked (long edge 1280 px, WebP at about 0.6; a 320 px thumbnail at about
 * 0.5), never keeps the original, and refuses to store a file that still carries EXIF (which is
 * where GPS location lives). Only thumbnails sync.
 */

export const PHOTO = {
  maxPerAnimal: 5,
  longEdge: 1280,
  quality: 0.6,
  /** Second try when the first encode is over target (busy, detailed photos). */
  fallbackQuality: 0.45,
  thumbEdge: 320,
  thumbQuality: 0.5,
  targetBytes: 150_000,
  thumbTargetBytes: 15_000,
} as const;

/** Width and height to resize to so the long edge is at most `edge` (never enlarged). */
export function fitLongEdge(width: number, height: number, edge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= edge || long <= 0) return { width: Math.round(width), height: Math.round(height) };
  const k = edge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/**
 * Does an image file still carry EXIF (and so possibly GPS location)? Checks JPEG APP1 "Exif"
 * segments and WebP "EXIF" chunks. Unknown formats return true, so they're refused rather than kept.
 */
export function containsExif(b: Uint8Array): boolean {
  // JPEG: walk the segments before the image data.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1]!;
      if (marker === 0xda || marker === 0xd9) return false; // start of scan / end: no more metadata
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (marker === 0xe1 && ascii(b, i + 4, 'Exif')) return true;
      i += 2 + len;
    }
    return false;
  }
  // WebP: RIFF container with chunks.
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) {
    let i = 12;
    while (i + 8 <= b.length) {
      if (ascii(b, i, 'EXIF')) return true;
      const len = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24);
      i += 8 + len + (len & 1);
    }
    return false;
  }
  return true;
}
