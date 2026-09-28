import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { bufferSource, cachedSource, openGeoTiff, pickImage, readWindow, type ByteSource } from './tiff';

/**
 * Fixtures were written by independent encoders (tifffile, and Pillow + libtiff for LZW and the
 * predictors) from the same 90×70 float32 surface: v = 100 + 0.5x + 0.25y + 3·sin(x/7), with
 * pixel (x=7, y=5) set to −9999. Files written with tifffile carry GDAL_NODATA=−9999 and GeoTIFF tags
 * (2 m pixels, origin 580000, 4680000, EPSG:32618).
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const load = (n: string) => new Uint8Array(readFileSync(join(dir, n)));
const inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b));
const expected = (x: number, y: number) => Math.fround(100 + 0.5 * x + 0.25 * y + Math.fround(Math.sin(x / 7) * 3));

async function checkFull(name: string, hasNoData: boolean) {
  const tiff = await openGeoTiff(bufferSource(load(name)));
  const im = tiff.images[0]!;
  assert.equal(im.width, 90);
  assert.equal(im.height, 70);
  const px = await readWindow(tiff, im, { x: 0, y: 0, width: 90, height: 70 }, inflate);
  let maxErr = 0;
  for (let y = 0; y < 70; y++)
    for (let x = 0; x < 90; x++) {
      const v = px[y * 90 + x]!;
      if (x === 7 && y === 5) {
        if (hasNoData) assert.ok(Number.isNaN(v), `${name}: noData should be NaN`);
        else assert.equal(v, -9999);
        continue;
      }
      maxErr = Math.max(maxErr, Math.abs(v - expected(x, y)));
    }
  assert.ok(maxErr < 1e-3, `${name}: max error ${maxErr}`);
  return tiff;
}

test('uncompressed strips with GeoTIFF georeferencing', async () => {
  const t = await checkFull('dem_strips_none.tif', true);
  const im = t.images[0]!;
  assert.deepEqual(im.scale, [2, 2]);
  assert.deepEqual(im.origin, [580000, 4680000]);
  assert.equal(im.epsg, 32618);
  assert.equal(im.noData, -9999);
});

test('LZW (libtiff encoder) with and without the floating-point predictor', async () => {
  await checkFull('dem_pil_lzw.tif', false);
  await checkFull('dem_pil_lzw_pred3.tif', false);
});

test('Deflate with the floating-point predictor', async () => {
  await checkFull('dem_pil_deflate_pred3.tif', false);
});

test('BigTIFF, tiled, deflate', async () => {
  await checkFull('dem_bigtiff_deflate.tif', true);
});

test('big-endian file', async () => {
  await checkFull('dem_bigendian_none.tif', true);
});

test('int16 with horizontal predictor; uint8 LZW with horizontal predictor', async () => {
  const t = await openGeoTiff(bufferSource(load('dem_int16_deflate_pred2.tif')));
  const px = await readWindow(t, t.images[0]!, { x: 44, y: 33, width: 1, height: 1 }, inflate);
  assert.equal(px[0], Math.trunc(expected(44, 33) * 10)); // numpy astype truncates
  const chm = await openGeoTiff(bufferSource(load('chm_pil_lzw_pred2.tif')));
  const all = await readWindow(chm, chm.images[0]!, { x: 0, y: 0, width: 90, height: 70 });
  assert.equal(all.reduce((a, b) => a + b, 0), 7955);
});

test('windows crossing the edge return NaN outside, and only needed tiles are read', async () => {
  const bytes = load('dem_bigtiff_deflate.tif');
  const reads: Array<[number, number]> = [];
  const counting: ByteSource = { read: async (o, l) => (reads.push([o, l]), bytes.subarray(o, o + l)) };
  const t = await openGeoTiff(counting);
  const headerReads = reads.length;
  const im = t.images[0]!;
  const w = await readWindow(t, im, { x: 80, y: 60, width: 20, height: 20 }, inflate);
  assert.ok(Math.abs(w[0]! - expected(80, 60)) < 1e-3);
  assert.ok(Number.isNaN(w[19]!), 'x=99 is outside');
  assert.equal(reads.length - headerReads, 2, 'only the two tiles under the window are fetched (rows 60–69 span tile rows 1 and 2)');
});

test('cached source coalesces reads into blocks', async () => {
  const bytes = load('dem_strips_none.tif');
  let calls = 0;
  const src = cachedSource({ read: async (o, l) => (calls++, bytes.subarray(o, o + l)) }, 4096);
  const t = await openGeoTiff(src);
  await readWindow(t, t.images[0]!, { x: 0, y: 0, width: 90, height: 70 });
  assert.ok(calls <= Math.ceil(bytes.length / 4096) + 1, `${calls} block reads`);
  assert.equal(pickImage(t, 5), t.images[0]);
});

test('rejects non-TIFF input', async () => {
  await assert.rejects(openGeoTiff(bufferSource(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))), /Not a TIFF/);
});
