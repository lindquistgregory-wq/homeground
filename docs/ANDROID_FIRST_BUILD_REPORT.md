# Android first build report

**Date:** 2026-09-30 · **Merged:** PRs #8–#11 into `main` (`372564c`) · **Device:** Samsung Galaxy S23+ (SM-S916U), Android 16 · **Status:** first native build compiled, installed and smoke-tested; debug and release.

This is the first time the native code was compiled (Phase 6's "Not verified" item 1). `docs/ANDROID_BUILD.md` has the build steps and the workarounds.

## What had to change

| Problem | Fix | PR |
|---|---|---|
| Most Expo / React Native dependencies were `"*"`, so pnpm installed SDK 57 / RN 0.87 next to the SDK 55 app | Pinned to SDK 55; root `pnpm.overrides` for `expo-modules-core`, `react`, `react-dom`, `react-native`; lockfile committed | #8 |
| The three local modules used the pre-SDK 55 Gradle setup (no `compileSdk`) | `expo-module-gradle-plugin`; import from `expo`, not `expo-modules-core` | #8 |
| Play Services Ads 25.x ships Kotlin 2.3 metadata; RN 0.83 compiles with Kotlin 2.1 | Config plugin skips the metadata check for `react-native-google-mobile-ads` only | #8 |
| ML Kit `genai-prompt` beta3+ pulls `kotlin-stdlib` 2.3 into the whole app, which crashes the Kotlin 2.1 compiler | Pinned to 1.0.0-beta2 (core Prompt API only) | #8 |
| MapLibre loaded twice (`require()` → CommonJS build, `import` → ESM build): "MLRNCamera" invariant at startup | Static import in `offlinePacks.ts` | #8 |
| Android 15+ edge-to-edge: ad banner and bottom buttons under the navigation bar | Screen stack padded by the bottom safe-area inset | #9 |
| Dev tier buttons hidden in native builds | Documented the existing `EXPO_PUBLIC_BILLING_STUB=1` switch | #9 |
| `pnpm check` red on `main`: root tests couldn't resolve workspace packages (hoisted linker); 6 app type errors; a licence record mismatch | Root `workspace:*` devDependencies; typed MapLibre style constants and refs; `react-native-ble-plx` recorded as MIT with a note | #10 |
| Elevation card showed "0.00003086419871794868 m DEM" (EPQS reports degrees for geographic DEMs) | `demResolution()`: "~3 m (1/9 arc-second) DEM" | #11 |
| Our own timeouts reported as "Network error"; the NHD service often takes 60 s+ | "took too long to respond"; NHD gets 45 s × 2 and a clearer message | #11 |
| CI installed with `--no-frozen-lockfile` | `--frozen-lockfile` | #11 |

## Verified on the phone

Doc smoke test, all five steps:

1. Address search (US Census geocoder), drawn boundary (2.61 ac), Site Profile: elevation, hardiness zone, soils, frost dates (elevation-adjusted from 3 NOAA stations), flood zone. Streams & ponds failed because the USGS NHD service was timing out; the message now says so.
2. Design: raised bed placed; Sun tab computed on the native engine.
3. Planting calendar; plant library with Google **test** banner ads (debug).
4. Dev: Homestead Pro (via the billing stub), then an offline pack: 11 of 11 imagery tiles saved.
5. Planner: `ondevice-llm` correctly reports Gemini Nano unavailable on the S23+ and falls back to guided questions.

Also confirmed:

- All three local native modules load: `shade-native` (benchmark and Sun tab), `ondevice-llm` (availability check), `user-sync` (Settings).
- Play Billing resolves to a single version, 9.1.0 (Phase 6 item 1).
- Release build: 169 MB APK (debug 295 MB), cold start 367 ms, no errors. Release builds use no real ad units yet (`ADMOB_UNITS` is empty), so no ads load.

## Performance (release build)

Settings → Diagnostics, synthetic 100 m yard, 3 runs:

| | Debug | Release |
|---|---|---|
| Native full day | 1,200 ms | ~220 ms |
| Native move-a-structure | not measured | **~160 ms** |
| JS full day | 1,978 ms | ~2,250 ms |
| JS move-a-structure | 1,483 ms | ~1,665 ms |

The benchmark used to time moves on the JS engine only; it now also times the native move (same 6 × 3 m greenhouse, Dec 21, so long low-sun shadows) and leads with the native figures, which is what the app uses when the module is linked.

On the real 2.61 ac parcel (Design → Sun, Jun 21, native engine): full day 104 ms; moving the raised bed 79, 78 and 64 ms. **The < 500 ms target is met on the native engine.** The JS engine alone misses it by more than 3×, which matters only where the native module isn't linked.

## Still not verified

- iOS: nothing native has been built.
- Gemini Nano chat: needs a Pixel 9 / Galaxy S25-class phone; `genai-prompt` is on beta2 until RN's Kotlin reaches 2.2.
- Sandbox purchases, consent form (EEA), interstitial timing, rewarded unlocks (Phase 6 items 2–3).
- Bluetooth sensors.
- Maestro flows.
- R8 minification (off in the current release config).

## Known limitations

- The two Kotlin workarounds (ads metadata check, `genai-prompt` beta2) stay until React Native moves to Kotlin 2.2 or newer.
- Sun results on wooded lots show full sun on the free plan: tree shade from canopy heights is a Pro layer.
- A Site Profile refresh can take ~90 s when the NHD service is down, because the profile saves once every layer finishes.
- On Windows, Metro doesn't see edits to `packages/*` made through the workspace junctions; restart it with `--clear`.

## Zero-cost confirmation

No new npm packages, native SDKs, network hosts, keys or services. `genai-prompt` moved to an older version of the same free library.
