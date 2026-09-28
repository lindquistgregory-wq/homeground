# Phase 1 report: Foundation

**Date:** 2026-09-28 · **Branch:** `phase-1` · **Status:** code complete. The mobile app is not yet compiled on a device (see "Not verified").

## What was built

| Plan item | Where | State |
|---|---|---|
| Monorepo, CI, zero-cost gate | root, `.github/workflows/ci.yml`, `scripts/check-licenses.ts`, `licenses.json` | Done. The gate fails on an unrecorded dependency or network host |
| Local-first storage | `apps/mobile/src/db` (expo-sqlite, numbered migrations, SQLite HTTP cache) | Done |
| User-cloud sync | `packages/core/src/sync.ts` (HLC, last-writer-wins, tombstones, ordered apply); `modules/user-sync` (CloudKit) | iOS done; **Android Drive is a stub**, so Android runs local-only |
| Locate | Census geocoder, Nominatim (non-US, rate-limited), GPS, tap-on-map | Done |
| Parcel boundary | County/state ArcGIS registry (NY, WI seeded), remote registry refresh, user-contributed endpoints validated on-device, draw, walk-the-line GPS, import of KML/KMZ/GeoJSON/SHP(zip)/GPX/DXF with georeferencing | Done |
| Privacy at ingest | `outFields` limited to id and acreage, plus `sanitizeAttributes` | Done. Owner and mailing fields are never requested |
| Units & projection | UTM (Krüger 6th order) with scale-factor correction; imperial/metric toggle | Done. Area matches exact ellipsoidal area within 0.02 % |
| Site Profile v1 | Elevation (EPQS), hardiness zone, elevation-adjusted frost probabilities (NCEI normals), SSURGO soils (SDA), FEMA flood, NHD water, imagery attribution | Done. Each layer has attribution and confidence, or an explicit "unavailable" state |
| Data Sources screen | `packages/data/src/sources.ts` → `app/data-sources.tsx` | Done |
| Billing entitlement plumbing | `packages/core/src/entitlements.ts`, `apps/mobile/src/billing` | Three tiers, rewarded unlocks and an open-source/ads mode are modeled. The store adapter is a dev stub (real StoreKit 2 / Play Billing in Phase 6) |

## Verification

- **Automated:** `pnpm check` runs the type-check, **79 tests** and the zero-cost gate, and all pass. The tests cover UTM and area against exact ellipsoidal formulas, the frost engine against recorded NOAA values, all six import formats, walk simplification, entitlements, multi-device sync (out-of-order batches, tombstones, edits during upload, clock restarts), and HTTP caching, backoff, rate limits and concurrency. Every provider is tested against fixtures, and the Site Profile is tested end to end, including outages and fully cached runs.
- **Recorded API responses:** EPQS, the Census geocoder (address and coordinates), and NCEI normals (Albany and Hudson NY) were captured live on 2026-09-28. The NCEI search, SDA, NFHL, NHD and ArcGIS parcel fixtures are **synthetic**, built from each service's documented format.
- **Independent review:** a separate reviewer audited the code and found 19 defects. All are fixed and covered by regression tests. They included a wrong MapLibre major version, ArcGIS error bodies being cached for up to 180 days, sync divergence and resurrection paths, an over-cautious "frost rare" result, "AREA NOT INCLUDED" being flagged as high flood risk, and a per-host concurrency race.

## Not verified (this build environment could not do it)

1. **The app has not been compiled or run.** The package registries were blocked, so nothing could be installed. Screens were type-checked against our own packages with the RN/Expo types stubbed out. The MapLibre usage was checked against the v11.4.0 source. **First step on your machine:** `pnpm install && pnpm --filter @homeground/mobile exec expo install --fix && pnpm --filter @homeground/mobile typecheck`, then `pnpm ios` / `pnpm android`.
2. **Swift (CloudKit) and Kotlin code have not been compiled.**
3. **Live calls to NCEI search, SDA, NFHL, NHD and the NY/WI parcel services** have only been tested against synthetic fixtures. Run `pnpm tsx scripts/record-fixtures.ts`: it builds a real profile for a test lot, prints each layer's status and the cold-start time against the 30 s target, and saves the raw responses. The riskiest assumption is **SDA's AOI macros** (`~GetClippedMapunits~`). If they're rejected, the code falls back to the list of map units without area percentages.
4. **Acceptance timing** (< 30 s cold, < 2 s cached) is measured by the recorder script, not yet on a phone.

## Known limitations and follow-ups

- **Android sync:** Drive appDataFolder needs a Google Cloud OAuth client (free) and possibly Google's scope verification. See the header of `modules/user-sync/android/.../UserSyncModule.kt`.
- **Old sync batches are never compacted.** Deleting one property leaves earlier copies in the user's iCloud until "Delete all my data" is used. The UI says so.
- **Hardiness zones:** the bundled ZIP table is empty until `pnpm build:zones` runs. Until then zones come from phzmapi.org, a volunteer static mirror. Confirm the PRISM redistribution terms before shipping the table.
- **Imagery date:** only the service refresh date is shown, not the per-area flight date. A NAIP date lookup is planned for Phase 2.
- **Parcel registry** covers only New York (38 counties) and Wisconsin so far. Everywhere else, users draw, walk, import, or add their county's link. Endpoints in the remote registry can point at hosts not listed in `sources.ts`. That's by design, because each registry entry carries its own licence and attribution, but keep it in mind when curating.
- **GitHub Pages** (the remote registry host) is free only for public repos. See `docs/STATIC_HOSTING.md`.
- **DXF/State Plane:** georeferencing supports the file's `.prj`, UTM, or a pasted proj4 string. There's no built-in State Plane picker yet.

## Zero-cost confirmation

No paid, metered or trial service was added. Every dependency is MIT or Apache-2.0 (`licenses.json`), and every network host is a keyless public service or the project's own static host (`packages/data/src/sources.ts`), all enforced in CI. Platform costs remain as documented: Apple and Google developer accounts, and store commission.

## Owner action items

1. ~~Set a contact email~~ Done: handlenterprises1988@gmail.com is sent in the User-Agent and to Nominatim.
2. Create the iCloud container `iCloud.app.homeground.planner` and change the bundle ID `app.homeground.planner` if you prefer another.
3. ~~Make the repo public~~ Done. Now set Settings → Pages → Source to "GitHub Actions" once.
4. Run the first-build steps above, plus `pnpm build:zones` and the fixture recorder, and share anything that fails.

## Next: Phase 2 (sun & design)

It starts with the Hermes performance spike for horizon and shade (the < 500 ms target). Then on-device NREL SPA, 3DEP DEM windowed reads, terrain horizon, canopy and building shading, the sun-hours heatmap, and design mode.
