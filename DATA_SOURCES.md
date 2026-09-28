# Data sources, licenses and zero-cost status

The machine-readable version of this file, used by the app and by CI, is [`packages/data/src/sources.ts`](packages/data/src/sources.ts). Dependency licenses are recorded in [`licenses.json`](licenses.json). **Re-verify the terms before each release.** Last reviewed 2026-09-28.

## Services contacted by the app (Phase 1)

| Service | Used for | License / terms | Key? | Policy the code enforces |
|---|---|---|---|---|
| US Census Geocoder | US address search; county FIPS and ZCTA from coordinates | Public domain | No | Cached 90 days |
| OSM Nominatim | Non-US address search only | ODbL; OSMF usage policy | No | ≤1 request/s, identifying User-Agent, explicit searches only (no autocomplete), cached |
| OpenFreeMap | Vector basemap | Free, commercial use OK; OSM data under ODbL | No | Attribution via MapLibre |
| USGS The National Map basemaps | Aerial imagery, topo | Public domain | No | Attribution shown |
| USGS 3DEP EPQS | Parcel elevations | Public domain | No | 5 points per parcel, cached 180 days |
| NOAA NCEI Normals 1991–2020 (search + data services) | Freeze probabilities, temperatures, GDD | Public domain | No | Two calls per parcel, cached 1 year |
| USDA PHZM 2023 (bundled table; phzmapi.org fallback) | Hardiness zone | USDA/PRISM data; frostline table MIT | No | Bundled table preferred. **Confirm PRISM redistribution terms before release.** |
| USDA-NRCS Soil Data Access | SSURGO soils | Public domain | No | One request at a time (single-threaded server), cached 180 days |
| FEMA NFHL (MapServer layer 28) | Flood zones | Public domain | No | POST query, cached 30 days |
| USGS NHD (MapServer layers 6, 12) | Streams and waterbodies | Public domain | No | Cached 180 days |
| NYS Tax Parcels Public; Wisconsin V12 Statewide Parcels | Parcel boundary lookup | Public web services; display only | No | **Only id and acreage fields are requested.** Owner fields are never downloaded |
| User-added county ArcGIS layers | Parcel boundary lookup | User-supplied; terms not reviewed | No | Stored on that device only; same field allowlist |
| GitHub Pages (this repo) | Refreshable parcel registry | Project-owned | No | Free only for public repos (see `docs/STATIC_HOSTING.md`) |

## Platform services (no developer cost)

| Service | Cost | Note |
|---|---|---|
| iCloud CloudKit private database | Uses the user's iCloud quota | Needs the `iCloud.app.homeground.planner` container in the Apple Developer account |
| Google Drive appDataFolder | Uses the user's Drive quota | Not implemented yet. Needs a free OAuth client, and Google may require a verification review for the scope |
| Apple Developer Program / Google Play registration | Membership fees | Needed to publish. These are platform costs, not running costs |
| App-store commission | % of sales | Enroll in the Apple and Google small-business programs |

## Deliberately excluded (cost money or not free for commercial use)

Regrid and other commercial parcel APIs · Open-Meteo (free tier is non-commercial) · OpenTopography API (commercial use needs a paid key) · NREL API keys (replaced by on-device SPA in Phase 2) · paid satellite basemaps · cloud LLM APIs · RevenueCat and similar subscription SaaS.

## Coming in later phases (verify terms when they're added)

NWS api.weather.gov (forecasts and alerts) · NASA POWER (history and solar) · 3DEP COGs and Meta/WRI canopy heights on AWS Open Data · NRCS SCAN/SNOTEL · NOAA CPC outlooks · NLCD · USDA PLANTS · manufacturer weather APIs using the user's own keys · AdMob + UMP (Phase 6, consent-gated).
