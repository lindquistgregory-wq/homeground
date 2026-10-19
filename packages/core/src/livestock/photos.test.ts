import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PHOTO, containsExif, fitLongEdge } from './index';

// Synthetic fixtures, built inline: minimal JPEG and WebP containers, not real photos.
const bytes = (...parts: Array<number[] | string>) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const seg = (marker: number, payload: Array<number[] | string>) => {
  const body = bytes(...payload);
  const len = body.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...body];
};
// An EXIF block holding a GPS IFD tag (0x8825), as phone cameras write it.
const exifWithGps = seg(0xe1, ['Exif', [0, 0], 'MM', [0, 42, 0, 0, 0, 8, 0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26]]);
const jfif = seg(0xe0, ['JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0]]);
const scan = [0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9];

const chunk = (id: string, payload: number[]) => { const n = payload.length; return [...bytes(id), n & 0xff, (n >> 8) & 0xff, 0, 0, ...payload, ...(n & 1 ? [0] : [])]; };
const webp = (...chunks: number[][]) => { const body = [...bytes('WEBP'), ...chunks.flat()]; const n = body.length; return new Uint8Array([...bytes('RIFF'), n & 0xff, (n >> 8) & 0xff, 0, 0, ...body]); };

test('photo size plan: long edge 1280 px, thumbnails 320 px, never enlarged', () => {
  assert.deepEqual(fitLongEdge(4032, 3024, PHOTO.longEdge), { width: 1280, height: 960 });
  assert.deepEqual(fitLongEdge(3024, 4032, PHOTO.thumbEdge), { width: 240, height: 320 });
  assert.deepEqual(fitLongEdge(800, 600, PHOTO.longEdge), { width: 800, height: 600 });
  assert.ok(PHOTO.targetBytes <= 150_000 && PHOTO.thumbTargetBytes <= 15_000);
  assert.equal(PHOTO.maxPerAnimal, 5);
});

test('a photo carrying EXIF (GPS) is detected, and a re-encoded one passes', () => {
  assert.equal(containsExif(new Uint8Array([0xff, 0xd8, ...jfif, ...exifWithGps, ...scan])), true, 'camera JPEG with GPS');
  assert.equal(containsExif(new Uint8Array([0xff, 0xd8, ...jfif, ...scan])), false, 'clean JPEG');
  assert.equal(containsExif(webp(chunk('VP8 ', [1, 2, 3, 4]))), false, 'clean WebP');
  assert.equal(containsExif(webp(chunk('VP8X', [8, 0, 0, 0, 0, 0, 0, 0, 0, 0]), chunk('VP8 ', [1, 2, 3]), chunk('EXIF', [0x4d, 0x4d, 0, 42]))), true, 'WebP with an EXIF chunk');
  assert.equal(containsExif(bytes('GIF89a')), true, 'unknown formats are refused, not kept');
});
