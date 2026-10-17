# Plant data: where it comes from and how far to trust it

## The bundled database

`packages/core/src/plants/` holds 137 plants: 62 vegetables, 14 herbs, 43 fruits, berries, vines and nuts, 10 grain and forage crops, 5 cover crops, and 3 flowers (sunflower, zinnia, marigold). Counts are from `PLANTS`. Each entry records other common names people search by (zucchini, filbert, garbanzo), sun, frost tolerance, heat tolerance, maturity, germination soil temperature, sowing and transplant offsets from the last frost, spacing, soil pH and drainage, hardiness zones and chill hours (perennials), pollination, disease and pest exposure, companions, and typical home-garden yield.

**Licence position.** The values are horticultural facts (ranges such as "pH 6.0–6.8" or "transplant 1–3 weeks after the last frost"), written for this project from general knowledge and cross-checked against land-grant extension guidance. Facts aren't copyrightable, and no text, tables or images were copied from any source. How-to content stays with its authors: the app links out to it (below) instead of reproducing it. No third-party plant database or API is used, so there is no licence to track and nothing to pay for.

**Review.** An independent audit in Phase 3 corrected about 20 values, including chill hours for apple, peach and pear, zones for grape and strawberry, the sun minimum for corn and melons, the frost class of beet, carrot and chard, and yields for tomato and corn. It also added rabbiteye blueberry for the South.

**Additions (2026-10-14).** 26 plants were added the same way: shallot, fava bean, edamame, southern pea, peanut, tomatillo, rutabaga, Chinese cabbage, endive/escarole, horseradish, Jerusalem artichoke; lavender, French tarragon, fennel, lemon balm; apricot, gooseberry, hardy kiwi, muscadine, aronia, serviceberry, pecan; hairy vetch and oats (cover crops); zinnia and marigold. Key figures (planting timing, spacing, zones, chill hours, pollination) were cross-checked against each plant's extension guide below. Each also has a `nutrition.json` entry built from the USDA SR28 and FoodData Central SR Legacy downloads, the same sources as the original entries; plants without a fresh SR Legacy form (horseradish, tarragon) or not in it at all (lavender, lemon balm, aronia, serviceberry) have null values with a note. `plants.test.ts` enforces internal consistency: ranges in order, companions that exist, perennials with zones, fruit trees with chill hours, every plant with at least one planting window, and no window that runs backwards.

**US crop review (2026-10-14).** The list was checked against the main crops in USDA NASS reports (2022 Census of Agriculture fruit, tree nut and berry highlights; the 2026 Acreage report and the principal-crops list; the Vegetables Annual Summary) and 35 plants were added that can be grown at home or on a small farm: quince, Asian pear, mulberry, pomegranate, jujube, satsuma, Meyer lemon, sweet orange, avocado, olive; English walnut, black walnut, Chinese chestnut, almond; cranberry, honeyberry, fuzzy kiwi, maypop; globe artichoke, celeriac, radicchio, Malabar spinach, ground cherry, yardlong bean, sorrel. A new `field-crop` kind ("Grains & forage") covers wheat, barley, grain sorghum, field corn, soybean and chickpea for the household, and alfalfa, red clover, timothy and sorghum-sudangrass for livestock (forage has no yield and `food: false` in `nutrition.json`; its notes carry livestock-safety warnings such as prussic acid and bloat). Citrus, avocado and pomegranate have no chill-hour value because they need none; the test exempts fruit trees hardy only from zone 8 up. Nutrition uses the same USDA SR28 + FoodData Central SR Legacy downloads: olive (no fresh form) and honeyberry (not in SR Legacy) are null; sorrel uses dock, maypop uses purple passion fruit, and satsuma uses tangerine as the nearest entries, each with a note. Not added, because they are mainly large-scale or need special conditions: rice, cotton, sugarcane, tobacco, mango, banana, pistachio.

**Your own plants.** People can add plants to their library (Plants → Add your own plant), starting blank or from a copy of a library plant. A custom plant is a full `PlantSpec` with an id starting `custom-`, so fit scores, calendars, bed layouts and yields treat it like a bundled one. Before saving, the form checks it with `validatePlantSpec` (`custom.ts`). These are the same rules `plants.test.ts` applies to the bundled plants, and `custom.test.ts` makes sure every bundled plant passes them. The icon is one of the app's existing plant drawings (`ART_SHAPES`) in a colour from the bundled palette. Custom plants are stored on the phone (`custom_plants` table) and sync to the user's own cloud like the rest of their data. They have no extension guide or nutrition entry; those stay limited to the bundled plants.

**How far to trust it.** These are typical ranges for US home gardens. Variety differences can be larger than the ranges: a 55-day tomato against a 90-day one, or a 300-hour peach against a 1,000-hour one. The app says so wherever it shows a number, and it tells people to prefer their seed packet and their state extension service.

## Extension links

| File | Contents | Verified |
|---|---|---|
| `packages/data/extension/crop-guides.json` | One growing guide per plant (137). University of Minnesota 61, Illinois 14, Utah State 12, Maryland 6, Clemson 6, NC State 6, UF/IFAS 6, SARE 5 (cover crops), Oregon State 4, Penn State 3, Georgia 2, Alabama 2, Missouri 2, and one each from Arkansas, Colorado State, Cornell, Maine, Texas A&M, UC Master Gardeners, UMass and Wisconsin | 2026-09-28: 75 loaded and their heading checked, 1 confirmed by search. 2026-10-14: the 26 new guides loaded (HTTP 200) and their heading checked; later that day the 35 US-crop guides were fetched and their headings checked |
| `packages/data/extension/state-hubs.json` | Each state's home-garden extension page, keyed by state FIPS (50 states, DC, Puerto Rico) | 2026-09-28: 50 loaded, 2 confirmed by search |

The links are opened in the phone's browser. The app makes no request to these sites itself, so they aren't network hosts in `sources.ts`. Links rot, so re-run the check (the `checked` field records when) before each release. `scripts/plant-links.test.ts` fails if any plant or state is missing a link.

## Models built on the data

- **Climate curves** (`seasonModel.ts`). Each curve is a one-harmonic fit to the nearest NOAA 1991–2020 station's seasonal minimum and maximum normals, adjusted to the parcel's elevation with the lapse rate.
  - The fit undoes the ~10% flattening that comes from fitting 3-month averages. Albany reaches its July high and January low within about 2 °F.
  - Heat units are calibrated to the station's published annual GDD.
  - Accuracy: about ±5 days on seasonal thresholds.
- **Soil temperature** is modeled, not measured. It is mean air temperature lagged 5 days, plus up to +4 °F of solar gain near midsummer, for bare, sunny soil. For Albany it gives 60 °F on May 13 and 65 °F on May 25, in line with regional extension timing for peppers and melons. Mulched or shaded beds run cooler. A sensor or regional soil station, where one is added, overrides the model (`CalendarContext.soilF`).
- **Chill hours** use the simple 32–45 °F model on a sinusoidal day, 1 Oct – 28 Feb. Expect about ±25%. Orchardists in marginal areas should check a local chill-portion model.

## Toxicity (safety)

`packages/core/src/safety/toxicity.ts` records which library plants are listed as harmful to people, dogs, cats, horses, grazing animals, birds or rabbits, and by which source:
- the ASPCA Animal Poison Control plant lists for dogs, cats and horses (retrieved 2026-10-16);
- the ASPCA people-foods page (grapes, the onion family, citrus, nuts, avocado);
- the plant notes here, checked against each plant's extension guide.

Plant detail shows it as one line, with details on tap. A plant that isn't listed is "not listed in the cited sources", never "safe". The ASPCA lists cover the plant (leaves, stems, seeds); ripe produce can differ. `safety.test.ts` checks that every entry names a real plant and a source.
