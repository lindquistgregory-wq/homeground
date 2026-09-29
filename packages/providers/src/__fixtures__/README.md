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

## Phase 4: weather stations and SCAN (captured 2026-09-29)

| File | Kind | Notes |
|---|---|---|
| `ecowitt-realtime.synthetic.json` | **Synthetic** | Built from the documented/observed Ecowitt v3 shape (the doc site blocks automated access). Values are strings with a unit string. |
| `ecowitt-history.synthetic.json` | **Synthetic** | History `list` keyed by epoch seconds, as parsed by open-source clients. Includes a `"-"` missing value. |
| `ambient-devices.doc.json` | Doc | Verbatim from Ambient's official API blueprint (`ambient-weather/api-docs` apiary.apib). |
| `weatherlink-current.doc.json` | Doc | Verbatim from weatherlink.github.io/v2-api/api-response (WLL station, health + ISS records). |
| `wll-current-conditions.doc.json` | Doc | Verbatim from the WeatherLink Live local API docs. **The doc's example values are placeholders** (e.g. humidity 1.1 %); tests check field mapping and unit conversion, not plausibility. |
| `ecowitt-local-livedata.doc.json` | Doc | Ecowitt "HTTP API interface Protocol (Generic) V1.0.5" PDF sample (imperial), with the PDF's separate `piezoRain`/`lightning`/`co2` snippets merged. |
| `scan-station.live.json` | Live | Real AWDB `/stations` response (AAMU-JTG, AL), station elements trimmed. |
| `scan-hourly.live.json` | Live | Real AWDB `/data` hourly response, 4 hours (too few for a daily mean on purpose; tests add a synthetic full day). |

Tempest UDP samples are inline in `stations.test.ts`, verbatim from the WeatherFlow UDP v171 docs.
