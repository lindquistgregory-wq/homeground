# Phase 2 report: Sun & design

**Date:** 2026-09-28 · **Branch:** `phase-2` (stacked on `phase-1`) · **Status:** code complete. The app, and the Swift/Kotlin shade module, are not yet compiled on a device.

## What was built

| Plan item (§5, §6) | Where | State |
|---|---|---|
| NREL Solar Position Algorithm on-device | `packages/core/src/sun/spa.ts` | Done. Matches the NREL worked example, and pvlib on 300 random cases to <0.0001° |
| Sun path: solstice, equinox and today arcs; sunrise, solar noon, sunset; time scrubber | `app/sun/[id].tsx` | Done. Drawn over the parcel's real terrain horizon |
| Terrain horizon | `horizonProfile` (30 m 3DEP out to 5 km, with Earth curvature) | Done |
| Elevation data | 3DEP `exportImage` in the parcel's UTM zone (1 m where lidar exists), TNM lidar check, own GeoTIFF/COG reader (LZW, Deflate, predictors, tiles, BigTIFF) | Done |
| Tree heights | Meta/WRI Canopy Height Maps v2 via HTTP Range reads of one zoom-10 tile, leaf-on/off from the parcel's frost dates | Done (Homestead Pro). Tile layout still needs a live check (see below) |
| Buildings | "Add existing buildings from the map": OpenStreetMap outlines via the basemap, editable heights, attributed in exports | Done |
| Shade engine | `packages/core/src/sun/shade.ts`, plus a native Swift/Kotlin port in `modules/shade-native` | Done. Direct-sun hours, full/part/shade classes, partial light through tree crowns and greenhouse film |
| Live updates | Only the cells an edited object can shade are recomputed; native engine used when linked | Done |
| Ground truth | "Sun checks": the user says sun or shade where they stand, it's compared with the model, and the agreement rate is shown | Done |
| Design mode | 60-object library with real dimensions and heights; place, move, rotate, resize, label, cost; align to boundary; snap swales to contour; warnings for boundary, setback, slope and overlaps; materials and costs; versions | Done |
| Layers | Imagery, hillshade, contours (auto-widened on steep ground), sun-hours heatmap (colour-blind-safe), siting suitability | Done, gated per the tier table |
| Siting assistant | Greenhouse, garden, orchard, coop, solar: scores from winter/summer sun, slope, and cold-air pooling (Pro) | Done |
| Solar-array estimate | NASA POWER monthly radiation plus tilt, facing and standard losses; no PV API | Done (Pro) |
| Export | PDF plan to scale with scale bar and north arrow; GeoJSON, KML, DXF (R12) | Done. Display-only county boundaries and OSM credit handled |

## Verification

- `pnpm check` passes: type-check, **123 tests**, and the zero-cost gate. New tests cover:
  - the NREL SPA vector
  - the wall-shadow formula L = h / tan(altitude) (§5.7)
  - "a shed south of a bed lowers its December sun" (§14 acceptance)
  - incremental vs full recompute, including a moved object on a 22° slope
  - a tree crown counted once
  - fences casting shade
  - TIFF variants, horizon with Earth curvature, and the terrain analyses
  - exports that round-trip through our own importers
  - the US-evening "today" case and the polar-circle sunrise case
- The screens type-check against the shared packages, with React Native types stubbed.
- **Independent review** found 22 defects in Phase 2. All are fixed, each with a regression test that fails on the old code where testable. The worst four would have broken headline features on first use:
  - compressed TIFFs failed to decode in the app
  - NASA solar data was read as kWh when it was in MJ (3.6× too high)
  - tapping an object selected and then immediately deselected it
  - "today" jumped to tomorrow on US evenings

## Performance spike (ADR 0001)

Node (V8, JIT) on a synthetic yard, 15-minute sun samples, winter solstice:

| Scene | Full day | Move a greenhouse (incremental) |
|---|---|---|
| 50 m square @ 0.5 m (10k cells) | 158 ms | 52 ms |
| 100 m square @ 1 m (10k cells) | 113 ms | 73 ms |
| 200 m square @ 1 m (40k cells) | 547 ms | 241 ms |

Hermes (React Native's engine) has no JIT and is typically several times slower than V8 on loops like this. So the TypeScript engine is borderline for the < 500 ms target on mid-range phones, and that's why the inner loop is also ported to Swift and Kotlin. The native port is used automatically when linked. **Settings → Diagnostics** runs both engines on the phone, reports their timings and checks that they agree. That on-device number decides whether any further tuning is needed.

## Not verified (needs your machine)

1. **The native build.** Same as Phase 1, plus the new `modules/shade-native` Swift/Kotlin module and the new packages (`react-native-svg`, `expo-print`, `expo-sharing`). Run `expo install --fix`, build, then open Settings → Diagnostics.
2. **Live raster services.**
   - The exact CHMv2 tile path and its pixel type. The prefix is confirmed from the AWS registry and Meta's notebook (zoom-10 quadkey COGs in EPSG:3857), but not the byte layout.
   - The 3DEP `exportImage` size limit and compression.
   - The TNM lidar query.
   - `scripts/record-fixtures.ts` should be extended to fetch one of each; that's the first task for next session if you want it.
3. **MapLibre behaviours** that can only be seen on a device: building-layer ids in the OpenFreeMap style (`building`, `building-3d`), and GeoJSON performance with ~15k heatmap cells.

## Known limitations

- **Frost pockets** feed the siting assistant, but don't yet shift the Site Profile's frost dates.
- **Sun and solar outputs:** per-cell insolation (kWh/m²) is computed in core but not shown yet, and the solar estimate doesn't subtract shade from the plan.
- **Trees from satellite data can be added to, but not lowered.** To correct an over-estimate, a "remove satellite tree here" tool is needed.
- **Design versions** are kept on the device only. Designs themselves sync.
- **Tall crops shading their neighbours** comes with plant data in Phase 3.
- **Big parcels:** analysis is capped at ~60k cells and the heatmap at ~15k map cells, so large parcels use a coarser grid (shown in the Sun tab).
- **Sun times** use the phone's time zone. Imagery flight dates aren't shown per area yet.

## Zero-cost confirmation

New services: 3DEP ImageServer and TNM Access (public domain), Meta/WRI CHMv2 on AWS Open Data (CC BY 4.0, credited in the app), NASA POWER (NASA open data, acknowledged), and USGS shaded relief tiles (public domain). New libraries: `react-native-svg`, `expo-print` and `expo-sharing` (all MIT). No keys, nothing metered, no server. All of it is enforced by `pnpm check:licenses`.

## Next: Phase 3 (planting guide)

Plant database (licence checked per source), explainable per-bed suitability using these sun hours, a parcel-adjusted planting calendar, extension-guide links, and local-notification frost alerts from cached NWS forecasts.
