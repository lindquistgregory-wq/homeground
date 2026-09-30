# Plant data: where it comes from and how far to trust it

## The bundled database

`packages/core/src/plants/` holds 76 plants: 44 vegetables, 10 herbs, 18 fruits, berries, vines and nuts, 3 cover crops, and sunflower (counts from `PLANTS`). Each entry records sun, frost tolerance, heat tolerance, maturity, germination soil temperature, sowing and transplant offsets from the last frost, spacing, soil pH and drainage, hardiness zones and chill hours (perennials), pollination, disease and pest exposure, companions, and typical home-garden yield.

**Licence position.** The values are horticultural facts (ranges such as "pH 6.0–6.8" or "transplant 1–3 weeks after the last frost"), written for this project from general knowledge and cross-checked against land-grant extension guidance. Facts aren't copyrightable, and no text, tables or images were copied from any source. How-to content stays with its authors: the app links out to it (below) instead of reproducing it. No third-party plant database or API is used, so there is no licence to track and nothing to pay for.

**Review.** An independent audit in Phase 3 corrected about 20 values, including chill hours for apple, peach and pear, zones for grape and strawberry, the sun minimum for corn and melons, the frost class of beet, carrot and chard, and yields for tomato and corn. It also added rabbiteye blueberry for the South. `plants.test.ts` enforces internal consistency: ranges in order, companions that exist, perennials with zones, fruit trees with chill hours, every plant with at least one planting window, and no window that runs backwards.

**How far to trust it.** These are typical ranges for US home gardens. Variety differences can be larger than the ranges: a 55-day tomato against a 90-day one, or a 300-hour peach against a 1,000-hour one. The app says so wherever it shows a number, and it tells people to prefer their seed packet and their state extension service.

## Extension links

| File | Contents | Verified |
|---|---|---|
| `packages/data/extension/crop-guides.json` | One growing guide per plant (76). University of Minnesota 49, Illinois 11, Maryland 4, Utah State 4, Clemson 3, SARE 3 (cover crops), Cornell 1, Georgia 1 | 2026-09-28: 75 loaded and their heading checked, 1 confirmed by search |
| `packages/data/extension/state-hubs.json` | Each state's home-garden extension page, keyed by state FIPS (50 states, DC, Puerto Rico) | 2026-09-28: 50 loaded, 2 confirmed by search |

The links are opened in the phone's browser. The app makes no request to these sites itself, so they aren't network hosts in `sources.ts`. Links rot, so re-run the check (the `checked` field records when) before each release. `scripts/plant-links.test.ts` fails if any plant or state is missing a link.

## Models built on the data

- **Climate curves** (`seasonModel.ts`). Each curve is a one-harmonic fit to the nearest NOAA 1991–2020 station's seasonal minimum and maximum normals, adjusted to the parcel's elevation with the lapse rate.
  - The fit undoes the ~10% flattening that comes from fitting 3-month averages. Albany reaches its July high and January low within about 2 °F.
  - Heat units are calibrated to the station's published annual GDD.
  - Accuracy: about ±5 days on seasonal thresholds.
- **Soil temperature** is modeled, not measured. It is mean air temperature lagged 5 days, plus up to +4 °F of solar gain near midsummer, for bare, sunny soil. For Albany it gives 60 °F on May 13 and 65 °F on May 25, in line with regional extension timing for peppers and melons. Mulched or shaded beds run cooler. A sensor or regional soil station, where one is added, overrides the model (`CalendarContext.soilF`).
- **Chill hours** use the simple 32–45 °F model on a sinusoidal day, 1 Oct – 28 Feb. Expect about ±25%. Orchardists in marginal areas should check a local chill-portion model.
