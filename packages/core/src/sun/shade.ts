/**
 * Direct-sun and shade engine (§5), on-device and explainable.
 *
 *  - Far terrain: one 360° horizon profile for the parcel, from a coarse DEM out to several km
 *    (hills and valleys). If the sun is below it, every cell is shaded.
 *  - Near field: a surface model = fine DEM + obstacle heights (canopy, buildings, design objects).
 *    For each cell and sun position we march toward the sun; if the surface rises above the ray,
 *    the cell is blocked. Opaque obstacles block fully; tree canopy passes a fraction of light that
 *    depends on leaf-on/leaf-off; greenhouse film passes most.
 *  - Direct-sun hours for a day = Σ sample duration × transmittance over daylight samples.
 *
 * All arrays are typed and the inner loop avoids allocation so it can run in a worklet on Hermes.
 */
import { cellCenter, like, type Grid } from '../raster/grid';
import type { SunSample } from './spa';

const D2R = Math.PI / 180;
const EARTH_R = 6_371_000;
const REFRACTION_K = 0.13;

// ---------------- Far-field horizon ----------------

export interface HorizonProfile {
  /** Azimuth step in degrees; angles[k] covers azimuth k·step. */
  stepDeg: number;
  /** Horizon elevation angle (degrees) per azimuth sector. */
  angles: Float32Array;
}

/**
 * Horizon angles seen from (x, y) at `eyeHeight` above ground, scanning a (coarse) DEM between
 * `minDistM` and the DEM edge. Includes Earth curvature with standard refraction.
 */
export function horizonProfile(dem: Grid, x: number, y: number, opts: { stepDeg?: number; eyeHeight?: number; minDistM?: number; maxDistM?: number } = {}): HorizonProfile {
  const stepDeg = opts.stepDeg ?? 2;
  const n = Math.round(360 / stepDeg);
  const angles = new Float32Array(n).fill(-90);
  const z0 = sampleZ(dem, x, y) + (opts.eyeHeight ?? 1.5);
  const minD = opts.minDistM ?? dem.cell * 2;
  const maxD = opts.maxDistM ?? Math.max(dem.width, dem.height) * dem.cell;
  for (let k = 0; k < n; k++) {
    const az = k * stepDeg * D2R;
    const sx = Math.sin(az), sy = Math.cos(az);
    let best = -90;
    // Step grows with distance: fine near, coarse far.
    for (let d = minD; d <= maxD; d += Math.max(dem.cell * 0.5, d * 0.01)) {
      const z = sampleZ(dem, x + sx * d, y + sy * d);
      if (Number.isNaN(z)) break;
      const drop = ((1 - REFRACTION_K) * d * d) / (2 * EARTH_R);
      const a = Math.atan2(z - drop - z0, d) / D2R;
      if (a > best) best = a;
    }
    angles[k] = best;
  }
  return { stepDeg, angles };
}

export function horizonAt(h: HorizonProfile, azimuthDeg: number): number {
  const n = h.angles.length;
  const f = (((azimuthDeg % 360) + 360) % 360) / h.stepDeg;
  const k0 = Math.floor(f) % n, k1 = (k0 + 1) % n, t = f - Math.floor(f);
  return h.angles[k0]! * (1 - t) + h.angles[k1]! * t;
}

function sampleZ(g: Grid, x: number, y: number): number {
  const fi = (x - g.x0) / g.cell - 0.5, fj = (g.y0 - y) / g.cell - 0.5;
  const i = Math.round(fi), j = Math.round(fj);
  if (i < 0 || j < 0 || i >= g.width || j >= g.height) return NaN;
  return g.data[j * g.width + i]!;
}

// ---------------- Surface model ----------------

/** Material codes stored per cell in the obstacle layer. */
export const Material = {
  none: 0,
  opaque: 1, // buildings, sheds, walls, fences
  deciduous: 2,
  evergreen: 3,
  film: 4, // greenhouse / hoop-house covering
} as const;
export type MaterialCode = (typeof Material)[keyof typeof Material];

export interface Transmittance {
  opaque: number;
  deciduousLeafOn: number;
  deciduousLeafOff: number;
  evergreen: number;
  film: number;
}

/** Literature-typical direct-beam transmittance through a crown or cover. Editable in settings. */
export const DEFAULT_TRANSMITTANCE: Transmittance = {
  opaque: 0,
  deciduousLeafOn: 0.15,
  deciduousLeafOff: 0.6,
  evergreen: 0.1,
  film: 0.8,
};

export interface SurfaceModel {
  /** Bare-earth elevation, metres. */
  ground: Grid;
  /** Obstacle top height above ground, metres (0 = open ground). */
  height: Float32Array;
  /** Obstacle base height above ground (e.g. tree crown base), metres. */
  base: Float32Array;
  material: Uint8Array;
}

export function emptySurface(ground: Grid): SurfaceModel {
  const n = ground.width * ground.height;
  return { ground, height: new Float32Array(n), base: new Float32Array(n), material: new Uint8Array(n) };
}

/** Burn an obstacle into the surface model where `mask` is set (keeps the taller obstacle). */
export function burnObstacle(s: SurfaceModel, mask: Grid, heightM: number, material: MaterialCode, baseM = 0): void {
  for (let k = 0; k < mask.data.length; k++) {
    if (!mask.data[k]) continue;
    if (heightM > s.height[k]!) {
      s.height[k] = heightM;
      s.base[k] = baseM;
      s.material[k] = material;
    }
  }
}

/** Burn a canopy-height raster (already resampled to the grid): heights ≥ minTreeM become canopy. */
export function burnCanopy(s: SurfaceModel, canopy: Grid, material: MaterialCode = Material.deciduous, minTreeM = 2): void {
  for (let k = 0; k < canopy.data.length; k++) {
    const h = canopy.data[k]!;
    if (!(h >= minTreeM) || h <= s.height[k]!) continue;
    s.height[k] = h;
    s.base[k] = Math.min(h * 0.3, 3); // crown base ~30 % of height, up to 3 m
    s.material[k] = material;
  }
}

// ---------------- Sun hours ----------------

export interface ShadeOptions {
  /** Height of the "sensor" above ground: 0.3 m ≈ bed surface / seedling height. */
  targetHeightM?: number;
  transmittance?: Transmittance;
  /** True when deciduous trees are in leaf for this date. */
  leafOn?: boolean;
  /** Parcel horizon from the far-field DEM; omitted = flat distant horizon. */
  horizon?: HorizonProfile;
  /** Hours represented by each sun sample. */
  sampleHours: number;
  /** Stop marching after this distance (metres). */
  maxDistM?: number;
  /** Only compute cells where mask ≠ 0 (e.g. the parcel or a changed region). */
  mask?: Uint8Array;
}

export interface PreparedSample {
  sx: number;
  sy: number;
  tanAlt: number;
  hours: number;
}

export function prepareSamples(samples: SunSample[], opts: Pick<ShadeOptions, 'horizon' | 'sampleHours'>): PreparedSample[] {
  const out: PreparedSample[] = [];
  for (const s of samples) {
    if (s.elevation <= 0) continue;
    if (opts.horizon && s.elevation <= horizonAt(opts.horizon, s.azimuth)) continue; // behind hills
    out.push({ sx: Math.sin(s.azimuth * D2R), sy: Math.cos(s.azimuth * D2R), tanAlt: Math.tan(s.elevation * D2R), hours: opts.sampleHours });
  }
  return out;
}

/**
 * Direct-sun hours per cell for one day. Writes into `out` (reused across calls) and returns it.
 * Cells outside `mask` keep their previous values, which is what makes incremental updates cheap.
 */
export function sunHours(s: SurfaceModel, samples: PreparedSample[], opts: ShadeOptions, out: Grid = like(s.ground, 0)): Grid {
  const g = s.ground;
  const W = g.width, H = g.height, cell = g.cell;
  const tr = opts.transmittance ?? DEFAULT_TRANSMITTANCE;
  const tDecid = opts.leafOn === false ? tr.deciduousLeafOff : tr.deciduousLeafOn;
  const trans = new Float32Array([1, tr.opaque, tDecid, tr.evergreen, tr.film]);
  const targetH = opts.targetHeightM ?? 0.3;
  const maxDist = opts.maxDistM ?? 250;
  const step = cell * 0.75;

  // Highest surface in the grid bounds how far a ray can be blocked.
  let maxTop = -Infinity;
  for (let k = 0; k < g.data.length; k++) {
    const t = g.data[k]! + s.height[k]!;
    if (t > maxTop) maxTop = t;
  }

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k0 = j * W + i;
      if (opts.mask && !opts.mask[k0]) continue;
      const z0 = g.data[k0]!;
      if (Number.isNaN(z0)) {
        out.data[k0] = NaN;
        continue;
      }
      // Inside an obstacle footprint: a bed under a greenhouse still gets filtered light, under a shed none.
      const own = s.material[k0]!;
      const ownT = own && s.height[k0]! > targetH ? trans[own]! : 1;
      const eye = z0 + targetH;
      const fi = i + 0.5, fj = j + 0.5;
      let total = 0;
      for (let p = 0; p < samples.length; p++) {
        const smp = samples[p]!;
        const reach = Math.min(maxDist, (maxTop - eye) / smp.tanAlt);
        let t = ownT;
        let lastMat = own;
        // Incremental stepping in cell units (no per-step multiply/floor on Hermes).
        const di = (smp.sx * step) / cell, dj = (-smp.sy * step) / cell, dz = step * smp.tanAlt;
        let fx = fi, fy = fj, ray = eye;
        for (let d = step; d <= reach && t > 0; d += step) {
          fx += di;
          fy += dj;
          ray += dz;
          if (fx < 0 || fy < 0 || fx >= W || fy >= H) break;
          const k = (fy | 0) * W + (fx | 0);
          const mat = s.material[k]!;
          const zg = g.data[k]!;
          if (mat) {
            const top = zg + s.height[k]!, bottom = zg + s.base[k]!;
            if (ray <= top && ray >= bottom) {
              // Count each contiguous run through the same material once.
              if (mat !== lastMat) t *= trans[mat]!;
              lastMat = mat;
              continue;
            }
            if (mat === lastMat && ray < bottom) {
              // Passing under the same crown (e.g. from a cell beneath a tree): still one crown.
              if (zg > ray) {
                t = 0;
                break;
              }
              continue;
            }
          }
          if (zg > ray) {
            t = 0; // terrain blocks
            break;
          }
          lastMat = 0;
        }
        total += smp.hours * t;
      }
      out.data[k0] = total;
    }
  }
  return out;
}

export type SunClass = 'full' | 'part' | 'shade';

/** §5.4: Full sun ≥ 6 h, part sun/shade 3–6 h, shade < 3 h. */
export function sunClass(hours: number): SunClass {
  return hours >= 6 ? 'full' : hours >= 3 ? 'part' : 'shade';
}

/**
 * Cells whose value can change when obstacles change inside `bounds` (UTM [xmin, ymin, xmax, ymax]):
 * the region itself plus everything the object's shadow can reach for these sun positions.
 */
export function affectedMask(g: Grid, bounds: [number, number, number, number], maxHeightM: number, samples: PreparedSample[]): Uint8Array {
  const mask = new Uint8Array(g.width * g.height);
  let [xmin, ymin, xmax, ymax] = bounds;
  // On sloping ground a shadow reaches further downhill: use the object's highest ground minus the
  // lowest ground in the grid (conservative) on top of the object's height. `g` is the ground grid.
  let zTop = -Infinity, zMin = Infinity;
  for (let j = 0; j < g.height; j++)
    for (let i = 0; i < g.width; i++) {
      const z = g.data[j * g.width + i]!;
      if (Number.isNaN(z)) continue;
      if (z < zMin) zMin = z;
      const [x, y] = cellCenter(g, i, j);
      if (x >= bounds[0] - g.cell && x <= bounds[2] + g.cell && y >= bounds[1] - g.cell && y <= bounds[3] + g.cell && z > zTop) zTop = z;
    }
  const drop = Number.isFinite(zTop) && Number.isFinite(zMin) ? Math.max(0, zTop - zMin) : 0;
  for (const s of samples) {
    const L = Math.min(250, (maxHeightM + drop) / Math.max(s.tanAlt, 0.02));
    // Shadow is cast away from the sun.
    xmin = Math.min(xmin, bounds[0] - s.sx * L);
    xmax = Math.max(xmax, bounds[2] - s.sx * L);
    ymin = Math.min(ymin, bounds[1] - s.sy * L);
    ymax = Math.max(ymax, bounds[3] - s.sy * L);
  }
  const pad = g.cell;
  for (let j = 0; j < g.height; j++)
    for (let i = 0; i < g.width; i++) {
      const [x, y] = cellCenter(g, i, j);
      if (x >= xmin - pad && x <= xmax + pad && y >= ymin - pad && y <= ymax + pad) mask[j * g.width + i] = 1;
    }
  return mask;
}

/**
 * Leaf-on for deciduous trees: from roughly two weeks after the median last spring frost to around
 * the median first fall frost. Uses the parcel's frost dates when available, otherwise mid-May → mid-Oct.
 */
export function isLeafOn(dayOfYear: number, lastSpringDoy?: number | null, firstFallDoy?: number | null): boolean {
  const on = (lastSpringDoy ?? 125) + 14;
  const off = firstFallDoy ?? 288;
  return dayOfYear >= on && dayOfYear < off;
}
