# Sensors: supported devices, sources and how readings are used

Plotwright reads sensors three ways, all on the phone (§8). Every reading is stored with its UTC timestamp and a quality flag, in canonical units: °C, %, hPa, lx, W/m², m/s, mm, kPa and µS/cm.

## 1. Bluetooth sensors (passive broadcast, no pairing)

| Family | Recognised by | Readings | Notes |
|---|---|---|---|
| **BTHome v2** (and v1) | Service data 0xFCD2 (v1: 0x181C/0x181E) | Temperature, humidity, pressure, light, soil moisture, conductivity, dew point, CO₂, UV, wind, rain, battery | The open standard. Recommended for DIY/ESP32 sensors (e.g. b-parasite). AES-CCM encryption with the bindkey. |
| **Govee** thermo-hygrometers | Manufacturer data 0xEC88, 0x8801, 0x0001 plus the model name | Temperature, humidity, battery (H5140: CO₂) | H5072/5075/5129, H5074, H5051/52/71, H5179, H5100–H5110, H5174/77, H5108, H5178 (plus remote), H5112 (two probes), H5140 |
| **SwitchBot** meters | Service data 0xFD3D/0x0D00 plus manufacturer data 0x0969 | Temperature, humidity, battery (Meter Pro CO₂: CO₂; Hub 2: light level) | Meter, Meter Plus, Indoor/Outdoor, Meter Pro, Meter Pro CO₂, Hub 2 |
| **Xiaomi MiBeacon** | Service data 0xFE95 | Temperature, humidity, battery, and on Flower Care / Flower Pot / Grow Care: soil moisture, conductivity, light | Encrypted v4/v5 need the bindkey (and on iPhone the MAC). Legacy v2/v3 need the 12-byte key. Flower Care sends one reading per packet, which the scanner merges. |
| **ATC1441 / pvvx custom firmware** | Service data 0x181A | Temperature, humidity, battery | Plain and encrypted formats. pvvx can also send BTHome or MiBeacon. |
| **Qingping** | Service data 0xFDCD | Temperature, humidity, battery, pressure, CO₂, PM2.5, light | CGG1, CGG3, CGD1, CGM1, CGP23W, CGP22C, CGDN1, … |
| **Inkbird** | Name `sps`/`tps` (9-byte payload), `ITH-11-B` etc. (company 0x2449) | Temperature, humidity, battery | The 9-byte models put the temperature where a company ID would be. |
| **RuuviTag** | Manufacturer data 0x0499, format 5 | Temperature, humidity, pressure, battery voltage | |

**Collection.** iOS doesn't let ordinary apps scan in the background, so readings are collected while the app is open:
- about 12 seconds of scanning each time it opens
- continuously on the "Find Bluetooth sensors" screen

At most one reading per sensor per minute is stored.

**Keys.** Bindkeys are kept in the phone's keychain (`expo-secure-store`), never in the database, and never synced.

**References.** The decoders are clean-room implementations of the published formats. They are tested against the reference projects' real advertisement vectors (`packages/core/src/sensors/ble.test.ts`).

| Source | Licence | Used for |
|---|---|---|
| bthome.io spec, bthome-ble | MIT (library); the BTHome UUID is free to use | BTHome layouts, encryption, vectors |
| govee-ble | Apache-2.0 | Govee layouts, vectors |
| pySwitchbot | MIT | SwitchBot layouts, vectors |
| xiaomi-ble | Apache-2.0 | MiBeacon layout, encryption, vectors |
| pvvx ATC_MiThermometer | MIT-style grant | 0x181A formats (vectors marked *derived*) |
| qingping-ble, inkbird-ble, ruuvitag-ble | MIT | Layouts, vectors |
| Ruuvi data format 5 (docs.ruuvi.com; ruuvi.endpoints.c) | BSD-3 (vectors) | RuuviTag layout, official vectors |

No code was copied, and no GPL source (e.g. Theengs) was used.

## 2. Weather stations with your own keys

| Service | Keys | Current | History |
|---|---|---|---|
| Ecowitt Cloud API v3 | Application key + API key + gateway MAC | Yes | 5-minute data for the last week, then 30-minute data back to ~1 year |
| Ambient Weather | Application key + API key (you create both; no app-wide key is shipped) | Yes | Pages of 288 records, up to 1 year |
| Davis WeatherLink v2 | API key + secret (secret sent only in a header) | Yes (free plan: latest 15-minute record) | Needs your WeatherLink Pro plan |
| Tempest / WeatherFlow cloud | — | **Not used** | WeatherFlow's terms require a commercial agreement for commercial apps |

**Handling of keys and requests:**
- Requests carrying keys are never written to the on-device HTTP cache.
- Error messages name the host, never the key.
- Keys stay in the keychain and don't sync. Enter them again on another phone.

## 3. Local network (Homestead Pro)

| Device | How |
|---|---|
| Ecowitt gateway (GW1100/2000/3000, consoles) | `GET http://<ip>/get_livedata_info` |
| Davis WeatherLink Live | `GET http://<ip>/v1/current_conditions` |
| Tempest hub | UDP broadcast on port 50222 (`react-native-udp`) |

**Guard.** Only private LAN addresses (RFC 1918, link-local, `.local`) are accepted, so local mode can't reach the internet.

**Platform setup:**
- **iOS:** asks for Local Network permission and allows local HTTP (`NSAllowsLocalNetworking`). Receiving Tempest's UDP broadcast needs Apple's free **multicast networking entitlement**. Request it from Apple, then add `com.apple.developer.networking.multicast` to the entitlements. It isn't added by default, because signing fails without Apple's approval.
- **Android:** cleartext HTTP is enabled (`expo-build-properties`) for LAN stations. Every internet service the app calls is HTTPS.

## 4. CSV import

Any station software's CSV export can be imported.
- **Columns:** matched by header, e.g. "Outdoor Temperature (°F)", "Rain Rate (in/hr)", "Soil Moisture CH1 (%)". Indoor and derived columns such as heat index are skipped.
- **Units:** read from the header, or from a units row under it. When neither gives a unit, the unit system you choose is used.
- **Timestamps:** Unix, ISO with or without a zone, `YYYY-MM-DD HH:mm`, and `MM/DD/YYYY h:mm AM`. Day-first dates can be selected. A time without a zone is read as the phone's local time.

## What the readings are used for

| Use | Source (best first) |
|---|---|
| Sowing dates (soil-temperature gate) | Your sensor with exposure "in the soil" (last 60 days, bias carried forward and faded) → nearest NRCS SCAN station ≤ 100 km (regional) → modeled from air normals |
| Watering suggestion | FAO-56 Penman–Monteith ET₀ from your outdoor station or thermometer (missing inputs estimated the FAO-56 way, and listed), minus effective rain; a recent soil-moisture reading overrides it (refill point by soil texture) |
| Heat units (Pro) | Degree days from your own daily min/max since 1 January |
| Frost alerts at your low spot | Median of (sensor overnight low − NWS forecast low) over ≥ 5 nights. Applied only when the spot runs colder, never to cancel an alert |
| Greenhouse / threshold alerts (Pro) | Per-sensor limits, checked when the app opens and in the background task for stations |
| Measured vs modeled sun | A light sensor pinned on the map, on clear days (NASA POWER all-sky/clear-sky ≥ 0.8). With ≥ 3 clear days, the bed it's in has its modeled sun-hours scaled (×0.3–1.5) |
| Dew point, VPD, leaf-wet hours | From temperature and humidity (Magnus; FAO-56 vapour pressure; RH ≥ 90 %) |

## Sync and storage

Raw readings stay on the phone that collected them. Sensor definitions and **daily summaries** sync through your own iCloud: min, max and mean per metric per local day, plus which hours of the day had readings. Every device then has the history the calendar needs, without uploading every 5-minute reading.

- **One summary per phone.** Each phone syncs its own part of each day. Parts are combined when read:
  - **Bluetooth sensors:** parts are merged. Each phone heard the sensor at different times.
  - **Stations and imports:** the most complete part wins. Two phones downloading the same station get the same readings, and merging would count rain twice.
- **Whole days only.** Degree days, water use and frost offsets only use days with readings in at least 18 hours, including the small hours when the low happens. A few snapshots taken when the app opened don't count as a day.
- **Station history catch-up.** A station's history is downloaded when you connect it (up to a year). After that, each refresh fills the gap since the last complete download, up to two weeks in the foreground or one day in the ~30-second background window. The "complete through" point only moves when a download finishes, so an interrupted one leaves no hole.
- **Local days.** Local days follow the phone's time zone, including daylight-saving changes.
- **Another phone.**
  - iOS gives each phone its own Bluetooth id for a sensor. On the second phone, "Find Bluetooth sensors" offers **This is "…"** to link a sensor to the synced one, keeping a single history. That phone's id is stored locally only.
  - Station keys and bindkeys never sync. A synced station shows **Keys on this phone** so its keys can be entered once.
- **Deleting a sensor** removes its readings, its pending summaries and its keychain entry.
