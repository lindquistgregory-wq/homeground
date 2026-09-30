# Provider fixtures

| File | Origin |
|---|---|
| `epqs-catskill.json` | **Recorded** from `epqs.nationalmap.gov/v1/json`, 2026-09-28 |
| `census-address.json` | **Recorded** from the Census geocoder `onelineaddress` endpoint, 2026-09-28 |
| `census-coordinates-catskill.json` | **Recorded** ZCTA and county entries from `geographies/coordinates` (other layers trimmed), 2026-09-28 |
| `phzmapi-12413.json` | **Synthetic**, but in the shape of a real `phzmapi.org/12601.json` response recorded 2026-09-28 |
| NCEI normals rows (in `climate.test.ts` in core) | **Recorded** values for USW00014735 and USC00304025 |
| ArcGIS parcel, SDA, NFHL and NHD responses (inline in tests) | **Synthetic**, following each service's documented response format. **Re-record these against the live services before release.** The shell in the authoring environment could not reach them. |

Re-record with `pnpm tsx scripts/record-fixtures.ts` on a machine with normal internet access.
