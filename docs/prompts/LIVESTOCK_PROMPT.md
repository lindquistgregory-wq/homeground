# Build prompt: Livestock, animal records and the Herd Book

Copy everything below the line into a new Claude Code session opened at the repository root.

---

You are adding **animals** to Plotwright, a React Native (Expo) homestead-planning app. Animals should work the way plants already do:
- a library to browse
- a fit score for the user's own property
- a place on the property map where each group lives
- a care calendar tied to the local climate
- weather alerts
- user-added custom entries
- links into the homestead planner

Beyond that, add **animal records**: individual animals, production, breeding, and health and vaccination records, including household pets. A paid **Herd Book** adds pedigree and on-device breeding suggestions. Build all of it to look and behave like the existing plant features, so it feels like the same app.

## 0. Read first, and follow the house rules

1. Read `CLAUDE.md`, `docs/PLAN.md`, the latest `docs/PHASE*_REPORT.md`, `docs/PLANT_DATA.md` and `DATA_SOURCES.md`. Every non-negotiable in `CLAUDE.md` applies:
   - **Zero running cost.** Free services and libraries only; if something can't be done for free, stop and ask.
   - **New npm dependency:** add it to `licenses.json`.
   - **New network host:** add it to `packages/data/src/sources.ts` and `DATA_SOURCES.md`. Nothing here should need one: the NWS forecast at `api.weather.gov` is already a source, and outbound links open in the phone's browser.
   - **No shared API keys.**
   - **Privacy.** Never request or store parcel owner names or mailing addresses.
   - **Attribution.** Every derived number carries `Sourced<T>` or `Unavailable` from `@plotwright/core/provenance`.
   - **Work in phases** (section 11). End each phase by running `pnpm check`, summarising, confirming no paid dependency was added, listing limitations, and asking before starting the next.
2. Study how plants were built, and mirror its structure, naming and tests:

| Plant feature | Where it lives | Livestock counterpart to build |
|---|---|---|
| `PlantSpec` type, ranges and units | `packages/core/src/plants/types.ts` | `AnimalSpec` in `packages/core/src/livestock/types.ts` |
| Bundled data split by kind | `vegetables.ts`, `fruitHerbs.ts`, `fieldCrops.ts` | `poultry.ts`, `smallStock.ts` (rabbits, goats, sheep), `largeStock.ts` (pigs, cattle), `bees.ts`, `working.ts` (guardians) |
| `PLANTS`, `plantById`, `allPlants`, `searchPlants` (with aliases) | `plants/index.ts` | `ANIMALS`, `animalById`, `allAnimals`, `searchAnimals` |
| Integrity tests | `plants.test.ts` | `livestock.test.ts`: ranges in order, every species sourced, companions exist, gestation or incubation present where breeding applies |
| Explainable fit score with factors and weights | `plants/suitability.ts` (`scorePlant`, `rankPlants`) | `livestock/suitability.ts` (`scoreAnimal`, `rankAnimals`) |
| Bed or tree spot (a design object) | `design/library.ts` objects, `garden/[id].tsx` | Housing objects that already exist: `chicken-coop`, `chicken-run`, `duck-house`, `rabbit-hutch`, `goat-shelter`, `paddock`, `beehive`, `barn` |
| Plantings table and sync | `db/plantings.ts`, migration 3/7, `sync/userCloud.ts` | A `herds` table and `herds` sync collection (plus the records tables, section 6) |
| Square-foot bed grid | `plants/bedGrid.ts`, `components/bedGrid.tsx` | Housing capacity check plus a drawn enclosure showing animal glyphs |
| Calendar anchored to frost dates | `plants/calendar.ts` | `livestock/calendar.ts`, anchored to frost dates, day length and arrival or breeding dates |
| Frost, heat and wind alerts | `plants/garden.ts` `weatherAlerts`, `services/alerts.ts` | `livestockAlerts`: heat stress (temperature and humidity), cold, frozen water, storms |
| Greenhouse sensor thresholds | `services/alerts.ts`, sensors | Coop and barn thermometers attached to a housing object |
| Plant drawings | `components/PlantArt.tsx`, `plantArtMap.ts`, `scripts/plant-art.test.ts` | `AnimalArt.tsx`, `animalArtMap.ts`, `scripts/animal-art.test.ts` |
| Custom plants with an icon picker | `plants/custom.ts`, `db/customPlants.ts`, `services/customPlants.ts`, `app/plants/edit.tsx` | Custom animals the same way (`custom-` ids, validator, store, editor) |
| Extension guide links | `packages/data/extension/crop-guides.json`, `scripts/plant-links.test.ts` | `livestock-guides.json` plus a links test |
| Food values | `packages/data/knowledge/nutrition.json` | Reuse the 13 existing animal-product entries |
| Planner knowledge | `packages/data/knowledge/homestead.json` `livestock` (10 profiles), `core/planner/*` | A single source of truth (section 9) |
| On-device AI | `@plotwright/ondevice-llm` (Apple Intelligence or Gemini Nano), `core/planner/safety.ts` | Explanations of breeding suggestions, on the phone only (section 7) |
| CSV import | `app/sensors/import` | Importing animals and records from CSV |
| Data provenance doc | `docs/PLANT_DATA.md` | `docs/LIVESTOCK_DATA.md` |

3. Write new screens with the existing theme tokens (`useTheme()`), kit components (`Tile`, `Pill`, `ListRow`, `FactGrid`, `MoreInfo`, `EmptyState`, `SearchField`) and the `Text` wrapper, and never hard-code colours. A palette and navigation redesign is under review (the "Plotwright Design Review"). If it's approved first, follow its patterns:
   - one floating action button per screen
   - list rows with a leading picture and a trailing menu
   - segmented buttons for two- to five-way choices
   - a season-timeline calendar

## 1. Decisions already made by the owner (16 October 2026)

Treat these as settled. Don't re-ask.

1. **Species.** The list in section 2 is approved for version 1. The owner may add species later, so keep the data easy to extend.
2. **Animals get their own screens.** Never put animals inside the plant library or the Plants tab. The aim is for vegan and plant-only growers (and anyone else) to feel welcome.
   - A setup question asks "Do you keep, or plan to keep, animals?" If the answer is no, animal features stay out of sight.
   - A switch in Settings, "Show animal features", turns them on or off at any time.
   - The planner's existing vegan and no-animals goals keep working, and they also hide animal suggestions.
3. **Version 1 includes records**, and goes further:
   - individual animals, uploaded one at a time or by CSV
   - production tracking
   - breeding records
   - basic genetic tracking (pedigree)
   - AI-assisted breeding suggestions aimed at production
   - vaccination and health records
   - household animals such as dogs and cats, in records only
4. **Free versus paid.**
   - Free: anything to do with the health or safety of animals or plants (alerts, health and vaccination records, reminders, capacity and welfare checks).
   - Paid: genetic tracking (the Herd Book).
   - Keep as much free as possible. Plan for later features, such as DNA test integration, that might need infrastructure; don't build those now.
5. **Processing and meat content** has to suit a broad audience of beginner gardeners and homesteaders.
   - It is **off by default** behind a Settings toggle, uses neutral language and never shows graphic imagery.
   - In-depth processing content is reserved for a future paid content or social offering, which is not part of this build.

6. **Photos are stored as efficiently as possible** (section 6, Photos).
   - Compress every photo on the phone, keep one small copy, and sync only a tiny thumbnail to the user's own cloud.
   - The app must not bloat the phone.
7. **The most conservative science wins for health and safety.**
   - Where sources give a range, every health or safety default uses its most protective end. This covers the inbreeding limit, heat and cold alerts, space per animal, water, group sizes and anything else of the kind.
   - Users may make settings *more* protective freely. Making them less protective is capped (section 8, Conservative defaults).
   - This also limits the business's liability and insurance exposure.
8. **Affiliate links: include every legitimate, free-to-join program that suits the app's homestead look** (section 10, Affiliate links).
   - Only established retailers on reputable affiliate networks.
   - Each is switched on only after the owner has joined and entered the affiliate ID.

No questions remain open for the build session. If a new decision comes up, ask the owner before guessing.

## 2. Species for version 1 (about 20)

Each entry is a species, with a purpose where the data differs by purpose, the same way plants are species-level with variety notes. Breeds are a list inside the entry, not separate entries.

- **Poultry:**
  - laying hens, meat chickens (broilers), dual-purpose chickens
  - turkeys
  - ducks (laying and meat)
  - geese
  - guinea fowl
  - coturnix quail
- **Small stock:**
  - meat rabbits
  - dairy goats, meat goats, fiber goats (Angora)
  - sheep, with purposes for meat, wool and dairy
- **Large stock:**
  - feeder pigs
  - small-acreage beef cattle (including miniature and Dexter-type breeds)
  - family milk cow
- **Pollinators:** honeybees (and the existing `beehive` object)
- **Working animals:**
  - livestock guardian dog
  - guardian donkey
  - guardian llama, with alpaca as a fiber animal

**Household animals** (dogs, cats and "other pet") are a records-only type. They get a profile and health records, but no library entry, fit score, housing or breeding suggestions.

Leave out horses, bison, deer, aquaculture and exotic species for now, and say so in `LIVESTOCK_DATA.md`.

## 3. `AnimalSpec`, data and sourcing

Follow the conventions already in `homestead.json`:
- Values are `[low, high]` ranges, with a single sourced value written as `[v, v]`.
- `null` means no acceptable source was found; never guess.
- `derived: true` marks simple arithmetic on cited figures.
- `oldData` flags figures from before 2016, and `oldPrice` flags prices from before 2020.
- Every entry lists its sources with URL and year.
- Values are facts written for this project. Never copy text or tables.

Fields (units in the names, imperial like plants):

- **Identity:** `id`, `commonName`, `aliases`, `scientificName`, `kind` (`poultry | waterfowl | small-stock | ruminant | pig | cattle | pollinator | working`), `purposes[]` (`eggs | meat | milk | fiber | honey | guardian | pest-control | grazing | breeding`).
- **Social:**
  - `minGroupSize`
  - `starterGroupSize`
  - `maleNeeded` (for example, no rooster for eggs)
  - `maleToFemaleRatio`
  - `livesAloneOk`
- **Climate:**
  - `heat`: tolerance level plus the stress thresholds and which index they use (air temperature for poultry and rabbits, THI for ruminants)
  - `cold`: tolerance level and the lowest safe temperature with shelter
  - `humiditySensitive`
  - `shadeNeeded`
- **Housing:**
  - `spaceIndoorSqFt` and `spaceOutdoorSqFt` per head
  - `nestBoxesPer` and `roostInPerBird` (poultry)
  - `pastureAcresPerHead` or `animalUnitEquivalent`
  - `fence` (type, height in ft, and whether the species climbs, digs or jumps)
  - `housingObjects[]`: which design-object kinds can hold it
- **Feed and water:** `feedLbPerYear` or `feedLbPerGrowOut`, `forageShare`, `waterGalPerDay` (with hot-weather notes).
- **Production, by purpose:**
  - eggs per year, laying start age in weeks, and productive years
  - milk lb per lactation and lactation days
  - grow-out days and live weight
  - fiber lb per year
  - honey lb per year
  - Dressed weight and processing age live in a separate `processing` block that the UI shows only when the processing toggle is on (section 8).
- **Reproduction:**
  - `gestationDays` or `incubationDays`
  - `breedingSeason` (for example, short-day breeders mating in fall)
  - `litterSize`, `weaningDays`
  - `heritability` for the main production traits (with sources), used by the Herd Book
  - `knownMatingRisks[]` (for example, the polled intersex risk when breeding two naturally polled goats). Each needs its own source.
- **Lifespan and labor:** `lifespanYears`, `laborHoursPerWeek`, `noise` (`low | medium | high`, for neighbours and zoning).
- **Cost:** `startupCostUSD`, `annualCostUSD`, `priceYear`.
- **Manure:** `manureLbPerDay` and a `manureUse` note (for example, rabbit manure can go straight on beds while poultry manure needs composting). Use `null` where no source is found.
- **Risks:** `predators[]`, `diseasesToKnow[]` (names and prevention only; see section 8), and `biosecurity` notes.
- **Compatibility:** `companions[]` and `keepApart[]`, each with a reason. For example, sheep are sensitive to copper, so they must not share goat or cattle mineral.
- **Rules:** `regulatory[]` (section 8).
- **Breeds:** `breeds[]`, each `{ name, climate: 'heat' | 'cold' | 'both' | null, purpose, note, source }`.
- **Notes and sources:** `notes[]`, `sources[]`.

Write `docs/LIVESTOCK_DATA.md` with the same sections as `PLANT_DATA.md`: the bundled database, licence position, review, how far to trust it, and extension links.

## 4. Core logic (`packages/core/src/livestock/`, pure, no I/O)

- **`scoreAnimal(spec, site, housing?)`** works like `scorePlant`: 0–1 factors with weights and plain-language reasons, and hard caps where something is impossible.
  - **Factors:**
    - summer heat (peak summer maximum plus summer humidity from the site profile, against the heat threshold)
    - winter cold (from the hardiness zone's minimum temperature)
    - land (parcel area against pasture need)
    - housing capacity (when a housing object is given)
    - water access
    - wet ground (cold-air pooling and flood zone, reusing `design/siting.ts`)
    - shade (from the sun engine, where the housing object has sun hours)
    - labor against the planner's time goal, when known
  - **Zoning and noise are flags, never blockers.** The app can't know local code.
  - Export the weights and cover them with tests.
- **`housingCapacity(spec, object, frame)`**:
  - Coops, houses and hutches: indoor floor area divided by space per head.
  - Runs: outdoor area per head.
  - Paddocks: acres per head or animal units.
  - Hives: count per apiary area.
  - Returns `{ fits, planned, limitingFactor }`.
  - Overcrowding is a welfare issue, so this check is free.
- **`animalCalendar(spec, herd, ctx)`** works like `plantCalendar`, anchored to median frost dates (`ctx.frost`), day length and the herd's arrival, hatch or breeding date. Event kinds include:
  - `order` (chicks, piglets, packages) and `brood`
  - `move-outside` (when the birds are feathered and nights are warm enough)
  - `lay-start` and `molt`
  - `breed`, `due` (breeding date plus gestation) and `wean`
  - `shear` and `hoof-check`
  - `install-bees`, `swarm-watch`, `mite-check`, `add-supers`, `honey-harvest` and `winter-prep`
  - `heat-prep` and `winter-water`
  - `process`, only when the processing toggle is on

  Every event explains its basis ("median last frost Mar 28 + 6 weeks"), as plant events do.
- **`livestockAlerts(periods, herds)`** works like `weatherAlerts`:
  - **Heat:** use air temperature for poultry and rabbits, and THI for goats, sheep and cattle. Use the THI formula that matches the cited thresholds, so the scale stays consistent. Parse `relativeHumidity` from the NWS forecast, which is the same `api.weather.gov` host: extend `ForecastPeriod` and `parseNwsPeriods`, and fall back to temperature-only when humidity is missing.
  - **Cold:** below the species' safe minimum, plus a reminder that water may freeze at 32 °F or below.
  - **Storms and high wind:** check hives and shelters.

  Alert bodies say what to do (shade, water, ventilation, close up at dusk). They never give medical advice. Alerts are free.
- **Custom animals:** `livestock/custom.ts`, mirroring `plants/custom.ts`: `custom-` ids, `setCustomAnimals`, `validateAnimalSpec` (the same rules as the integrity test, which every bundled species must pass), and `blankAnimalSpec(kind)`.
- **Breeding math** (`livestock/breeding.ts`): see section 7.

## 5. App screens (`apps/mobile`)

- **Entry points:** Animals has its own area and is never placed in the Plants tab.
  - Reach it from a Home quick action, from animal objects on the map, and from More.
  - Show none of them when "Show animal features" is off.
  - Don't add a sixth tab: the bar holds five at most.
- **Animals library** (mirrors `app/plants/index.tsx`): search with aliases, kind chips, an `AnimalArt` tile, a meta line (space, climate, purpose), a fit badge when a property is selected, and "Add your own animal".
- **Animal detail** (mirrors `app/plants/[plantId].tsx`):
  - header with the drawing
  - "Needs" `FactGrid`: space, feed, water, group size, heat, cold, noise, fencing
  - "Care calendar" for the property
  - "Fit for your property" with its factors
  - "Housing & fencing"
  - "Breeds for your climate"
  - "Rules to check" (regulatory and zoning, always visible)
  - "Learn more from extension experts"
  - an "Add to my homestead" button that opens the map so the person can pick or create a housing object
- **Housing planner:** the counterpart of the bed planner, opened by "Plan this coop / paddock / hive" from a selected animal object on the design map.
  - Conditions: sun and summer shade, slope, wet spot, flood, and distance to the house and well, all from `siting.ts` and the site profile.
  - "Who lives here", with status advances such as Planned → Active.
  - A drawn top-down enclosure with animal glyphs and a capacity bar, like the drawn raised bed.
  - Species ranked for this housing.
- **Calendar and Home:** animal events join the planting calendar and Home's "Coming up", with their drawing and "where" (the housing name).
- **Alerts and sensors:** `services/alerts.ts` checks `livestockAlerts` alongside crops. A thermometer can be attached to a coop or barn, as it can to a greenhouse, with heat and cold thresholds taken from the species in that housing.
- **Art:** `AnimalArt` in the same flat, friendly style and 48 × 48 viewBox as `PlantArt`.
  - Drawings: hen, broiler, turkey, duck, goose, guinea fowl, quail, rabbit, goat, sheep, pig, cow, bee or hive, donkey, llama or alpaca, guardian dog, house dog, cat.
  - Custom animals pick a drawing and a colour, as custom plants do.
  - Add a test that every species has art.
  - Use the drawings on map badges for animal objects too.
- **Custom animals editor:** `app/animals/edit.tsx`, mirroring `app/plants/edit.tsx`. Start blank or copy a library species, use the icon picker, and validate before saving.

## 6. Animal records (free)

These are the records the owner asked for in version 1. Everything stays on the phone and in the user's own cloud, through the existing sync.

- **Groups and individuals:**
  - A **herd** (flock, colony or litter) is the planning unit already described.
  - An **animal** is an individual with these fields:
    - `id`, `herd_id` (nullable), `species_id` (or `household:dog|cat|other`)
    - `name`, `tag` (ear tag, leg band, scrapie ID or microchip), `sex`, `birth_date`
    - `breed`, `color_markings`
    - `sire_id` and `dam_id` (other records, or "outside animal" with a name and registration number)
    - `registration_no`, `acquired_on`, `source`
    - `status` (`active | retired | sold | deceased`, plus `processed` only when the toggle is on)
    - `photos[]` (optional; see Photos below)
    - `notes`
- **Photos:** the owner wants the smallest footprint that still looks good.
  - **Picking:** use `expo-image-picker` and `expo-image-manipulator`, both Expo SDK modules under the MIT licence. Add both to `licenses.json`.
  - **Compression, done once at the moment of picking:**
    - Resize so the long edge is 1280 px and encode with quality around 0.6. Use WebP if the SDK 55 manipulator supports it (confirm in the docs and types), otherwise JPEG.
    - Make a 320 px thumbnail at about 0.5 quality.
    - Targets: about 150 KB or less per photo and about 15 KB per thumbnail. Add a test that checks sizes on fixture images.
  - **Never keep the original.**
  - **Location metadata:** re-encoding must remove EXIF, including GPS location. Verify this with a test fixture that has GPS tags. It matters for privacy too.
  - **Limits and clean-up:**
    - At most 5 photos per animal, and the first is the profile picture.
    - Settings shows the storage used.
    - "Free up space" removes full-size photos older than a chosen age but keeps thumbnails.
  - **Storage and sync:**
    - Full-size photos stay in the app's document folder on the phone and go into the user's export.
    - Only thumbnails sync, through the user's own cloud and the existing sync, so another device can show them without the data doubling.
    - Don't add any other cloud storage.
- **Adding animals:**
  - one at a time
  - "add 10 hatched on Apr 2" in bulk
  - CSV import, mirroring the sensor CSV import, with a downloadable template the app writes itself; there's no network involved
  - CSV and JSON export of everything (section 12)
- **Production logs (`animal_logs`):**
  - Fields: `animal_id` or `herd_id`, `date`, `kind`, `value`, `unit`, `note`.
  - Kinds: eggs (group per day, with one-tap +1), milk per milking, weight, litter size at birth and weaning, fleece weight, honey per hive, feed bought.
  - Show simple charts (week, month, season) and per-animal or per-group summaries such as eggs per hen per week, lactation total and kits weaned per litter.
- **Breeding records:**
  - Fields: bred date, sire, dam, method, expected due date (from `gestationDays` or `incubationDays`), outcome (number born and alive) and notes.
  - Due dates appear in the calendar.
- **Health records:**
  - Fields: date, type (`vaccination | vet-visit | treatment | test | injury | other`), product or vaccine name as the user writes it, given by, lot number (optional), next due date (entered by the user or their vet), notes.
  - Reminders use local notifications, the same mechanism as alerts.
  - Household pets use the same screens.
  - The app **records** what the user and their vet decide. It never chooses vaccines, schedules or doses (section 8).
  - Add a "share with my vet" export: a PDF or CSV of one animal's health history. This is free, because it's health.
- **Welfare check (free):** a gentle note when a social species is kept alone, or when a group exceeds its housing capacity.

## 7. Herd Book: pedigree and breeding suggestions (paid)

This is the paid part. All computation runs on the phone, so it costs nothing to run.

- **Pedigree:**
  - a pedigree tree for any animal (at least 4 generations, more where recorded)
  - offspring lists and a relatedness check between any two animals
- **Inbreeding:**
  - Calculate the coefficient of inbreeding (COI) of a proposed pairing with the tabular method or Wright's path method, including each common ancestor's own inbreeding.
  - Warn that a shallow pedigree makes COI read low, and treat missing ancestors as unknown, never as unrelated.
  - **The default limit is below 5%, the most conservative widely cited guidance.** The owner chose the most conservative default the science supports:
    - No level of inbreeding is entirely safe.
    - Guidance commonly calls under 5% the safest range for avoiding inherited recessive disease, while 6.25% (offspring of first cousins) is the looser livestock rule of thumb.
    - Breeding suggestions never include a pairing at or above 5% COI. Among pairings below the limit, the lowest COI ranks first when production merit is similar.
    - Users may lower the limit freely. Raising it needs an explicit acknowledgement and is capped at 6.25%. No setting allows suggestions above that.
    - Say plainly in the app that the limit is a precaution, not a guarantee.
  - **Herd-level check:** following FAO guidance (an effective population of at least 50, which keeps the rise in inbreeding under 1% per generation), warn when the herd's average COI is climbing by about 1% or more per generation, and suggest bringing in unrelated breeding stock.
- **Production merit:**
  - For each animal with records, compare its production with its contemporaries (same species, sex, season and housing) as a deviation from the group average.
  - Weight that deviation by the trait's sourced heritability, and combine it with the parents' average to estimate breeding merit.
  - Show it as a range with a confidence word ("rough estimate: 8 records"), never as a precise score.
- **Breeding suggestions:**
  - For each female, rank candidate males by expected offspring production, with a penalty for inbreeding.
  - Exclude anything over the COI limit and anything matching a sourced `knownMatingRisks` rule.
  - Each suggestion explains why: "Expected milk +4% over herd average; COI 3.1%; both parents have 2+ lactations recorded."
- **AI explanations:**
  - The deterministic math in `livestock/breeding.ts` makes the suggestions.
  - The on-device model (`@plotwright/ondevice-llm`, as the planner uses it) only explains results and answers questions about the user's own records, such as "Why is Daisy ranked first?"
  - Nothing is sent off the phone, and there's no cloud AI.
  - Route questions through `planner/safety.ts`, so health questions get the "ask your vet" reply.
  - Where the phone has no on-device model, the written explanations still work.
- **Reports:** a herd summary, a breeding plan for the season, and pedigree export to PDF.
- **Later, not now:** importing DNA parentage or genotype results from labs, and registry integrations. Design the `animal` record with an optional `dna_tests[]` field (lab, date, result notes), so a later version can add these without a migration. Don't build any lab connection.
- **Never for household pets.** Pet breeding suggestions are out of scope.

Test the breeding math with hand-worked pedigrees: half-sibling and first-cousin matings, plus inbred common ancestors. Test the ranking with fixture herds.

## 8. Safety, legal, tone and audience (ships with the feature)

- **Conservative defaults** (owner decision 7):
  - Wherever the data gives a range and the number drives a health or safety decision, use the protective end:
    - heat alerts at the *lowest* cited onset temperature or THI
    - cold alerts at the *highest* cited safe minimum
    - housing capacity from the *largest* cited space per head
    - water from the *highest* cited daily need
    - group minimums from the *largest* cited value
    - gestation and incubation due windows wide enough to cover the cited range
  - Store the rule in one place (`livestock/safetyDefaults.ts`) and test it: for every species, the alert threshold equals the protective end of its sourced range.
  - Users can tighten thresholds. Loosening any of them below the sourced protective value isn't offered.
  - The insurance and legal review that follows this build (see the closing note) may tighten these further.

- **No veterinary diagnosis or dosing.** The planner's `planner/safety.ts` already blocks this.
  - Apply the same rule everywhere in livestock and pet copy, including the health records and the on-device AI.
  - Disease entries give the name, what it looks like and how to prevent it, then "call your veterinarian".
  - The app never suggests medications, vaccines, schedules or doses; it only stores what the user enters.
  - Bee mite checks are monitoring, and any treatment points to "follow the product label".
  - For pets' legally required vaccines (rabies laws vary by state and county), say "check your local requirements" and link to the state or county page where one exists.
- **Local rules come first.** Show "Check local code" on every species. Zoning often limits roosters, flock size, hives and setbacks. Never say an animal is allowed at an address.
- **Federal and state items to surface, as notes with sources (not legal advice):**
  - NPIP participation and HPAI biosecurity ("Defend the Flock") for poultry.
  - Scrapie program official ID for sheep and goats that leave the premises.
  - Raw milk sale, which varies by state.
  - Apiary registration, which many states require.
  - USDA poultry slaughter exemptions (1,000 and 20,000 birds, 9 CFR 381.10), shown only when the processing toggle is on.
- **Processing content is off by default.**
  - The Settings switch "Show harvest and processing details" is off by default.
  - **When it's off:** meat species stay in the library, described by their care needs and purpose ("raised for meat"). Dressed weights, processing ages, `process` calendar events, processing regulations and the `processed` status are hidden.
  - **When it's on:** show them in plain, neutral language, such as "processing date" and "dressed weight".
  - Never show images or descriptions of slaughter, at any setting.
  - The planner's meat suggestions use the same neutral wording either way, and its food-coverage maths keeps working.
  - Step-by-step processing guidance is not part of this build. It belongs to a possible future paid content offering (section 10).
- **Predators:** recommend fencing, secure housing and guardian animals. For lethal control or trapping, point to the state wildlife agency.
- **Welfare:** don't suggest keeping social species alone. Show `minGroupSize` and the reason.
- **Welcoming:** the plant side of the app must never require, mention or push animals. Animal features appear only for people who choose them (section 1).
- Update `docs/TERMS.md`, the privacy policy and the Play data-safety notes for the new records (health records for animals and pets, photos). Store them on the phone and in the user's own cloud only, and never share them.

## 9. Planner integration

`homestead.json` already holds 10 livestock profiles used by `core/planner` (`plan.ts`, `nutrition.ts`, `budget.ts`, `coverage.ts`, `tools.ts`). Don't let the two copies drift:
- Make `AnimalSpec` the single source of truth, and derive `LivestockProfile` from it, keeping the same ids (`laying_hens`, `meat_chickens`, `ducks_layers`, `meat_rabbits`, `dairy_goats`, `meat_goats`, `sheep`, `feeder_pigs`, `honeybees`, `turkeys`).
- Or, if that is too invasive, add a test that checks the two agree.

Every existing planner test must keep passing. When the planner drafts animal objects onto the map, offer to create matching planned herds. When "Show animal features" is off, the planner doesn't suggest animals.

## 10. Tiers and monetisation

Mirror the structure in `core/entitlements.ts` (Free / Grower / Homestead Pro, or the open-source-plus-ads model). Add features with names to match.

**Free** (health, safety and the basics, as the owner asked):
- the Animals library and detail, fit scores with reasons, and housing capacity and welfare checks
- the care calendar
- heat, cold and storm alerts, which are never paywalled
- individual animal records, production logs with simple charts, breeding records and due dates
- health and vaccination records with reminders, and the "share with my vet" export
- household pets
- CSV import and export, and custom animals

**Paid: `livestock.herdBook`** (the Herd Book):
- pedigree trees, COI and relatedness, production merit, breeding suggestions with on-device AI explanations
- season breeding plans and pedigree PDFs

There's no server cost, so it can be a one-time unlock, part of Homestead Pro, or both. Leave the price to the owner.

**Other revenue ideas** that fit the zero-cost rule. Build them only if the owner says so; they can be switched off.
- **Sales and cost ledger** (eggs, honey, kids, fleece): cost per dozen and profit per animal, using the existing `planner.income` entitlement. Paid.
- **Contextual ads on animal and pet library screens.** Use the existing consent-gated AdMob setup.
  - Ads may match the screen's topic (pet or livestock supplies), but never use a user's health records or animal data for targeting.
  - Google treats health as a sensitive category for personalised ads.
  - No ads on health records, alerts or the vet export, as alerts are already ad-free.
- **Affiliate links** (owner decision 8): include every legitimate, free-to-join program that suits the homestead look. The list is in "Affiliate links" below.
- **Find a vet:** a link to a free public locator (for example, AVMA or AAHA). Referral partnerships come later.

### Affiliate links

**Registry.** Keep the programs in `packages/data/affiliates/programs.json`. Each entry has:
- `id`, `name`, `category` (`seeds | garden-tools | homestead | livestock-supplies | pet-supplies | general`)
- `network`, `signupUrl`, `merchantHost`, `trackingHosts[]`
- `status` (`needs-signup | active | paused`)
- `affiliateId`, which the owner fills in after joining; it's public in every link, so it isn't a secret
- `termsCheckedOn`, `disclosure`, `allowedPlacements[]`

A link is only ever built for `active` entries.

**Candidates found on 16 October 2026.** Status is `needs-signup` for all of them. The owner must join each program personally: confirm the current terms, then enter the ID.

| Program | What it fits | Network | Evidence |
|---|---|---|---|
| Chewy | Pet food, pet health supplies, some farm-animal supplies | Impact | Official affiliate page: 4% on new and existing customer orders. Third-party pages also mention $15 per new customer. |
| Tractor Supply Co. | Livestock feed, fencing, coops, farm supplies | Partnerize | Official affiliate page. FlexOffers lists 1.6–5.6%. |
| Lehman's | Homestead, food preservation and off-grid goods | Pepperjam | Official page: 6%, 30-day cookie. No trademark bidding. |
| True Leaf Market | Seeds, microgreens, sprouting | Pepperjam or Awin | Official page. Content partners about 10–20%, 30 days. |
| Botanical Interests | Seeds | Own program (about 15% on ShareASale, per a third party) | Official program page. |
| Burpee | Seeds and plants | FlexOffers | Listing only (about 4%). Confirm it on Burpee's own site before activating. |
| Gardener's Supply Company | Garden tools and supplies | Impact (per a third party) | No official page found. Confirm before activating. |
| Hoss Tools | Garden tools and seeds | ShareASale (per a third party) | About 10%, 30 days, per third parties. Confirm before activating. |
| Amazon Associates | Books and general supplies | Amazon | Official. The Mobile Application Policy requires the app to be approved and free to download, with Amazon links reachable without paying. The site-level statement "As an Amazon Associate I earn from qualifying purchases" is required. |

**Leave these out.**
- Baker Creek Heirloom Seeds publicly states it does not engage in affiliate marketing, so don't add it or work around that.
- No affiliate program was found for Johnny's Selected Seeds, Meyer Hatchery, Murray McMurray Hatchery, Mann Lake or Premier 1 Supplies. Add them only if the owner later finds an official program.
- Don't add live-animal sellers, medication or vaccine products, or any merchant without an official affiliate page or a major network listing. Live animals and medications carry welfare, legal and veterinary liability.

**Safety and legitimacy rules.**
- Links use HTTPS and point only to the merchant's own domain or the named network's tracking domain.
- Add a test that every built link's host is in the entry's `merchantHost` or `trackingHosts`, and that no link carries user data. Topic search terms such as "chicken feeder" are allowed; parcel, location, animal names or records are not.
- Links open in the phone's browser, never in an in-app web view, so they add no network host.
- Re-check each program's terms at least once a year, and record the date in `termsCheckedOn`.

**Where links may appear.**
- A small "Shop supplies" row on plant detail (seeds for this crop) and animal detail (supplies for this species), styled as plain rows with an icon, not banners.
- Never on health records, alerts, the vet export, safety notes or setup screens.
- Never next to anything about medication, dosing or disease.

**Disclosure** (FTC Endorsement Guides, 2023: "clear and conspicuous", meaning hard to miss and easy to understand):
- Label each row "Paid link". Put a one-line note above each group: "Plotwright earns a commission on purchases from these links."
- Add a Disclosures page in More, with the Amazon statement when Amazon links are present.

**Controls.**
- A Settings switch, "Show shopping links", is on by default only where the owner has activated programs, and every user can turn it off.
- A remote kill switch isn't possible without a server, so ship each program's `status` in app updates.

**Later, and these need infrastructure, so ask before building:** DNA lab integrations, cloud photo backup beyond the user's own cloud, and the paid social or content subscription (where in-depth processing content would live). These have running costs (servers and moderation), so they conflict with the zero-cost rule until the owner decides otherwise.

## 11. Phases (stop after each one for the owner's go-ahead)

1. **Data.**
   - `AnimalSpec`, the species data with sources (including heritabilities and mating risks), the integrity and validator tests, and `livestock-guides.json` with its links test.
   - `docs/LIVESTOCK_DATA.md`.
   - Planner unification (section 9).
2. **Core logic.** `scoreAnimal`, `housingCapacity`, `animalCalendar` and `livestockAlerts` (including NWS humidity parsing), all with fixture-based tests like the plant ones.
3. **Animals area.** `AnimalArt`, the Animals library and detail, the setup question and "Show animal features" switch, the processing toggle, and the `herds` table and sync.
4. **On the map.** The housing planner from design objects, the capacity diagram, herds on Calendar and Home, alerts wiring, and coop and barn sensor thresholds.
5. **Records (free).**
   - Individual animals and household pets.
   - Production logs and charts, breeding records and due dates.
   - Health and vaccination records with reminders.
   - The vet export, and CSV import and export.
   - New tables and sync collections.
6. **Herd Book (paid).** `livestock/breeding.ts` (pedigree, COI, merit, suggestions) with hand-worked tests, pedigree and breeding screens, on-device AI explanations, reports, and the `livestock.herdBook` entitlement.
7. **Custom animals and polish.**
   - The custom animals editor.
   - Optional revenue hooks (switched off).
   - Privacy and terms updates.
   - Store-listing copy and on-device verification.

**Verifying on the device:** install a release build on the owner's phone. Use the guarded phone helper and never press Back to leave the app.
- Add a test herd (for example, 6 hens in the coop) and test animals with a small pedigree.
- Check fit, capacity, calendar, an alert preview, an egg log, a health reminder and a breeding suggestion.
- Remove every test record afterwards.

## 12. Open by design

- Users own their data. Export every record as CSV and JSON so it works with spreadsheets, other apps and assistants.
- Label every control for screen readers, and keep wording plain.
- Don't add accounts, a server or an API: the zero-cost rule still holds.

## 13. Done when

- `pnpm check` passes: typecheck, all tests (old and new), and the license and zero-cost gate.
- Every species value is sourced or `null`, and `LIVESTOCK_DATA.md` says how far to trust it.
- **Library to map:** people can pick a species, see whether it fits, place a herd in a coop or paddock, see the capacity, and get its care events and heat and cold alerts.
- **Records:** people can add animals (including pets) singly or by CSV, log production, record breeding and due dates, and keep health records with reminders and a vet export, all free.
- **Herd Book:** pedigree, COI, merit and breeding suggestions work on the phone with explanations, behind `livestock.herdBook`.
- **Off switches:** with "Show animal features" off, nothing animal-related appears. With the processing toggle off, no processing details appear.
- **Boundaries:** no veterinary dosing or schedules, no "this is allowed here" claims, a regulatory section on every species, and no animal or health data used for ads.
- **Conservative defaults:** every health or safety threshold is the protective end of its sourced range (tested). Breeding suggestions never reach 5% COI by default, or 6.25% at any setting.
- **Photos:** compressed to the size targets with location data removed (tested). Only thumbnails sync.
- **Affiliate links:** built only for activated programs, to approved hosts, with disclosures, and never on health or safety screens (tested).
- **Styling:** new screens use theme tokens only, so the coming palette change applies automatically.

**Closing note:** the owner has commissioned a separate insurance-risk and legal-compliance review of every health and safety feature (the "Plotwright Safety & Liability Review"). Apply its findings over anything here that is less strict. The livestock items it raised are below, and they are required.

## 14. Required by the safety and liability review

- **Zoonoses (CDC).** Poultry species show CDC Salmonella guidance on the detail page and in the setup checklist:
  - Children under 5 should not handle chicks, ducklings or adult birds, or go into their areas.
  - Wash hands with soap and water for 20 seconds after touching birds, eggs or supplies.
  - Don't kiss or snuggle birds, and keep birds and their supplies out of the house.
  - Link the CDC page. Give the general handwashing advice for all livestock.
- **Wells and manure.** Housing, paddocks, manure and compost placed within **200 ft** of a well object (or the house's water supply) get a warning in the housing planner and on the map. Use the strictest common state rule:
  - South Carolina requires 200 ft between barns or pens and human drinking-water wells.
  - North Carolina requires 100 ft from barns and manure piles.
  - Alabama recommends 150 ft from livestock or pet shelters.
  - Say "check your state well code and county rules". Recommend annual testing of private wells for coliform bacteria, nitrate, pH and dissolved solids (EPA), and more often with infants or pregnancy in the home, because high nitrate is dangerous for infants.
- **Plants toxic to animals.** Add `toxicTo` to `PlantSpec` (`dogs | cats | horses | ruminants | poultry | rabbits | pigs`) with sources: the ASPCA plant database for pets, and extension circulars such as UNL EC3037 for livestock.
  - When animal features are on, show a warning where a toxic plant and an animal that eats it are close on the map or in the same paddock.
  - Example pet toxins: the allium family (onion, garlic, chives), and grapes for dogs.
  - Never call any plant "safe".
- **Bees.** Show allergy and sting cautions for neighbours and household members. Common ordinances require setbacks or a flyway barrier near property lines, so "check local code".
- **Guardian dogs and large animals.** Note bite and kick risk, the need for secure fencing next to roads, and that local leash and nuisance laws apply.
- **Electric fences** (map object): add warning signs where the fence borders a road, path or neighbour. Some codes require signs at set intervals, for example every 30–60 ft for security fences in California and Texas; for livestock fences, check state and local rules. Use a listed energizer, and keep fences away from children's play areas.

## Appendix: research notes to start from (verify against the primary source before use)

The figures below are leads for the data pass, not final values. Each needs its primary source confirmed and cited with a year.

- **Heat stress, sheep and goats:** THI 82–<84 is moderate, 84–<86 severe and 86 or above extreme (South Dakota State University Extension; Missouri Extension uses the same severe and extreme cutoffs). Sheep and goats tolerate heat better than cattle, so don't reuse cattle thresholds for them.
  - [SDSU/OSU sheep](https://u.osu.edu/sheep/?p=5170)
  - [Missouri Extension](https://extension.missouri.edu/news/managing-heat-stress-in-sheep-and-goats)
- **Heat stress, cattle:** stress is possible above THI 80, or when nights stay above 70 °F (University of Missouri, via Nebraska). Charts use different scales, so pair each threshold with its own formula. USDA SERCH LIGHTS sends cattle heat-stress alerts.
  - [UNL G2355](https://extensionpubs.unl.edu/publication/g2355/html/view)
- **Heat stress, laying hens:** begins near 85 °F and becomes dangerous above 95 °F (University of Kentucky, cited secondhand). Heavy breeds suffer sooner. Find the primary University of Kentucky or other extension page.
  - [Farmer's Almanac summary](https://www.farmersalmanac.com/frozen-wreath-treat-for-chickens)
- **Cold, poultry:** frostbite risk is highest for single and large combs and for wet wattles. Pea and cushion combs resist it (The Livestock Conservancy).
  - [Heritage chicken FAQ](https://livestockconservancy.org/?p=2064)
- **Breeds by climate:** The Livestock Conservancy's 2026 Heritage Chicken Breed Comparison Chart rates breeds for heat and cold. The Conservancy has similar charts for other species.
  - [Chart PDF](https://livestockconservancy.org/wp-content/uploads/2026/03/PickaBreedChickens2026.pdf)
- **Rabbits:** handle cold far better than heat, and above 85 °F is dangerous (secondary source). On kindling, nest boxes and hot-weather kits, see Oregon State EC 1655. No authoritative hutch area per doe was found yet.
  - [OSU EC1655](https://extension.oregonstate.edu/sites/default/files/documents/ec1655.pdf)
- **Gestation and incubation:** goat 150 days, pig 114, rabbit 31, cattle about 283 (279–287). For sheep, the Merck table says 150 while most other sources say about 147 (144–152), so record a range.
  - [Merck Veterinary Manual table](https://www.merckvetmanual.com/multimedia/table/approximate-gestation-periods)
- **Animal unit equivalents (NRCS):** cow with calf 1.00, mature horse 1.25, mature sheep 0.20, mature goat 0.15, kid 0.10. One animal-unit year is 9,490 lb of forage dry matter. Acres per unit come from local forage production (Web Soil Survey or the county), not from the table.
  - [Oregon State](https://extension.oregonstate.edu/es/catalog/em-9552-estimating-measuring-pasture-productivity)
  - [Wyoming B-1320](https://www.wyoextension.org/agpubs/pubs/B-1320_AUMs-for-web.pdf)
- **Beef on eastern pasture:** one Iowa State rotational trial stocked 1.65–1.72 acres per cow-calf pair. That is site-specific, so present it as an example, not a rule.
  - [Iowa State](https://iastatedigitalpress.com/air/article/7277/galley/7106/download)
- **Water:** NDSU AS1763 is the standard table. Beef cows need about 15–18 gallons a day at 90 °F (more when nursing), and needs can double in heat. Sheep and goats need about 0.5–2 gallons a day, and horses 10–12 (a Nebraska table). Get pig and poultry figures from AS1763 itself.
  - [Drovers summary of NDSU](https://www.drovers.com/news/education/water-drought-plans-most-overlooked-line-item)
  - [UNL drought](https://drought.unl.edu/ranchplan/BeforeDrought/WaterManagement/WaterDevelopmentProjects.aspx)
- **Bees:** install packages in early spring and feed until comb is drawn. Swarm season runs about April–July (April–May in central North Carolina, May–July in Utah). Count mites monthly through the season; Utah State suggests treating above about 5 mites per 300 bees, and the product label always governs.
  - [Utah State calendar](https://extension.usu.edu/beekeeping/learn/calendar)
  - [NC calendar](https://www.ncbeekeepers.org/wp-content/uploads/2024/01/CALENDAR-FOR-BEEKEEPING-IN-CENTRAL-NORTH-CAROLINAupdate23.pdf)
  - [Maine calendar](https://www1.maine.gov/DACF/php/apiary/documents/factsheets/maine-beekeepers-calendar.pdf)
- **Scrapie ID:** sheep and goats generally need official ID when they leave the premises, and records of animals added and removed must be kept, so the records feature helps here. There are exemptions, for example castrated animals under 18 months, and animals shipped directly to slaughter or to an approved market. States may be stricter. Confirm the current APHIS rule, since electronic ID was planned.
  - [APHIS fact sheet](https://www.aphis.usda.gov/sites/default/files/fs_ahscrapie.pdf)
- **Poultry processing exemptions** (processing toggle only): up to 1,000 birds a year that you raised yourself, under conditions; 1,000 to 20,000 under P.L. 90-492. States choose whether to adopt each. Confirm against 9 CFR 381.10.
  - [MSU summary](https://www.canr.msu.edu/foodsystems/uploads/resources/Value%20Added%20Product%20Poultry%20Sheet%20%205-8-2025.pdf)
  - [FTCLDF](https://www.farmtoconsumer.org/blog/2016/12/30/introduction-ftcldf-farm-poultry-processing-map)
- **NPIP and HPAI:** any flock size can join. State backyard programs (for example, California's, for 100 birds or fewer) test for pullorum-typhoid and avian influenza. USDA "Defend the Flock" is the biosecurity reference.
  - [CPIF](https://cpif.org/backyard-flock-programs/)
  - [OSU HPAI](https://extension.okstate.edu/county/mcintosh/media/docs/agriculture/timely-topics-november-2023-a.pdf)
- **Guardians:**
  - Fencing comes first; guardians add a second layer.
  - Keep one llama, because a pair bonds with each other instead of the flock.
  - Donkeys take 4–6 weeks to bond and can injure newborn lambs or kids.
  - Dogs (Great Pyrenees, Anatolian) are the only guardians that work without fences.
  - [CDFA handout](https://www.cdfa.ca.gov/ahfss/Animal_Health/pdfs/livestock%20guardians.pdf)
- **Coturnix quail:** about 1 sq ft per bird, laying from about 6–8 weeks (secondary sources). Guinea fowl and geese still need extension sources.
- **Pigs:** confinement finishing trials found 8–10 sq ft per pig adequate to 250 lb (Kansas State). That does not apply to pasture; find pasture stocking figures.
  - [KSU](https://newprairiepress.org/kaesrr/vol0/iss10/476)
- **Manure:** the standard is ASABE D384.2. Extension copies of the MWPS-18 tables give horse and sheep rows. Poultry, goat and rabbit rows still need a source.
  - [Virginia MWPS-18](https://dcr.am.virginia.gov/soil-and-water/document/manure-characteristics-mwps-18-1.pdf)
- **Coefficient of inbreeding:**
  - Each path through a common ancestor contributes (½)^n, multiplied by (1 + the ancestor's own COI), where n is the number of animals in the path. Offspring of first cousins come to 6.25%.
  - A shallow pedigree truncates paths and makes COI read low.
  - No regulatory threshold exists. Limits are breed-registry conventions, so make it a setting.
  - [ICB explainer](https://icbblog.org/?p=1094)
  - [Bloodlines COI](https://www.bloodlines.net/highflyer/coefficient.htm)
- **Heritability examples** (vary by population, so cite per trait):
  - dairy goat milk yield about 0.18–0.32 in one study and 0.04–0.39 in another
  - rabbit litter size at birth about 0.05
  - rabbit milk yield about 0.08–0.22
  - Chicken egg-production heritability still needs a source.
  - [J. Dairy Research](https://journalofdairyresearch.org/erduran-2017.html)
  - [Rabbit milk yield](https://www.revista.ccba.uady.mx/ojs/index.php/TSA/article/view/519)
  - [NZW rabbits](https://journals.ekb.eg/article_114314.html)
- **How conservative to be on inbreeding:**
  - Guidance commonly calls under 5% COI the safest range, while 6.25% is the livestock rule of thumb. Some software warns at 12.5%. Zoos accept up to 10% only for small endangered populations.
  - At population level, FAO recommends an effective population of at least 50, keeping inbreeding below 1% per generation.
  - Inbreeding depression lowers reproduction and lamb survival in published livestock studies.
  - [Redwattle COI](https://redwattle.com/inbreeding.php)
  - [Calendar-UK](https://www.calendar-uk.co.uk/frequently-asked-questions/what-level-of-inbreeding-is-safe)
  - [JNCC (FAO Ne 50)](https://hub.jncc.gov.uk/our-work/ukbi-animal-genetic-resources)
  - [Farmbrite COI](https://help.farmbrite.com/help/coefficient-of-inbreeding)
  - [Iranian dairy study](https://doaj.org/article/f2c8af353d144ed997ef51a082305b99)
- **Photo compression:** `expo-image-manipulator` offers resize, rotate and crop, and saves with a `compress` quality and a `format`. Confirm WebP support in the SDK 55 types.
  - [Expo ImageManipulator v55](https://docs.expo.dev/versions/v55.0.0/sdk/imagemanipulator)
- **Affiliate programs:**
  - [Chewy](https://auth.chewy.com/app/content/affiliate)
  - [Tractor Supply](https://www.tractorsupply.com/policies-information_affiliate-program)
  - [Lehman's](https://www.lehmans.com/pages/affiliate)
  - [True Leaf Market](https://trueleafmarket.com/pages/affiliate-program-trueleafmarket)
  - [Botanical Interests](https://www.botanicalinterests.com/affiliate-program)
  - [Burpee on FlexOffers](https://www.flexoffers.com/affiliate-programs/burpee-gardening-affiliate-program)
  - [Hoss Tools listing](https://linkclicky.com/affiliate-program/hoss-tools/)
  - [Gardening programs roundup](https://brandid.app/blog/gardening-affiliate-programs/)
  - [Amazon Associates help](https://affiliate-program.amazon.com/help/node/topic/GHBY6W8UPTEFD3ZX)
  - [Baker Creek: no affiliate marketing](https://www.rareseeds.com/media_relations)
- **FTC disclosure:** the 2023 Endorsement Guides define "clear and conspicuous" as difficult to miss and easily understandable, and place disclosures close to the recommendation.
  - [Manatt summary](https://manatt.com/insights/newsletters/advertising-law/an-in-depth-look-at-the-ftcs-updates-2)
  - [Gordon Law](https://gordonlaw.com/learn/ftc-endorsement-guidelines/)
- **Ads and health data:** Google treats health as a sensitive interest category for personalised ads, so never target ads using animal health records. Contextual placement on topic screens is the safe pattern.
  - [Google Ads: health in personalised advertising](https://support.google.com/adspolicy/answer/16701855?hl=en)
- **Affiliate:** Chewy's own page lists 4% on new and existing customer orders through Impact. Third-party pages also mention a flat $15 per new customer. Confirm the terms before building.
  - [Chewy affiliate](https://auth.chewy.com/app/content/affiliate)
  - [Partnerize overview](https://partnerize.com/resources/blog/chewy-affiliate-program-spotlight-and-sign-up-information)
- **What livestock apps commonly offer:** gestation and incubation due-date alerts, one-tap daily egg counts with charts, per-animal health and pedigree records, and offline entry with sync. These are good models for the records screens.
  - [FarmKeep](https://www.farmkeep.com/features/livestock-software)
  - [FlockFriend](https://apps.apple.com/us/app/-/id6745474579)
- **Already in the repository:** `packages/data/knowledge/homestead.json` has sourced profiles (UMN, Penn State, UMD, MSU, UF/IFAS and others) for laying hens, meat chickens, layer ducks, meat rabbits, dairy and meat goats, sheep, feeder pigs, honeybees and turkeys. It covers space, feed, water, production, labor, costs, regulation, predators and welfare. Start from these values.
