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
| USGS 3DEP ImageServer (`exportImage`) | Elevation grids: 1 m where lidar exists, parcel + 120 m; 30 m out to 5 km for the far horizon | Public domain | No | Two requests per parcel, cached 180 days |
| USGS TNM Access API | Whether 1 m lidar exists here (for honest resolution labels) | Public domain | No | One request per parcel, cached |
| Meta & WRI Canopy Height Maps v2 (AWS Open Data) | Tree heights for shading | **CC BY 4.0**, credit shown in app | No | HTTP Range reads of only the needed part of one zoom-10 tile; cached 180 days |
| NASA POWER climatology | Monthly solar radiation (insolation, solar-array estimate) | NASA open data; acknowledgement shown | No | One request per 0.5° cell, cached 1 year |
| NWS api.weather.gov | 7-day forecast for frost/heat/wind alerts on what's planted | Public domain | No | Identifying User-Agent with contact email; forecast cached 1 h |
| NASA POWER RH2M climatology | Summer humidity for disease-pressure warnings | NASA open data; acknowledged | No | One request per 0.5° cell, cached 1 year |
| Cooperative Extension growing guides (links only) | "How to grow" link per plant + state extension hub | Linked, not copied | No | Opened in the browser; never downloaded by the app. URLs verified 2026-09-28 |
| USGS Shaded Relief basemap | Hillshade layer in design mode | Public domain | No | Standard tiles |
| NYS Tax Parcels Public; Wisconsin V12 Statewide Parcels | Parcel boundary lookup | Public web services; display only | No | **Only id and acreage fields are requested.** Owner fields are never downloaded |
| Parcel endpoints from the remote registry | Parcel boundary lookup | Recorded per entry in `packages/data/registry/parcel-endpoints.json` | No | Hosts vary by county; each entry must carry its licence and attribution before it is merged |
| User-added county ArcGIS layers | Parcel boundary lookup | User-supplied; terms not reviewed | No | Stored on that device only; same field allowlist |
| GitHub Pages (this repo) | Refreshable parcel registry | Project-owned | No | Free only for public repos (see `docs/STATIC_HOSTING.md`) |
| NRCS SCAN (AWDB REST API) | Regional soil temperature/moisture from the nearest SCAN station (≤ 100 km) | Public domain | No | Station list cached 30 days, hourly data 6 h; labelled "regional" |
| NASA POWER daily | Which recent days were clear (for light-sensor sun calibration) | NASA open data; acknowledged | No | One request per 0.5° cell, cached 1 day |

## Your own weather station (Phase 4, your keys, called from your phone)

| Service | Used for | Keys (created by you, free) | Cost to you | Policy the code enforces | Terms status |
|---|---|---|---|---|---|
| Ecowitt Cloud API v3 | Current readings + history backfill | Application key + API key, from your ecowitt.net account | Free | Keys in the phone keychain; requests never cached; ≤ 1 req/s | ⚠️ Terms not retrievable automatically (doc site blocks crawlers). Re-check before release |
| Ambient Weather Network | Current readings + up to 1 year of history | Application key **and** API key, both from your AmbientWeather.net account | Free | Never ship a shared application key; ≤ 1 req/s; never cached | ⚠️ Terms page not retrievable; no commercial clause found. Re-check before release |
| Davis WeatherLink v2 | Current conditions; history | API key + secret ("Generate v2 Key" on weatherlink.com) | Current: free. **History needs your WeatherLink Pro/Pro+ plan** | Secret only in the `X-Api-Secret` header; never cached | ⚠️ No API-specific terms found. Re-check before release |
| Tempest / WeatherFlow **cloud** | *Not used* | — | — | — | ❌ WeatherFlow's Remote Data Access Policy requires a WeatherFlowONE subscription or written agreement for commercial use, and forbids storing downloads in a database. **Awaiting the owner's decision** |
| Ecowitt gateway (local HTTP), WeatherLink Live (local HTTP), Tempest hub (local UDP 50222) | Live readings over your home Wi-Fi | None | Free | Only private LAN addresses accepted; iOS asks for Local Network permission; Tempest UDP on iOS needs Apple's free multicast entitlement | ✅ Local access; vendor remote-data terms don't apply |

Bluetooth sensors (Govee, SwitchBot, Xiaomi/Qingping, Inkbird, RuuviTag, BTHome) are read from their broadcasts on the phone. No service is involved.

## Platform services (no developer cost)

| Service | Cost | Note |
|---|---|---|
| iCloud CloudKit private database | Uses the user's iCloud quota | Needs the `iCloud.app.plotwright.planner` container in the Apple Developer account |
| Google Drive appDataFolder | Uses the user's Drive quota | Not implemented yet. Needs a free OAuth client, and Google may require a verification review for the scope |
| Apple Developer Program / Google Play registration | Membership fees | Needed to publish. These are platform costs, not running costs |
| App-store commission | % of sales | Enroll in the Apple and Google small-business programs |

## Deliberately excluded (cost money or not free for commercial use)

Regrid and other commercial parcel APIs · Open-Meteo (free tier is non-commercial) · OpenTopography API (commercial use needs a paid key) · NREL API keys (replaced by on-device SPA in Phase 2) · paid satellite basemaps · cloud LLM APIs · RevenueCat and similar subscription SaaS · Firebase Analytics/Crashlytics (free, but they need a project API key shipped inside the app, which the no-shared-keys rule forbids) · Sentry (metered).

## Coming in later phases (verify terms when they're added)

NOAA CPC outlooks · NLCD · USDA PLANTS.

## Bundled knowledge and on-device AI (Phase 5)

Nothing here is contacted over the network. The datasets ship inside the app, and the AI models are part of the phone's operating system.

| Item | Used for | License / terms | Notes |
|---|---|---|---|
| USDA FoodData Central, SR Legacy (`packages/data/knowledge/nutrition.json`) | Calories and nutrients per 100 g, edible portions (crops and animal products) | Public domain (CC0) | Values from the SR Legacy CSV release (2019-04-02) cross-checked against SR28; each food keeps its FDC id |
| Dietary Guidelines for Americans 2020–2025, Appendix 2 | Calorie needs by age, sex and activity | Public domain | |
| National Academies DRI summary tables (NCBI NBK545442) | Protein, vitamin A, vitamin C, calcium, iron, fibre targets | Facts, cited | |
| Homestead profiles (`packages/data/knowledge/homestead.json`) | Livestock, enterprises, infrastructure, food preservation | Facts with citations (extension, USDA, SARE/PASA, NCHFP); no text copied | Every entry has source URLs and years; pre-2016 figures flagged `oldData`, pre-2020 prices `oldPrice`; unknowns are `null`. A few costs are from commercial cost guides and say so |
| Apple Foundation Models (iOS 26+) | Planner conversation and tool calls | Free with the OS; Apple acceptable-use requirements | On-device only. **Private Cloud Compute is not used**: it has per-user quotas and an iCloud+ upsell |
| ML Kit GenAI Prompt API (Gemini Nano) | Planner conversation on supported Android phones | Free; ML Kit GenAI Additional Terms + Generative AI Prohibited Use Policy | **Beta**. Terms: users 18+, app must not target minors, foreground only. No key or Firebase project |

## Monetization (Phase 6)

| Item | Used for | Terms / cost | Notes |
|---|---|---|---|
| App Store (StoreKit 2) via `expo-iap` | Grower / Homestead Pro subscriptions, Pro lifetime, "remove ads" | Apple takes 15% in the Small Business Program (enrol), 30% otherwise (15% after a subscriber's first year) | Verified on the device (signed JWS). No receipt server, no subscription SaaS; expo-iap's hosted IAPKit option is not used |
| Google Play Billing Library 9 via `expo-iap` | Same | US/UK/EEA from 30 June 2026: 10% service fee + 5% billing fee on the first $1M a year and on auto-renewing subscriptions | Purchase state read on the device; purchases acknowledged within Play's 3-day window |
| Google AdMob + User Messaging Platform (`react-native-google-mobile-ads` 16.5.0) | Ads on the free plan; consent (GDPR/TCF v2.3, US states) | Free SDK; Google keeps an unpublished revenue share | The SDK contacts Google's ad and consent servers itself (googleads.g.doubleclick.net, pagead2.googlesyndication.com, fundingchoicesmessages.google.com and others). Non-personalised unless the user opts in; ATT is asked only then. Needs the owner's AdMob account; the app ids in `app.json` are Google's samples until replaced |
| Usage statistics and error log | Which screens and features are used; app errors | On the phone only | Off by default; the user can read, share or clear them. Crash reports otherwise come from the OS's own opt-in reports (App Store Connect / Xcode Organizer, Play Console Android vitals) |
| Offline parcel packs | USGS imagery tiles saved to the phone (Homestead Pro) | Public domain; the USGS services advertise tile export (`exportTilesAllowed`) | Parcel + 250 m, zoom 12–16, at most 3,000 tiles, two downloads at a time with the identifying User-Agent. OpenFreeMap vector tiles are not bulk-downloaded (its terms don't cover it); MapLibre's cache (raised to 150 MB) keeps what you've viewed |
