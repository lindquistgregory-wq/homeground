# Phase 3 report: Planting guide

**Date:** 2026-09-29 · **Branch:** `phase-3` (stacked on `phase-2`) · **Status:** code complete. Like Phases 1–2, the app hasn't been compiled on a device yet.

## What was built

| Plan item (§7) | Where | State |
|---|---|---|
| Plant database | `packages/core/src/plants/` (76 plants), see `docs/PLANT_DATA.md` | Done. Facts written for the project, independently audited; no third-party plant data or API |
| Parcel climate for planting | `seasonModel.ts`: daily min/max curves from the nearest NOAA normals, elevation-adjusted; heat units calibrated to the station; modeled soil temperature; chill hours; peak summer heat | Done |
| Planting calendar | `calendar.ts`, `app/calendar/[id].tsx`, calendar card on each plant | Done. Start indoors, harden off, transplant, sow, successions, fall crops and harvest windows, each with the reason for its dates. A Cautious/Typical toggle; heat-unit harvest dates for Pro |
| Explainable suitability | `suitability.ts` | Done. 12 weighted factors (sun, hardiness, season length, heat units, chill, heat stress, humidity disease, pH, drainage, texture, frost pocket, water). Hard fails cap the score, and every factor explains itself ("5.2 sun-hours in Bed 3 vs 6–8 ideal") |
| Bed planner | `app/garden/[id].tsx`, opened from any bed in Design | Done. Growing-season sun for that exact bed from the Phase 2 shade engine, plus dominant soil, slope, aspect and frost pocket. Ranked plants, to-scale layout, rotation check, yield estimate, plantings tracked planned → planted → harvested |
| Tall crops cast shade | `cropShadeObjects` → shade engine | Done. Corn, pole beans and sunflowers shade their neighbours from midsummer to frost, on the design heatmap and in other beds' scores |
| Plant library & details | `app/plants/` | Done. Search and filter; sorted by fit to your climate when opened from a property |
| Extension links | `packages/data/extension/` | Done. A verified guide for every plant, plus your state's home-garden page |
| Frost / heat / wind alerts | `packages/providers/src/weather.ts` (NWS), `apps/mobile/src/services/alerts.ts` | Done. Uses only what you've marked as planted. On-device notifications; background checks about twice a day where the OS allows; toggle in Settings |
| Sync | Migration 3 `plantings`, in iCloud sync with tombstones | Done |

Feature gates follow the tier table:
- **Free:** library, calendar, verdicts, alerts.
- **Grower:** the full factor breakdown, rotation and succession.
- **Pro:** heat-unit scheduling and yield estimates.

## Verification

- `pnpm check` passes: type-check, **146 tests**, and the zero-cost gate. The Phase 3 tests cover:
  - Albany's real normals: the curve reaches July highs and January lows, and GDD calibrates to the station's 2,886.
  - Soil warming: 60 °F on May 13 and 65 °F on May 25 in Albany, in line with regional extension timing.
  - §14 acceptance: a shed south of a bed lowers the bed's score for sun-loving crops.
  - Calendar invariants for all 76 plants in both risk modes:
    - every plant has a planting window
    - no window runs backwards
    - no tender-crop harvest runs past frost
  - Cool-climate and frost-free edge cases, rotation (including garlic after onions), layout, yield, and alert thresholds.
- The mobile screens type-check against the shared packages, with React Native and Expo module types stubbed.
- **Independent review** found 16 defects. All are fixed; the ones testable in core have regression tests. The three serious ones:
  - Crops needing the warmest soil (melons) got the *earliest* dates, because the soil check silently switched off when the soil never reached the crop's minimum.
  - The fitted climate curves were too flat, which made spring soil about three weeks late.
  - Rosemary, mint and fig got no planting dates at all.

  Also fixed:
  - Perennials and fall garlic no longer drop out on 1 January.
  - Crop shade no longer appears in winter.
  - Deleting a bed removes its plantings.
  - Android 13's notification prompt now appears.
  - Stale forecasts can't raise alerts for nights that have passed.
  - Duplicate notifications are prevented.
  - Site profiles from older versions now rebuild themselves when opened.

## Not verified (needs your machine)

1. **The native build.** New packages: `expo-notifications`, `expo-background-task` and `expo-task-manager` (all MIT), with their config plugins in `app.json`. Run `npx expo install --fix`, then build.
2. **Notifications on real phones.**
   - The Android 13+ permission prompt.
   - iOS background runs. iOS decides when these happen, and Low Power Mode or turning off Background App Refresh stops them; the app then checks each time it opens and says so in Settings.
3. **NWS live responses.** The provider is tested with synthetic fixtures shaped like the documented API.

## Known limitations

- **Soil under a bed is the parcel's dominant soil map unit.** SSURGO maps at field scale, so it can't place a 4 × 8 ft bed within a unit. The app says a soil test is better.
- **Soil temperature is modeled** from air normals for bare, sunny soil. A sensor or regional soil-station feed would override it; that's Phase 4 (sensors).
- **Covered beds** (greenhouse, low tunnel, cold frame) use outdoor frost dates, with a note. Season extension isn't modeled.
- **Frost-free climates** get a general message and a link to the state calendar, not dates.
- **Circular and L-shaped beds** are laid out as their bounding rectangle.
- **Alerts come from the NWS forecast for the parcel centroid** (US only). Frost pockets can run colder than the forecast; the alert text says so.
- **Plant data** is typical ranges. Varieties differ; seed packets and state extension advice win.

## Zero-cost confirmation

New services:
- NWS `api.weather.gov` (public domain, keyless; an identifying User-Agent is sent, as required).
- NASA POWER relative humidity (NASA open data, acknowledged).

Extension sites are link-outs only; the app makes no requests to them. New libraries are `expo-notifications`, `expo-background-task` and `expo-task-manager` (MIT). Notifications are local: no push server, Firebase or APNs sender. No keys, nothing metered, no server. `pnpm check:licenses` enforces all of this.

## Next: Phase 4 (sensors)

BLE decoders (BTHome, Govee, SwitchBot, Inkbird, RuuviTag, Xiaomi/MiFlora, with bindkey support), cloud connectors for Ecowitt, Ambient, Davis and Tempest using your own keys, local-network mode, and CSV import. Soil-temperature readings will replace the modeled soil curve in the calendar (the hook, `CalendarContext.soilF`, is already there), and light readings will calibrate the shade model.
