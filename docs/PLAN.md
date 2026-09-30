# Homestead App — Architecture & Phased Plan (v1, awaiting approval)

Written 2026-09-28 against the "Parcel-Aware Homestead & Garden Planner (Zero-Running-Cost Edition)" build prompt.

## Decisions so far
| Question | Answer |
|---|---|
| Existing codebase | None. Greenfield build, so there's no §0 audit and no paid dependencies to remove |
| Platforms / region | iOS + Android, US first. International layers wait until later, behind the provider interfaces |
| Backend | None. The app is local-first and syncs through the user's own iCloud or Google Drive |
| Minimum OS | iOS 17 / Android 10 (API 29). On-device AI is detected at runtime; every other device gets the rules-based planner |
| Business model | Undecided. Entitlements are stubbed so both §10 (tiers) and §12 (open source + ads) remain possible |
| Web build | Dropped for now (not a target platform). The core logic stays pure TypeScript, so a web build can be added later |
| Still open | App name, branding and tier names (§15 Q4); livestock and enterprise priorities (§15 Q5, not needed until Phase 5) |

## Proposed stack (needs your approval, since this is the framework choice)
**React Native (Expo SDK, custom dev client, TypeScript)** rather than Flutter. Here's why:
- Most of the GIS tooling the prompt relies on is JavaScript: geotiff.js (windowed COG reads), proj4js, Turf, shpjs, @tmcw/togeojson, and DXF parsers. With TypeScript, the analysis core is a set of plain packages that can be unit-tested in Node and moved to a web build later without changes.
- Expo Modules make it easy to write the Swift and Kotlin pieces the prompt needs: Foundation Models, Gemini Nano, CloudKit, and Drive app-data.
- Mature free libraries exist for each need: @maplibre/maplibre-react-native (maps and offline packs), react-native-ble-plx (BLE scanning), expo-iap or react-native-iap (StoreKit 2 / Play Billing), react-native-google-mobile-ads (AdMob plus UMP consent), expo-sqlite with Drizzle ORM (local database), and expo-notifications / expo-background-task (local alerts).
- **Risk to address first:** Hermes (React Native's JS engine) is slower than Dart or native code for raster math. Phase 2 therefore starts with a performance spike: running horizon and shade calculations in a worklet thread for a 1 m grid over a backyard. If that misses the < 500 ms target, only the hot loop moves into a small native module (Swift/Kotlin, or shared C++ through JSI). The rest of the design stays the same.
- Flutter would also work (Dart isolates are faster for raster math), but it would mean reimplementing or bridging the GIS parsers. My recommendation is React Native.

### Repo layout (pnpm monorepo)
```
apps/mobile/            Expo app (expo-router, Zustand for UI state)
packages/core/          pure TS: units, UTM projection, geometry, frost/GDD/ET0, SPA, horizon, shade, scoring
packages/providers/     one interface per data source + implementations + recorded-fixture tests
                        ParcelProvider, GeocodeProvider, ElevationProvider, DemProvider, SoilsProvider,
                        ClimateNormalsProvider, ForecastProvider, FloodProvider, HydroProvider, ...
                        each declares `region` capability flags and returns {value, source, license,
                        retrieved_at, resolution, confidence}
packages/data/          bundled static data: county parcel-endpoint registry (by FIPS), PHZM zone lookup,
                        plant DB (Phase 3), planner knowledge base (Phase 5)
modules/user-sync/      Expo native module: CloudKit private DB (iOS) / Drive appDataFolder (Android)
modules/ondevice-llm/   Expo native module: Foundation Models (iOS 26+) / ML Kit GenAI Prompt API (Phase 5)
docs/                   DATA_SOURCES.md, open-source-ad-model.md (Phase 6), ADRs
scripts/check-licenses  CI: fail if any dependency or data source lacks a free-commercial-use entry
```
Data lives in on-device SQLite: parcels, site-profile layers with TTLs, designs, sensor readings, and a tile/raster cache. Sync writes a change log of records to the user's own cloud storage (last-writer-wins per record, with a version vector). There's also a manual export/import file for people who switch between iPhone and Android.

## Phase plan (maps to §13)
Each phase ends with tests, a summary, a confirmation that no paid dependency was added, a list of known limitations, and a pause for your go-ahead.

**Phase 1 — Foundation**, delivered as three milestones:
- **1a Skeleton:** monorepo, Expo dev client, CI (lint, type-check, unit tests, license check), SQLite schema and migrations, entitlement module with Free/Grower/Pro stubbed plus a feature-flag map, and the Data Sources screen.
- **1b Location & boundary:** Census geocoder, GPS, and tap-on-map. MapLibre with the OpenFreeMap basemap and USGS/NAIP imagery (showing capture date). County ArcGIS registry lookup (FIPS → endpoint → point-in-polygon query) that strips owner and mailing fields at ingest. Boundary drawing and editing, walk-the-line capture, and import of KML/KMZ, GeoJSON, zipped Shapefile, GPX and DXF. User-contributed endpoints are validated on-device. UTM measurement and the survey disclaimer.
- **1c Site Profile v1:** EPQS elevation, PHZM zone, NCEI 1991–2020 normals and freeze probabilities (nearest stations plus lapse-rate adjustment), SSURGO soils via SDA (throttled), FEMA NFHL flood zone, and NHD water features. Each layer shows source, date and confidence, and missing layers show an explicit "unavailable" state. Cold/cached timing targets are 30 s / 2 s. User-cloud sync goes in here too.

**Phase 2 — Sun & design:** starts with the Hermes performance spike. Then on-device NREL SPA (tested against its published test vectors), 3DEP DEM windowed reads with a buffer, terrain horizon, Meta/WRI canopy and OSM building shading, and the sun-hours heatmap. Design mode gets the object library, snapping, setbacks and slope warnings, versions, and PNG/PDF/GeoJSON/KML export.

**Phase 3 — Planting guide:** plant database (license checked per source), explainable per-bed suitability scoring, a parcel-adjusted calendar, extension-guide links, and local-notification alerts from cached NWS forecasts.

**Phase 4 — Sensors:** BLE decoders (BTHome, Govee, SwitchBot, Inkbird, RuuviTag, Xiaomi/MiFlora, with bindkey support), cloud connectors for Ecowitt, Ambient, Davis and Tempest using the user's own keys, local-network mode, CSV import, and shade-model calibration.

**Phase 5 — AI Planner:** local tool functions and knowledge base first, then the rules-based planner (it works on every device), then the Foundation Models and Gemini Nano bridges, then the income module.

**Phase 6 — Monetization & polish:** AdMob plus UMP consent and ATT, paywall and trials, Pro gating, offline parcel packs, consent-gated analytics, and the §12 open-source/ads assessment with the revenue calculator.

## Issues in the build prompt to flag now
1. **iOS builds need a Mac.** This cloud workspace runs Linux, so here I can write all the code, run every TypeScript test, and build Android. iOS builds need Xcode on your Mac or Expo's EAS Build service. EAS has a free tier with a monthly build quota, so re-check that it stays within zero cost. Expo Go can't run this app because of its native modules.
2. **CI minutes:** GitHub Actions is free and unlimited for public repos. Private repos get a monthly free quota, which should be enough if CI runs only the TypeScript tests and leaves out native builds.
3. **Google Drive sync** needs an OAuth client ID. It's free and not a secret, but Google may require a consent-screen review for the scope. Verify this before 1c. CloudKit is covered by the Apple Developer membership.
4. **"Family sharing" for Pro:** Apple supports Family Sharing for subscriptions. As far as I know, Google Play's Family Library does not cover subscriptions, so Android Pro might not be shareable. Verify this before promising it in the tier table.
5. **Firebase Analytics and AdMob** send device data to Google, which is not your server. That's consistent with §7 of the prompt, as long as both are consent-gated and never receive location, parcel, or sensor data. AdMob should get no location targeting.
6. **iOS 17 minimum vs. Foundation Models (iOS 26+)** is fine. It needs availability checks, and the planner has to work well without AI because many users will have the rules-based version.
7. The prompt's own dataset notes should be re-checked when each provider is built, especially Meta/WRI canopy v2 access paths, the NCEI normals endpoints, and the terms of each state parcel service.

## What I need from you
- Approve **React Native/Expo** (or say "Flutter").
- Approve the plan, or change it.
- App name (a working name is fine) and whether the tier names Free / Grower / Homestead Pro are OK.
- Where the code should live: I can create a GitHub repo if you connect one, or deliver it as a zip.
