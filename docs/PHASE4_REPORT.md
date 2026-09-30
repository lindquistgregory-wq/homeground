# Phase 4 report: Sensors

**Date:** 2026-09-29 · **Branch:** `phase-4` (stacked on `phase-3`) · **Status:** code complete. As in earlier phases, the app hasn't been compiled on a device yet. Device and source details are in `docs/SENSORS.md`.

## What was built

| Plan item (§8) | Where | State |
|---|---|---|
| Bluetooth decoders | `packages/core/src/sensors/ble.ts`, `crypto.ts` (AES-128 and CCM, pure TypeScript) | Done. BTHome v1/v2, Govee (about 20 models, including probes and remotes), SwitchBot, Xiaomi MiBeacon v2–v5 including Flower Care, ATC/pvvx, Qingping, Inkbird and RuuviTag. Bindkey decryption works, and on iPhone uses the MAC you enter. Clean-room implementations, tested against the reference projects' real packets |
| Bluetooth collection | `apps/mobile/src/services/ble.ts`, `app/sensors/scan.tsx` | Done. Passive scanning, no pairing. About 12 s of collection each time the app opens, plus a live scan screen. One shared scan, so the two never cut each other off |
| Weather-station accounts (your own keys) | `packages/providers/src/stations.ts`, `app/sensors/station.tsx` | Done for Ecowitt, Ambient and Davis WeatherLink: current readings, history download on connect, and gap filling on each refresh. **Tempest's cloud isn't used**, because its terms need a commercial agreement; its hub is read over Wi-Fi instead |
| Local network (Homestead Pro) | same | Done. Ecowitt gateway and WeatherLink Live over HTTP, Tempest hub over UDP. Private addresses only |
| CSV import | `packages/core/src/sensors/csv.ts`, `app/sensors/import.tsx` | Done. Columns and units read from headers; daylight-saving-aware times; preview before saving |
| Normalization | `types.ts`, `series.ts` | Done. Canonical units, quality flags, daily summaries with hour coverage |
| Uses in the plan | `sensorInsights.ts`, calendar, alerts, bed planner | Done: |
| | | • soil sensor → regional NRCS SCAN station → model, for sowing dates |
| | | • measured heat units (Pro) |
| | | • FAO-56 watering suggestion |
| | | • frost offset at your low spot |
| | | • greenhouse threshold alerts (Pro) |
| | | • a light sensor calibrates modeled sun on clear days |
| Sync | migration 4, `db/sensors.ts`, `sync/userCloud.ts` | Done. Sensor definitions and per-phone daily summaries sync; raw readings stay on the phone; keys never sync |

## Verification

- `pnpm check` passes: type-check, **190 tests**, and the zero-cost gate. The Phase 4 tests cover:
  - Every decoder, using the reference projects' published packets.
  - AES and CCM against the FIPS-197 and RFC 3610 vectors.
  - Station parsers, using documented response samples. Each fixture is marked as documented, live or synthetic.
  - The rule that keys are never cached.
  - FAO-56 ET₀ against the worked examples.
  - The soil-curve blend, CSV edge cases and daylight saving.
- The sensor screens type-check against the shared packages, with React Native types stubbed.
- **Independent review: 19 defects, all fixed.** Four were serious:
  - A mistyped bindkey crashed the Bluetooth scan.
  - A soil sensor's autumn readings shifted *next* spring's sowing dates.
  - Stations only got history once, at setup.
  - A probe sensor could take its parent device's readings.
- **Second, verification review** of those fixes: 11 confirmed fixed, and 10 follow-ups found and fixed. The main ones:
  - Rain would have doubled once two phones read the same station.
  - An interrupted history download could leave a permanent gap.
  - A new station only got about a day of history.
  - Some WeatherLink models lost pressure and soil readings.

## Not verified (needs your machine)

1. **The native build.** New packages:
   - `react-native-ble-plx` (Apache-2.0)
   - `react-native-udp` (MIT; check New Architecture support on the first build)
   - `expo-secure-store` and `expo-build-properties` (MIT)

   Run `npx expo install --fix`, then build.
2. **Real sensors.** The decoders are checked against recorded packets, not live hardware. On Android, `ble-plx` keeps only the last manufacturer-data record in a packet. A Govee device that sends an iBeacon record after its data record would then decode as nothing. Worth checking on a real device.
3. **Live station accounts.** The parsers are tested with documented samples; live responses haven't been checked.
4. **Tempest on iPhone.** Receiving its Wi-Fi broadcasts needs Apple's free multicast entitlement, which you request from Apple. It isn't in `app.json` yet, because signing fails until Apple approves it.

## Known limitations

- **No background Bluetooth.** iOS doesn't allow ordinary apps to scan in the background, so Bluetooth sensors record only while the app is open. Station accounts refresh in the background as well.
- **One time zone.** Local days use the phone's time zone; parcels are assumed to be in it.
- **Linking on a second phone is manual.** Use "This is '…'" on the scan screen, then enter the keys on that phone. Keys never sync, by design.
- **WeatherLink history** needs your station's WeatherLink Pro plan. That's Davis's paid plan on your own account, and it's optional: without it, readings build up from the day you connect. If a history request is refused, the app waits a week before trying again.
- **Regional soil temperature.** It comes from NRCS SCAN stations within 100 km. In many areas there aren't any, and the app falls back to the model.
- **Light-sensor calibration** needs at least 3 clear days (NASA POWER clearness ≥ 0.8) with the sensor pinned on the map.
- **Migration 4 was changed in place** during review. That's safe only because the app has never been installed on a device. From the first device build on, schema changes go in new migrations.

## Zero-cost confirmation

- **New services:**
  - NRCS SCAN soil data (public domain, keyless).
  - Ecowitt, Ambient and WeatherLink APIs. These are called with **your own free keys**, stored in the phone's keychain, and never shared or synced. No app-wide key ships, and nothing is metered for us.
- **NASA POWER** was already allowed and now also provides daily clearness.
- **Local-network mode** talks only to your own devices.
- **New libraries:** `react-native-ble-plx` (Apache-2.0), `react-native-udp`, `expo-secure-store` and `expo-build-properties` (MIT).
- No server, nothing paid for us. `pnpm check:licenses` enforces all of this.

## Next: Phase 5 (AI Planner)

Local tool functions and knowledge base first, then the rules-based planner (it works on every device), then the on-device model bridges (Apple Foundation Models, Gemini Nano), then the income module.
