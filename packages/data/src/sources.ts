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
    use: 'Monthly solar radiation for insolation and solar-array estimates', hosts: ['power.larc.nasa.gov'],
    license: 'NASA open data; acknowledgement requested', commercialUse: true,
    attribution: 'Data from the NASA Langley Research Center POWER Project, funded through the NASA Earth Science Directorate Applied Science Program.',
    policy: 'One request per 0.5° grid cell, cached 1 year', url: 'https://power.larc.nasa.gov/', reviewed: '2026-09-28',
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
  'www.googleapis.com', 'www.fema.gov', 'www.sco.wisc.edu', 'gis.ny.gov',
  'www.opengis.net', 'www.w3.org', // XML namespaces in exports
  'registry.opendata.aws', 'power.larc.nasa.gov', 'www.usgs.gov', // documentation links
];
