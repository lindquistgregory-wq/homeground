/**
 * Minimal, dependency-free GeoTIFF / Cloud-Optimized GeoTIFF reader.
 *
 * Supports: classic TIFF and BigTIFF, little/big endian, strips or tiles, single band (extra bands
 * ignored), uint8/int16/uint16/int32/uint32/float32/float64, compression none / LZW / Deflate
 * (inflate is injected so the app uses fflate and tests use node:zlib), predictors 1/2/3, GDAL_NODATA,
 * ModelPixelScale + ModelTiepoint georeferencing, EPSG from GeoKeys, and overview IFDs.
 *
 * Reads are windowed through `ByteSource`, so a COG on S3 is fetched with HTTP Range requests: the
 * header, then only the tiles that intersect the requested window (§3 "read only the needed window").
 */

export interface ByteSource {
  /** Read `length` bytes at `offset`. May return fewer bytes at end of file. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type Inflate = (data: Uint8Array) => Uint8Array;

export class TiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TiffError';
  }
}

export function bufferSource(buf: Uint8Array): ByteSource {
  return { read: async (o, l) => buf.subarray(o, Math.min(buf.length, o + l)) };
}

/** Coalesces nearby reads and caches blocks — keeps range requests few when tiles are adjacent. */
export function cachedSource(inner: ByteSource, blockSize = 65536): ByteSource {
  const blocks = new Map<number, Promise<Uint8Array>>();
  const block = (i: number) => {
    let p = blocks.get(i);
    if (!p) {
      p = inner.read(i * blockSize, blockSize);
      blocks.set(i, p);
      p.catch(() => blocks.delete(i)); // let a failed range read be retried
    }
    return p;
  };
  return {
    async read(offset, length) {
      const first = Math.floor(offset / blockSize), last = Math.floor((offset + length - 1) / blockSize);
      if (length > blockSize * 8) return inner.read(offset, length); // big tile: fetch directly
      const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => block(first + k)));
      const out = new Uint8Array(length);
      let pos = 0;
      for (let k = 0; k < parts.length; k++) {
        const b = parts[k]!;
        const start = k === 0 ? offset - first * blockSize : 0;
        const take = Math.min(b.length - start, length - pos);
        if (take <= 0) break;
        out.set(b.subarray(start, start + take), pos);
        pos += take;
      }
      return pos === length ? out : out.subarray(0, pos);
    },
  };
}

const TAG = {
  ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259, PhotometricInterpretation: 262,
  StripOffsets: 273, SamplesPerPixel: 277, RowsPerStrip: 278, StripByteCounts: 279, PlanarConfiguration: 284,
  Predictor: 317, TileWidth: 322, TileLength: 323, TileOffsets: 324, TileByteCounts: 325, SampleFormat: 339,
  NewSubfileType: 254, ModelPixelScale: 33550, ModelTiepoint: 33922, GeoKeyDirectory: 34735, GdalNoData: 42113,
} as const;

// type id → byte size
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

export interface TiffImage {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  tiled: boolean;
  bitsPerSample: number;
  sampleFormat: number; // 1 uint, 2 int, 3 float
  samplesPerPixel: number;
  planar: number;
  compression: number;
  predictor: number;
  offsets: number[];
  byteCounts: number[];
  noData?: number;
  /** Pixel size in CRS units (x, y). */
  scale?: [number, number];
  /** CRS coordinate of the top-left corner of pixel (0,0). */
  origin?: [number, number];
  epsg?: number;
  isOverview: boolean;
}

export interface GeoTiff {
  images: TiffImage[];
  source: ByteSource;
  littleEndian: boolean;
}

class Reader {
  constructor(
    private dv: DataView,
    readonly le: boolean,
    readonly big: boolean,
  ) {}
  u16(o: number) { return this.dv.getUint16(o, this.le); }
  u32(o: number) { return this.dv.getUint32(o, this.le); }
  u64(o: number) {
    const lo = this.dv.getUint32(o + (this.le ? 0 : 4), this.le);
    const hi = this.dv.getUint32(o + (this.le ? 4 : 0), this.le);
    return hi * 2 ** 32 + lo;
  }
  value(type: number, o: number): number {
    switch (type) {
      case 1: case 2: case 7: return this.dv.getUint8(o);
      case 6: return this.dv.getInt8(o);
      case 3: return this.u16(o);
      case 8: return this.dv.getInt16(o, this.le);
      case 4: return this.u32(o);
      case 9: return this.dv.getInt32(o, this.le);
      case 11: return this.dv.getFloat32(o, this.le);
      case 12: return this.dv.getFloat64(o, this.le);
      case 16: return this.u64(o);
      case 5: return this.u32(o) / this.u32(o + 4);
      default: throw new TiffError(`Unsupported TIFF field type ${type}`);
    }
  }
}

async function readAt(src: ByteSource, offset: number, length: number): Promise<DataView> {
  const b = await src.read(offset, length);
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

export async function openGeoTiff(source: ByteSource): Promise<GeoTiff> {
  const head = await readAt(source, 0, 16);
  const bom = head.getUint16(0, false);
  if (bom !== 0x4949 && bom !== 0x4d4d) throw new TiffError('Not a TIFF file');
  const le = bom === 0x4949;
  const magic = head.getUint16(2, le);
  const big = magic === 43;
  if (magic !== 42 && !big) throw new TiffError('Not a TIFF file');
  const hr = new Reader(head, le, big);
  let ifdOffset = big ? hr.u64(8) : hr.u32(4);

  const images: TiffImage[] = [];
  const entrySize = big ? 20 : 12;
  while (ifdOffset > 0 && images.length < 32) {
    const cntView = await readAt(source, ifdOffset, big ? 8 : 2);
    const cr = new Reader(cntView, le, big);
    const n = big ? cr.u64(0) : cr.u16(0);
    const tableLen = n * entrySize + (big ? 8 : 4);
    const tv = await readAt(source, ifdOffset + (big ? 8 : 2), tableLen);
    const r = new Reader(tv, le, big);
    const fields = new Map<number, number[] | string>();
    for (let i = 0; i < n; i++) {
      const e = i * entrySize;
      const tag = r.u16(e), type = r.u16(e + 2);
      const count = big ? r.u64(e + 4) : r.u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const inline = size <= (big ? 8 : 4);
      const valueOff = e + (big ? 12 : 8);
      let vr: Reader, base: number;
      if (inline) {
        vr = r;
        base = valueOff;
      } else {
        const ptr = big ? r.u64(valueOff) : r.u32(valueOff);
        if (size > 64 * 1024 * 1024) throw new TiffError('TIFF field too large');
        vr = new Reader(await readAt(source, ptr, size), le, big);
        base = 0;
      }
      if (type === 2) {
        let s = '';
        for (let k = 0; k < count; k++) s += String.fromCharCode(vr.value(2, base + k));
        fields.set(tag, s.replace(/\0+$/, ''));
      } else {
        const vals: number[] = new Array(count);
        const ts = TYPE_SIZE[type] ?? 1;
        for (let k = 0; k < count; k++) vals[k] = vr.value(type, base + k * ts);
        fields.set(tag, vals);
      }
    }
    const nextView = await readAt(source, ifdOffset + (big ? 8 : 2) + n * entrySize, big ? 8 : 4);
    const nr = new Reader(nextView, le, big);
    ifdOffset = big ? nr.u64(0) : nr.u32(0);
    images.push(toImage(fields));
  }
  if (images.length === 0) throw new TiffError('TIFF has no images');
  // Overviews inherit georeferencing from the full-resolution image, scaled.
  const full = images[0]!;
  for (const im of images.slice(1)) {
    if (!im.scale && full.scale && full.origin) {
      im.scale = [(full.scale[0] * full.width) / im.width, (full.scale[1] * full.height) / im.height];
      im.origin = full.origin;
      im.epsg ??= full.epsg;
      im.noData ??= full.noData;
    }
  }
  return { images: images.filter((im) => im.samplesPerPixel >= 1 && !(im.isOverview && im.bitsPerSample === 1)), source, littleEndian: le };
}

function nums(f: Map<number, number[] | string>, tag: number): number[] | undefined {
  const v = f.get(tag);
  return Array.isArray(v) ? v : undefined;
}

function toImage(f: Map<number, number[] | string>): TiffImage {
  const width = nums(f, TAG.ImageWidth)?.[0], height = nums(f, TAG.ImageLength)?.[0];
  if (!width || !height) throw new TiffError('TIFF image without dimensions');
  const tiled = f.has(TAG.TileOffsets);
  const tileWidth = tiled ? nums(f, TAG.TileWidth)![0]! : width;
  const tileHeight = tiled ? nums(f, TAG.TileLength)![0]! : (nums(f, TAG.RowsPerStrip)?.[0] ?? height);
  const scale = nums(f, TAG.ModelPixelScale);
  const tie = nums(f, TAG.ModelTiepoint);
  let epsg: number | undefined;
  const gk = nums(f, TAG.GeoKeyDirectory);
  if (gk) {
    for (let i = 4; i + 3 < gk.length; i += 4) {
      const key = gk[i]!, loc = gk[i + 1]!, val = gk[i + 3]!;
      if ((key === 3072 || key === 2048) && loc === 0 && val !== 32767) epsg ??= val;
      if (key === 3072 && loc === 0 && val !== 32767) epsg = val; // projected CRS wins over geographic
    }
  }
  const nd = f.get(TAG.GdalNoData);
  const noData = typeof nd === 'string' && nd.trim() !== '' && Number.isFinite(Number(nd)) ? Number(nd) : undefined;
  return {
    width,
    height,
    tiled,
    tileWidth,
    tileHeight,
    bitsPerSample: nums(f, TAG.BitsPerSample)?.[0] ?? 8,
    sampleFormat: nums(f, TAG.SampleFormat)?.[0] ?? 1,
    samplesPerPixel: nums(f, TAG.SamplesPerPixel)?.[0] ?? 1,
    planar: nums(f, TAG.PlanarConfiguration)?.[0] ?? 1,
    compression: nums(f, TAG.Compression)?.[0] ?? 1,
    predictor: nums(f, TAG.Predictor)?.[0] ?? 1,
    offsets: nums(f, tiled ? TAG.TileOffsets : TAG.StripOffsets) ?? [],
    byteCounts: nums(f, tiled ? TAG.TileByteCounts : TAG.StripByteCounts) ?? [],
    noData,
    scale: scale ? [scale[0]!, scale[1]!] : undefined,
    origin: tie && tie.length >= 6 ? [tie[3]! - tie[0]! * (scale?.[0] ?? 1), tie[4]! + tie[1]! * (scale?.[1] ?? 1)] : undefined,
    epsg,
    isOverview: ((nums(f, TAG.NewSubfileType)?.[0] ?? 0) & 1) === 1,
  };
}

// ---------------- Decompression ----------------

/** TIFF LZW (MSB-first codes, early change), per TIFF 6.0 §13. */
export function lzwDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let op = 0;
  const dictPrefix = new Int32Array(4096);
  const dictChar = new Uint8Array(4096);
  const dictLen = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) (dictPrefix[i] = -1), (dictChar[i] = i), (dictLen[i] = 1);
  let next = 258, width = 9;
  let bitPos = 0;
  const totalBits = input.length * 8;
  const readCode = () => {
    if (bitPos + width > totalBits) return 257;
    let code = 0;
    for (let i = 0; i < width; i++) {
      const byte = input[(bitPos + i) >> 3]!;
      code = (code << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += width;
    return code;
  };
  const emit = (code: number) => {
    const len = dictLen[code]!;
    let c = code;
    for (let k = len - 1; k >= 0; k--) {
      if (op + k < expected) out[op + k] = dictChar[c]!;
      c = dictPrefix[c]!;
    }
    op += len;
  };
  const firstChar = (code: number) => {
    let c = code;
    while (dictPrefix[c]! >= 0) c = dictPrefix[c]!;
    return dictChar[c]!;
  };
  let old = -1;
  for (;;) {
    const code = readCode();
    if (code === 257 || op >= expected) break;
    if (code === 256) {
      next = 258;
      width = 9;
      old = readCode();
      if (old === 257) break;
      emit(old);
      continue;
    }
    if (old < 0) {
      emit(code);
      old = code;
      continue;
    }
    if (code < next) {
      emit(code);
      if (next < 4096) (dictPrefix[next] = old), (dictChar[next] = firstChar(code)), (dictLen[next] = dictLen[old]! + 1), next++;
    } else {
      const fc = firstChar(old);
      if (next < 4096) (dictPrefix[next] = old), (dictChar[next] = fc), (dictLen[next] = dictLen[old]! + 1), next++;
      emit(next - 1);
    }
    old = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

function decodeBlock(im: TiffImage, raw: Uint8Array, rows: number, cols: number, fileLE: boolean, inflate?: Inflate): Float32Array {
  const bps = im.bitsPerSample / 8;
  const spp = im.planar === 1 ? im.samplesPerPixel : 1;
  const expected = rows * cols * spp * bps;
  let bytes: Uint8Array;
  switch (im.compression) {
    case 1: bytes = raw; break;
    case 5: bytes = lzwDecode(raw, expected); break;
    case 8: case 32946:
      if (!inflate) throw new TiffError('Deflate-compressed TIFF needs an inflate function');
      bytes = inflate(raw);
      break;
    default: throw new TiffError(`Unsupported TIFF compression ${im.compression}`);
  }
  if (bytes.length < expected) {
    const padded = new Uint8Array(expected);
    padded.set(bytes);
    bytes = padded;
  } else if (bytes.byteOffset % 8 !== 0) bytes = bytes.slice();

  if (im.predictor === 3) bytes = undoFloatPredictor(bytes, rows, cols * spp, bps);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(rows * cols);
  // The float predictor reassembles samples little-endian; otherwise samples keep the file's byte order.
  const le = im.predictor === 3 ? true : fileLE;
  const read = sampleReader(im, dv, le);
  const stride = spp;
  for (let i = 0; i < rows * cols; i++) out[i] = read(i * stride * bps);
  if (im.predictor === 2) {
    for (let r = 0; r < rows; r++) for (let c = 1; c < cols; c++) out[r * cols + c]! += out[r * cols + c - 1]!;
    if (im.sampleFormat !== 3) wrapIntegers(out, im);
  }
  return out;
}

function wrapIntegers(a: Float32Array, im: TiffImage) {
  const bits = im.bitsPerSample, signed = im.sampleFormat === 2;
  const mod = 2 ** bits;
  for (let i = 0; i < a.length; i++) {
    let v = a[i]! % mod;
    if (v < 0) v += mod;
    if (signed && v >= mod / 2) v -= mod;
    a[i] = v;
  }
}

function sampleReader(im: TiffImage, dv: DataView, le: boolean): (o: number) => number {
  const f = im.sampleFormat, b = im.bitsPerSample;
  if (f === 3 && b === 32) return (o) => dv.getFloat32(o, le);
  if (f === 3 && b === 64) return (o) => dv.getFloat64(o, le);
  if (b === 8) return f === 2 ? (o) => dv.getInt8(o) : (o) => dv.getUint8(o);
  if (b === 16) return f === 2 ? (o) => dv.getInt16(o, le) : (o) => dv.getUint16(o, le);
  if (b === 32) return f === 2 ? (o) => dv.getInt32(o, le) : (o) => dv.getUint32(o, le);
  throw new TiffError(`Unsupported sample type: format ${f}, ${b} bits`);
}

/** Floating-point predictor (Adobe TIFF Tech Note 3): byte-wise differencing across byte planes. */
function undoFloatPredictor(bytes: Uint8Array, rows: number, samplesPerRow: number, bps: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  const rowBytes = samplesPerRow * bps;
  for (let r = 0; r < rows; r++) {
    const row = bytes.subarray(r * rowBytes, (r + 1) * rowBytes);
    const tmp = row.slice();
    for (let i = 1; i < rowBytes; i++) tmp[i] = (tmp[i]! + tmp[i - 1]!) & 0xff;
    // Byte planes are stored most-significant first; reassemble little-endian samples.
    for (let s = 0; s < samplesPerRow; s++)
      for (let b = 0; b < bps; b++) out[r * rowBytes + s * bps + (bps - 1 - b)] = tmp[b * samplesPerRow + s]!;
  }
  return out;
}

// ---------------- Windowed reads ----------------

export interface PixelWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Read band 1 of a pixel window. Pixels outside the image, and noData, become NaN. */
export async function readWindow(tiff: GeoTiff, im: TiffImage, win: PixelWindow, inflate?: Inflate): Promise<Float32Array> {
  const out = new Float32Array(win.width * win.height).fill(NaN);
  const tw = im.tileWidth, th = im.tileHeight;
  const tilesAcross = Math.ceil(im.width / tw);
  const x0 = Math.max(0, win.x), y0 = Math.max(0, win.y);
  const x1 = Math.min(im.width, win.x + win.width), y1 = Math.min(im.height, win.y + win.height);
  if (x1 <= x0 || y1 <= y0) return out;
  const jobs: Promise<void>[] = [];
  for (let ty = Math.floor(y0 / th); ty * th < y1; ty++) {
    for (let tx = im.tiled ? Math.floor(x0 / tw) : 0; tx * tw < (im.tiled ? x1 : 1); tx++) {
      const idx = im.tiled ? ty * tilesAcross + tx : ty;
      const off = im.offsets[idx], len = im.byteCounts[idx];
      const rows = im.tiled ? th : Math.min(th, im.height - ty * th);
      const cols = im.tiled ? tw : im.width;
      jobs.push(
        (async () => {
          if (!off || !len) return; // sparse tile → stays NaN
          const raw = await tiff.source.read(off, len);
          const block = decodeBlock(im, raw, rows, cols, tiff.littleEndian, inflate);
          const bx = im.tiled ? tx * tw : 0, by = ty * th;
          for (let r = 0; r < rows; r++) {
            const py = by + r;
            if (py < y0 || py >= y1) continue;
            for (let c = 0; c < cols; c++) {
              const px = bx + c;
              if (px < x0 || px >= x1) continue;
              const v = block[r * cols + c]!;
              out[(py - win.y) * win.width + (px - win.x)] = im.noData !== undefined && v === im.noData ? NaN : v;
            }
          }
        })(),
      );
    }
  }
  await Promise.all(jobs);
  return out;
}

/** Choose the coarsest image whose pixels are still at least as fine as `targetRes` (CRS units). */
export function pickImage(tiff: GeoTiff, targetRes: number): TiffImage {
  const full = tiff.images[0]!;
  let best = full;
  for (const im of tiff.images) {
    if (!im.scale) continue;
    if (im.scale[0] <= targetRes * 1.01 && im.scale[0] > (best.scale?.[0] ?? 0)) best = im;
  }
  return best;
}
