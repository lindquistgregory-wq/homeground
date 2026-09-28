# Homeground

A parcel-aware homestead and garden planner for iOS and Android. It works from your actual land (boundary, elevation, soils, frost dates, flood zones, water) rather than just your ZIP code, and it has **zero running costs**: free public data, no developer server, and sync through the user's own iCloud or Google Drive.

The build plan is in [`docs/PLAN.md`](docs/PLAN.md). Phase 1 status and known limitations are in [`docs/PHASE1_REPORT.md`](docs/PHASE1_REPORT.md).

## Repository layout

```
apps/mobile/          Expo app (expo-router screens, SQLite, MapLibre)
packages/core/        Pure TypeScript domain logic: units, UTM projection, geometry, frost engine,
                      boundary import parsers, entitlements, sync engine. No dependencies.
packages/providers/   One module per free public data service, plus the SiteProfileService.
                      Uses an injected fetch, so every service is tested against fixtures.
packages/data/        Bundled data: parcel-endpoint registry, data-source registry, zone table
modules/user-sync/    Expo native module: CloudKit private DB (iOS); Google Drive appDataFolder (Android, stub)
scripts/              Zero-cost license/host gate, zone-table builder, live fixture recorder
```

## Getting started

Requirements: Node 22, pnpm 10, and Xcode 16+ (iOS) or Android Studio (Android).

```bash
pnpm install
pnpm --filter @homeground/mobile exec expo install --fix   # pin Expo-compatible versions of the expo-* packages
pnpm check                                                 # type-check + tests + zero-cost gate
pnpm build:zones                                           # generate the offline hardiness-zone table (commit the result)
pnpm tsx scripts/record-fixtures.ts                        # hit the live public APIs once and report each layer

cd apps/mobile
pnpm ios        # or: pnpm android   (a dev build is required; Expo Go can't load the native modules)
```

## Zero-cost rules (enforced)

- Every npm dependency must be listed in `licenses.json` as free for commercial use.
- Every network host in the source must be listed in `packages/data/src/sources.ts`, which also drives the in-app Data Sources screen.
- `pnpm check:licenses` runs in CI and fails otherwise.
- No shared API keys. User-owned keys (weather stations, from Phase 4) go in the device keychain.

## Privacy

Location, boundaries, profiles and (later) sensor data stay on the device and in the user's own cloud storage. County parcel services are asked only for the parcel outline, id and acreage. Owner and mailing fields are never requested.

## License

Not yet decided. The business-model decision (subscription tiers vs. open source with ads, plan §12) determines the license. Until then, all rights are reserved.
