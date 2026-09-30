# Provider fixtures

| File | Origin |
|---|---|
| `epqs-catskill.json` | **Recorded** from `epqs.nationalmap.gov/v1/json`, 2026-09-28 |
| `census-address.json` | **Recorded** from the Census geocoder `onelineaddress` endpoint, 2026-09-28 |
| `census-coordinates-catskill.json` | **Recorded** ZCTA and county entries from `geographies/coordinates` (other layers trimmed), 2026-09-28 |
| `phzmapi-12413.json` | **Synthetic**, but in the shape of a real `phzmapi.org/12601.json` response recorded 2026-09-28 |
| NCEI normals rows (in `climate.test.ts` in core) | **Recorded** values for USW00014735 and USC00304025 |
| ArcGIS parcel, SDA, NFHL and NHD responses (inline in tests) | **Synthetic**, following each service's documented response format. **Re-record these against the live services before release.** The shell in the authoring environment could not reach them. |

| `chm_tile.tif` / `chm_tile.json` | **Synthetic.** A small uint8 GeoTIFF in EPSG:3857 with 76 m pixels, built to exercise Range reads and warping. It is not a real CHMv2 tile, and the real tiles' data type and compression are unverified |
| NASA POWER and TNM Access bodies (inline in `rasters.test.ts`) | **Synthetic**, following the documented response shapes |
| `packages/core/src/raster/__fixtures__/*.tif` | **Synthetic** DEM/CHM rasters written by libtiff/Pillow/GDAL encoders to cover strips, tiles, BigTIFF, both byte orders, LZW, Deflate and predictors 2/3. They are not real 3DEP data |

Re-record with `pnpm tsx scripts/record-fixtures.ts` on a machine with normal internet access.
