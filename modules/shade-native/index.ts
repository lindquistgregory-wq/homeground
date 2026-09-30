import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Synchronous native port of `sunHours()` from @plotwright/core. Arguments are typed arrays shared
 * with JS (no copies); `out` is written in place. `mask` may be empty to compute every cell.
 * samples: 4 floats per sun position [sinAz, cosAz, tanAlt, hours].
 * transmittance: 5 floats indexed by material code [none=1, opaque, deciduous, evergreen, film].
 */
export interface ShadeNative {
  /**
   * Expo module functions take at most 8 arguments, so: `heights` = obstacle top heights (n floats)
   * followed by obstacle base heights (n floats); `params` = [width, height, cell, targetHeight, maxDist].
   */
  sunHours(
    ground: Float32Array, heights: Float32Array, material: Uint8Array, samples: Float32Array,
    transmittance: Float32Array, mask: Uint8Array, out: Float32Array, params: Float64Array,
  ): void;
}

export const ShadeNativeModule = requireOptionalNativeModule<ShadeNative>('ShadeNative');
