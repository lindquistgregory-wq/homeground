package app.plotwright.shadenative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Float32Array
import expo.modules.kotlin.typedarray.Float64Array
import expo.modules.kotlin.typedarray.Uint8Array
import java.nio.ByteOrder

/**
 * Line-for-line port of `sunHours()` in packages/core/src/sun/shade.ts. Keep the two in sync:
 * Settings → Diagnostics runs both on the same scene and reports the largest difference.
 */
class ShadeNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShadeNative")

    Function("sunHours") { ground: Float32Array, heights: Float32Array, material: Uint8Array, samples: Float32Array,
                           trans: Float32Array, mask: Uint8Array, out: Float32Array, params: Float64Array ->
      val pr = params.toDirectBuffer().order(ByteOrder.nativeOrder()).asDoubleBuffer()
      val width = pr.get(0).toInt(); val height = pr.get(1).toInt()
      val cell = pr.get(2); val targetHeight = pr.get(3); val maxDist = pr.get(4)
      val n = width * height
      val g = ground.toDirectBuffer().order(ByteOrder.nativeOrder()).asFloatBuffer()
      val hs = heights.toDirectBuffer().order(ByteOrder.nativeOrder()).asFloatBuffer()
      val hTop = hs.duplicate()
      val hBase = (hs.duplicate().position(n) as java.nio.FloatBuffer).slice()
      val mat = material.toDirectBuffer()
      val smp = samples.toDirectBuffer().order(ByteOrder.nativeOrder()).asFloatBuffer()
      val tr = trans.toDirectBuffer().order(ByteOrder.nativeOrder()).asFloatBuffer()
      val o = out.toDirectBuffer().order(ByteOrder.nativeOrder()).asFloatBuffer()
      val useMask = mask.length == n
      val m = mask.toDirectBuffer()
      val nSamples = samples.length / 4
      val step = cell * 0.75

      var maxTop = Double.NEGATIVE_INFINITY
      for (k in 0 until n) { val t = g.get(k).toDouble() + hTop.get(k); if (t > maxTop) maxTop = t }

      for (j in 0 until height) {
        for (i in 0 until width) {
          val k0 = j * width + i
          if (useMask && m.get(k0).toInt() == 0) continue
          val z0 = g.get(k0).toDouble()
          if (z0.isNaN()) { o.put(k0, Float.NaN); continue }
          val own = mat.get(k0).toInt() and 0xff
          val ownT = if (own != 0 && hTop.get(k0) > targetHeight) tr.get(own).toDouble() else 1.0
          val eye = z0 + targetHeight
          var total = 0.0
          for (p in 0 until nSamples) {
            val sx = smp.get(p * 4).toDouble(); val sy = smp.get(p * 4 + 1).toDouble()
            val tanAlt = smp.get(p * 4 + 2).toDouble(); val hours = smp.get(p * 4 + 3).toDouble()
            val reach = minOf(maxDist, (maxTop - eye) / tanAlt)
            var t = ownT
            var lastMat = own
            val di = sx * step / cell; val dj = -sy * step / cell; val dz = step * tanAlt
            var fx = i + 0.5; var fy = j + 0.5; var ray = eye
            var d = step
            while (d <= reach && t > 0) {
              fx += di; fy += dj; ray += dz
              if (fx < 0 || fy < 0 || fx >= width || fy >= height) break
              val k = fy.toInt() * width + fx.toInt()
              val mt = mat.get(k).toInt() and 0xff
              val zg = g.get(k).toDouble()
              var inside = false
              var underSame = false
              if (mt != 0) {
                val topZ = zg + hTop.get(k); val bottomZ = zg + hBase.get(k)
                if (ray <= topZ && ray >= bottomZ) {
                  if (mt != lastMat) t *= tr.get(mt).toDouble()
                  lastMat = mt
                  inside = true
                } else if (mt == lastMat && ray < bottomZ) {
                  underSame = true // passing under the same crown: still one crown
                }
              }
              if (!inside) {
                if (zg > ray) { t = 0.0; break }
                if (!underSame) lastMat = 0
              }
              d += step
            }
            total += hours * t
          }
          o.put(k0, total.toFloat())
        }
      }
    }
  }
}
