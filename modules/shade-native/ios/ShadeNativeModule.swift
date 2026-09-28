import ExpoModulesCore

/// Line-for-line port of `sunHours()` in packages/core/src/sun/shade.ts. Keep the two in sync:
/// Settings → Diagnostics runs both on the same scene and reports the largest difference.
public class ShadeNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShadeNative")

    Function("sunHours") { (ground: Float32Array, heights: Float32Array, material: Uint8Array, samples: Float32Array,
                            trans: Float32Array, mask: Uint8Array, out: Float32Array, params: Float64Array) in
      let pr = params.rawPointer.bindMemory(to: Float64.self, capacity: 5)
      let width = Int(pr[0]), height = Int(pr[1])
      let cell = pr[2], targetHeight = pr[3], maxDist = pr[4]
      let n = width * height
      let g = ground.rawPointer.bindMemory(to: Float32.self, capacity: n)
      let hTop = heights.rawPointer.bindMemory(to: Float32.self, capacity: 2 * n)
      let hBase = hTop + n
      let mat = material.rawPointer.bindMemory(to: UInt8.self, capacity: n)
      let smp = samples.rawPointer.bindMemory(to: Float32.self, capacity: samples.length)
      let tr = trans.rawPointer.bindMemory(to: Float32.self, capacity: 5)
      let o = out.rawPointer.bindMemory(to: Float32.self, capacity: n)
      let useMask = mask.length == n
      let m = mask.rawPointer.bindMemory(to: UInt8.self, capacity: max(mask.length, 1))
      let nSamples = samples.length / 4
      let step = cell * 0.75

      var maxTop = -Double.infinity
      for k in 0..<n { let t = Double(g[k]) + Double(hTop[k]); if t > maxTop { maxTop = t } }

      for j in 0..<height {
        for i in 0..<width {
          let k0 = j * width + i
          if useMask && m[k0] == 0 { continue }
          let z0 = Double(g[k0])
          if z0.isNaN { o[k0] = Float.nan; continue }
          let own = Int(mat[k0])
          let ownT: Double = (own != 0 && Double(hTop[k0]) > targetHeight) ? Double(tr[own]) : 1
          let eye = z0 + targetHeight
          var total = 0.0
          for p in 0..<nSamples {
            let sx = Double(smp[p * 4]), sy = Double(smp[p * 4 + 1]), tanAlt = Double(smp[p * 4 + 2]), hours = Double(smp[p * 4 + 3])
            let reach = min(maxDist, (maxTop - eye) / tanAlt)
            var t = ownT
            var lastMat = own
            let di = sx * step / cell, dj = -sy * step / cell, dz = step * tanAlt
            var fx = Double(i) + 0.5, fy = Double(j) + 0.5, ray = eye
            var d = step
            while d <= reach && t > 0 {
              fx += di; fy += dj; ray += dz
              if fx < 0 || fy < 0 || fx >= Double(width) || fy >= Double(height) { break }
              let k = Int(fy) * width + Int(fx)
              let mt = Int(mat[k])
              let zg = Double(g[k])
              var inside = false
              var underSame = false
              if mt != 0 {
                let topZ = zg + Double(hTop[k]), bottomZ = zg + Double(hBase[k])
                if ray <= topZ && ray >= bottomZ {
                  if mt != lastMat { t *= Double(tr[mt]) }
                  lastMat = mt
                  inside = true
                } else if mt == lastMat && ray < bottomZ {
                  underSame = true // passing under the same crown: still one crown
                }
              }
              if !inside {
                if zg > ray { t = 0; break }
                if !underSame { lastMat = 0 }
              }
              d += step
            }
            total += hours * t
          }
          o[k0] = Float(total)
        }
      }
    }
  }
}
