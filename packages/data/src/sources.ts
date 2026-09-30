/**
 * Single source of truth for every external data service the app contacts (§0, §11).
 * - Rendered on the in-app Data Sources screen.
 * - Checked by `scripts/check-licenses.ts`: any https host that appears in app/provider source code
 *   must be listed here, so a new service can't be added without recording its terms.
 * Re-verify terms before each release; they were last reviewed on `reviewed`.
 */

export interface DataSource {
  id: string;
  name: string;
  provider: string;
  /** What the app uses it for. */
  use: string;
  hosts: string[];
  license: string;
  commercialUse: true;
  /** Text the app must display. */
  attribution: string;
  /** Usage-policy obligations the code enforces (rate limits, User-Agent…). */
  policy?: string;
  url: string;
  reviewed: string;
  /** Set when a user-supplied or third-party mirror is involved. */
  caveat?: string;
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'census-geocoder', name: 'Census Geocoder', provider: 'U.S. Census Bureau',
    use: 'US address search; county FIPS and ZIP (ZCTA) for a coordinate',
    hosts: ['geocoding.geo.census.gov'], license: 'Public domain (U.S. Government work)', commercialUse: true,
    attribution: 'U.S. Census Bureau', url: 'https://geocoding.geo.census.gov/geocoder/', reviewed: '2026-09-28',
  },
  {
    id: 'nominatim', name: 'Nominatim', provider: 'OpenStreetMap Foundation',
    use: 'Address search outside the US (explicit searches only)',
    hosts: ['nominatim.openstreetmap.org'], license: 'ODbL 1.0 (data); usage policy applies', commercialUse: true,
    attribution: '© OpenStreetMap contributors',
    policy: 'Max 1 request/second, identifying User-Agent, no autocomplete, results cached',
    url: 'https://operations.osmfoundation.org/policies/nominatim/', reviewed: '2026-09-28',
    caveat: 'Heavy use should move to a self-hosted or commercial geocoder; the app only calls it for non-US searches.',
  },
  {
    id: 'openfreemap', name: 'OpenFreeMap', provider: 'OpenFreeMap (OpenStreetMap data, OpenMapTiles schema)',
    use: 'Vector basemap', hosts: ['tiles.openfreemap.org'], license: 'Free, no key, commercial use allowed; ODbL data',
    commercialUse: true, attribution: 'OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors',
    url: 'https://openfreemap.org/', reviewed: '2026-09-28',
  },
  {
    id: 'usgs-basemap', name: 'The National Map basemaps (imagery, topo)', provider: 'USGS',
    use: 'Aerial imagery and topographic basemap', hosts: ['basemap.nationalmap.gov'],
    license: 'Public domain (U.S. Government work)', commercialUse: true,
    attribution: 'USDA, USGS The National Map: Orthoimagery', url: 'https://basemap.nationalmap.gov/', reviewed: '2026-09-28',
  },
  {
    id: 'epqs', name: '3DEP Elevation Point Query Service', provider: 'USGS',
    use: 'Point elevations on the parcel', hosts: ['epqs.nationalmap.gov'],
    license: 'Public domain (U.S. Government work)', commercialUse: true, attribution: 'USGS 3D Elevation Program',
    url: 'https://epqs.nationalmap.gov/v1/docs', reviewed: '2026-09-28',
  },
  {
    id: 'phzm', name: 'Plant Hardiness Zone Map 2023', provider: 'USDA ARS / PRISM Climate Group (Oregon State University)',
    use: 'Hardiness zone by ZIP (bundled table, phzmapi.org fallback)', hosts: ['phzmapi.org'],
    license: 'USDA/PRISM data; ZIP table from frostline (MIT)', commercialUse: true,
    attribution: 'USDA Plant Hardiness Zone Map, 2023. PRISM Climate Group, Oregon State University.',
    url: 'https://planthardiness.ars.usda.gov/', reviewed: '2026-09-28',
    caveat: 'phzmapi.org is a volunteer static mirror. Prefer the bundled table (pnpm build:zones), and confirm PRISM redistribution terms before release.',
  },
  {
    id: 'ncei-normals', name: 'U.S. Climate Normals 1991–2020', provider: 'NOAA NCEI',
    use: 'Freeze probabilities, seasonal temperatures, growing degree days',
    hosts: ['www.ncei.noaa.gov'], license: 'Public domain (U.S. Government work)', commercialUse: true,
    attribution: 'NOAA National Centers for Environmental Information', url: 'https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals', reviewed: '2026-09-28',
  },
  {
    id: 'sda', name: 'Soil Data Access (SSURGO)', provider: 'USDA-NRCS',
    use: 'Soil map units, drainage, texture, pH, organic matter, hydric rating, farmland class',
    hosts: ['sdmdataaccess.sc.egov.usda.gov'], license: 'Public domain (U.S. Government work)', commercialUse: true,
    attribution: 'Soil Survey Staff, USDA-NRCS. Soil Survey Geographic (SSURGO) Database.',
    policy: 'Single-threaded federal server: one request at a time, results cached for months',
    url: 'https://sdmdataaccess.sc.egov.usda.gov/', reviewed: '2026-09-28',
  },
  {
    id: 'nfhl', name: 'National Flood Hazard Layer', provider: 'FEMA',
    use: 'Flood zones intersecting the parcel', hosts: ['hazards.fema.gov'], license: 'Public domain (U.S. Government work)',
    commercialUse: true, attribution: 'FEMA National Flood Hazard Layer', url: 'https://www.fema.gov/flood-maps/national-flood-hazard-layer', reviewed: '2026-09-28',
  },
  {
    id: 'nhd', name: 'National Hydrography Dataset', provider: 'USGS',
    use: 'Streams, ponds and lakes near the parcel', hosts: ['hydro.nationalmap.gov'],
    license: 'Public domain (U.S. Government work)', commercialUse: true, attribution: 'USGS National Hydrography Dataset',
    url: 'https://www.usgs.gov/national-hydrography', reviewed: '2026-09-28',
  },
  {
    id: 'ny-parcels', name: 'NYS Tax Parcels (public)', provider: 'NYS ITS Geospatial Services / ORPTS / counties',
    use: 'Parcel boundary lookup in participating New York counties', hosts: ['gisservices.its.ny.gov'],
    license: 'Public web service; display only', commercialUse: true,
    attribution: 'Contributing counties, NYS ITS Geospatial Services and NYS ORPTS',
    url: 'https://gis.ny.gov/parcels', reviewed: '2026-09-28',
    caveat: 'Only parcel id and acreage are requested. Owner fields are never downloaded.',
  },
  {
    id: 'wi-parcels', name: 'Wisconsin Statewide Parcels V12', provider: 'Wisconsin State Cartographer’s Office',
    use: 'Parcel boundary lookup in Wisconsin', hosts: ['services3.arcgis.com'], license: 'Public web service; display only',
    commercialUse: true, attribution: "Wisconsin Statewide Parcel Map Database Project (V12), State Cartographer's Office",
    url: 'https://www.sco.wisc.edu/parcels/data/', reviewed: '2026-09-28',
    caveat: 'Only parcel id and acreage are requested. Owner fields are never downloaded.',
  },
  {
    id: '3dep-imageserver', name: '3DEP Elevation ImageServer', provider: 'USGS',
    use: 'Bare-earth elevation grids around the parcel (shade, slope, contours, frost pockets)',
    hosts: ['elevation.nationalmap.gov'], license: 'Public domain (U.S. Government work)', commercialUse: true,
    attribution: 'USGS 3D Elevation Program', url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer', reviewed: '2026-09-28',
  },
  {
    id: 'tnm-access', name: 'TNM Access API', provider: 'USGS',
    use: 'Checks whether 1 m lidar elevation exists at the parcel', hosts: ['tnmaccess.nationalmap.gov'],
    license: 'Public domain (U.S. Government work)', commercialUse: true, attribution: 'USGS The National Map',
    url: 'https://tnmaccess.nationalmap.gov/api/v1/docs', reviewed: '2026-09-28',
  },
  {
    id: 'meta-wri-chm', name: 'High Resolution Canopy Height Maps v2', provider: 'Meta & World Resources Institute (AWS Open Data)',
    use: 'Tree heights for shade modelling', hosts: ['dataforgood-fb-data.s3.amazonaws.com'],
    license: 'CC BY 4.0', commercialUse: true, attribution: 'Meta and World Resources Institute (WRI). High Resolution Canopy Height Maps v2.',
    policy: 'Byte-range reads of only the tiles over the parcel; cached 180 days',
    url: 'https://registry.opendata.aws/dataforgood-fb-forestsv2/', reviewed: '2026-09-28',
  },
  {
    id: 'nasa-power', name: 'NASA POWER', provider: 'NASA Langley Research Center',
    use: 'Monthly solar radiation (insolation, solar-array estimates), humidity (disease pressure), and daily all-sky vs clear-sky sunlight (which days were clear, for light-sensor calibration)', hosts: ['power.larc.nasa.gov'],
    license: 'NASA open data; acknowledgement requested', commercialUse: true,
    attribution: 'Data from the NASA Langley Research Center POWER Project, funded through the NASA Earth Science Directorate Applied Science Program.',
    policy: 'One request per 0.5° grid cell, cached 1 year; daily clearness cached 1 day', url: 'https://power.larc.nasa.gov/', reviewed: '2026-09-28',
  },
  {
    id: 'nws', name: 'NWS forecast API', provider: 'NOAA National Weather Service',
    use: '7-day forecast for frost, heat and wind alerts about what you have planted', hosts: ['api.weather.gov'],
    license: 'Public domain (U.S. Government work)', commercialUse: true, attribution: 'National Weather Service',
    policy: 'Identifying User-Agent with contact email; forecast cached 1 hour, grid lookup 30 days', url: 'https://www.weather.gov/documentation/services-web-api', reviewed: '2026-09-28',
  },
  {
    id: 'nrcs-scan', name: 'Soil Climate Analysis Network (AWDB REST API)', provider: 'USDA NRCS National Water and Climate Center',
    use: 'Regional soil temperature and moisture from the nearest SCAN station, for planting dates when you have no soil sensor',
    hosts: ['wcc.sc.egov.usda.gov'], license: 'Public domain (U.S. Government work)', commercialUse: true,
    attribution: 'USDA NRCS National Water and Climate Center', policy: 'Station list cached 30 days; hourly data cached 6 hours; one small request at a time',
    url: 'https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui/index.html', reviewed: '2026-09-29',
  },
  {
    id: 'ecowitt-cloud', name: 'Ecowitt Cloud API v3', provider: 'Ecowitt (Shenzhen Ecowitt Technology)',
    use: 'Your own Ecowitt station: current readings and history backfill, with the application key and API key you create in your Ecowitt account',
    hosts: ['api.ecowitt.net'], license: 'Your own data, accessed with your own free keys', commercialUse: true, attribution: 'Ecowitt',
    policy: 'Keys stored in the phone keychain; requests never cached; ≤ 1 request/second', url: 'https://api.ecowitt.net/', reviewed: '2026-09-29',
    caveat: 'Ecowitt\'s API terms could not be retrieved automatically (the doc site blocks crawlers); re-check them in a browser before release.',
  },
  {
    id: 'ambient', name: 'Ambient Weather Network REST API', provider: 'Ambient Weather',
    use: 'Your own Ambient station: current readings and up to a year of history, with an application key and API key you create in your AmbientWeather.net account',
    hosts: ['rt.ambientweather.net'], license: 'Your own data, accessed with your own free keys', commercialUse: true, attribution: 'Ambient Weather',
    policy: 'Both keys are the user\'s own (Ambient expects apps to share one application key; we don\'t). ≤ 1 request/second per key; never cached',
    url: 'https://ambientweather.docs.apiary.io/', reviewed: '2026-09-29',
    caveat: 'Ambient\'s terms page could not be retrieved automatically; re-check before release.',
  },
  {
    id: 'weatherlink', name: 'Davis WeatherLink v2 API', provider: 'Davis Instruments',
    use: 'Your own Davis station: current conditions (free WeatherLink plan) and history (needs your WeatherLink Pro/Pro+ plan)',
    hosts: ['api.weatherlink.com'], license: 'Your own data, accessed with your own free API key and secret', commercialUse: true, attribution: 'Davis Instruments WeatherLink',
    policy: 'Secret sent only in the X-Api-Secret header; 1,000 calls/hour limit respected; never cached', url: 'https://weatherlink.github.io/v2-api/', reviewed: '2026-09-29',
    caveat: 'History needs the user\'s paid WeatherLink Pro plan (the user\'s cost, never ours). WeatherLink.com API terms not found; re-check before release.',
  },
  {
    id: 'local-network', name: 'Stations on your home network', provider: 'Your own Ecowitt gateway, WeatherLink Live or Tempest hub',
    use: 'Advanced: read your station directly over Wi-Fi (Ecowitt gateway HTTP, WeatherLink Live HTTP, Tempest UDP broadcast). No internet service involved',
    hosts: [], license: 'Your own device', commercialUse: true, attribution: '',
    policy: 'Only private (LAN) addresses are accepted', url: 'https://weatherflow.github.io/Tempest/api/udp/v171/', reviewed: '2026-09-29',
  },
  {
    id: 'extension-guides', name: 'Cooperative Extension growing guides (links only)', provider: 'Land-grant universities (UMN, Illinois, Maryland, Utah State, Clemson, Cornell, UGA) and USDA SARE',
    use: '"How to grow" links for every plant, plus your state extension office. Opened in the browser; the app does not download them',
    hosts: [], license: 'Linked, not copied', commercialUse: true, attribution: '', url: 'https://www.nifa.usda.gov/about-nifa/how-we-work/extension/cooperative-extension-system', reviewed: '2026-09-28',
  },
  {
    id: 'usda-fdc-sr-legacy', name: 'USDA FoodData Central, SR Legacy (bundled)', provider: 'USDA Agricultural Research Service',
    use: 'Calories and key nutrients per 100 g and edible portions of each crop and animal product, for food self-sufficiency estimates. Bundled; not downloaded by the app',
    hosts: [], license: 'Public domain (CC0 1.0)', commercialUse: true, attribution: 'USDA FoodData Central', url: 'https://fdc.nal.usda.gov/', reviewed: '2026-09-29',
  },
  {
    id: 'dietary-reference', name: 'Dietary Guidelines 2020–2025 energy needs; DRI summary tables (bundled)', provider: 'USDA & HHS; National Academies (NCBI Bookshelf NBK545442)',
    use: 'Household calorie and nutrient needs by age, sex and activity. Values are facts, cited; bundled',
    hosts: [], license: 'Public domain (DGA); facts cited from the National Academies tables', commercialUse: true, attribution: '', url: 'https://www.dietaryguidelines.gov/', reviewed: '2026-09-29',
  },
  {
    id: 'homestead-kb', name: 'Livestock, enterprise, infrastructure and preservation profiles (bundled)', provider: 'Land-grant extension (Penn State, UMN, UMD, Missouri, Cornell, Virginia Tech, Oregon State, UW, UF…), USDA NASS/ERS/NRCS, SARE/PASA, NCHFP',
    use: 'Sourced ranges the AI planner quotes: space, feed, labour, startup and annual costs, revenue, regulations, shelf life. Each entry carries its source URL and year; old figures are flagged',
    hosts: [], license: 'Facts with citations; no text copied', commercialUse: true, attribution: '', url: 'https://www.nifa.usda.gov/about-nifa/how-we-work/extension/cooperative-extension-system', reviewed: '2026-09-29',
    caveat: 'A few costs come from commercial cost guides (HomeGuide, Angi) and are labelled as such',
  },
  {
    id: 'apple-foundation-models', name: 'Apple Foundation Models framework (on-device)', provider: 'Apple',
    use: 'AI planner conversation on Apple Intelligence devices (iOS 26+). Runs on the phone: no network, no key. Private Cloud Compute is deliberately not used (quotas, not zero-cost)',
    hosts: [], license: 'Free with the OS; Apple acceptable-use requirements apply', commercialUse: true, attribution: '', url: 'https://developer.apple.com/documentation/foundationmodels', reviewed: '2026-09-29',
  },
  {
    id: 'mlkit-genai-prompt', name: 'ML Kit GenAI Prompt API (Gemini Nano, on-device; beta)', provider: 'Google',
    use: 'AI planner conversation on supported Android phones. On-device, no key, no per-call cost',
    hosts: [], license: 'Free; ML Kit GenAI Additional Terms and the Generative AI Prohibited Use Policy apply', commercialUse: true, attribution: '', url: 'https://developers.google.com/ml-kit/genai/prompt/android', reviewed: '2026-09-29',
    caveat: 'Beta (no SLA). Terms require users to be 18+ and the app not to target minors; foreground use only',
  },
  {
    id: 'admob', name: 'Google AdMob and User Messaging Platform (ads SDK)', provider: 'Google',
    use: 'Ads on the free plan (browse screens only, one interstitial per session at most, opt-in rewarded ads) and the consent form (GDPR/TCF v2.3, US state privacy). Contacted by Google’s SDK, not by Plotwright code. Not loaded for paid plans',
    hosts: ['googleads.g.doubleclick.net', 'pagead2.googlesyndication.com', 'fundingchoicesmessages.google.com'],
    license: 'AdMob and Google Mobile Ads SDK terms; revenue share, no cost', commercialUse: true, attribution: '',
    policy: 'Non-personalised ads unless the user opts in (and, on iOS, grants tracking permission); UMP consent before any ad request; content rating capped at PG',
    url: 'https://support.google.com/admob/answer/6128543', reviewed: '2026-09-29',
    caveat: 'Needs the owner’s own AdMob account and app/unit ids (public identifiers, not keys). Proprietary SDK: not allowed in F-Droid builds',
  },
  {
    id: 'store-billing', name: 'App Store (StoreKit 2) and Google Play Billing', provider: 'Apple, Google',
    use: 'Subscriptions and one-time purchases, verified on the device. Contacted by the OS store frameworks; Plotwright has no receipt server',
    hosts: [], license: 'Apple Developer Program License Agreement; Google Play Developer Distribution Agreement', commercialUse: true, attribution: '',
    policy: 'Store commission on sales: Apple 15% (Small Business Program); Google Play 10% + 5% billing fee in the US, UK and EEA on the first $1M and on subscriptions (from 30 June 2026)',
    url: 'https://developer.apple.com/app-store/small-business-program/', reviewed: '2026-09-29',
  },
  {
    id: 'static-host', name: 'Plotwright registry (GitHub Pages)', provider: 'This project',
    use: 'Refreshable parcel-endpoint registry (static JSON)', hosts: ['lindquistgregory-wq.github.io'],
    license: 'Project-owned', commercialUse: true, attribution: '', url: 'https://pages.github.com/', reviewed: '2026-09-28',
  },
];

/** Hosts that appear in code but are not data services (documentation links, examples). */
export const NON_SERVICE_HOSTS = [
  'github.com', 'www.usgs.gov', 'websoilsurvey.nrcs.usda.gov', 'msc.fema.gov', 'planthardiness.ars.usda.gov',
  'operations.osmfoundation.org', 'openfreemap.org', 'pages.github.com', 'example.gov', 'example.invalid',
  'www.googleapis.com', 'www.fema.gov', 'www.sco.wisc.edu', 'gis.ny.gov', 'www.weather.gov', 'www.nifa.usda.gov',
  'www.opengis.net', 'www.w3.org', // XML namespaces in exports
  'registry.opendata.aws', 'power.larc.nasa.gov', 'www.usgs.gov', // documentation links
  // Sensor docs and vendor home pages shown as links (the app calls only the API hosts listed above)
  'ambientweather.docs.apiary.io', 'weatherlink.github.io', 'weatherflow.github.io', 'www.nrcs.usda.gov', 'www.ecowitt.net', 'ambientweather.net',
  'www.weatherlink.com', 'bthome.io', 'docs.ruuvi.com',
  // Knowledge-base citations and on-device AI documentation (links only; the data is bundled)
  'developer.apple.com', 'developers.google.com', 'fdc.nal.usda.gov', 'www.dietaryguidelines.gov',
  // Store pages the app links to (manage subscriptions, Apple's standard licence agreement)
  'apps.apple.com', 'play.google.com', 'www.apple.com', 'support.google.com',
  // CWOP instructions (link only; the app never relays station data)
  'madis.ncep.noaa.gov', 'www.wxqa.com',
];
