# Livestock data: where it comes from and how far to trust it

## The bundled database

`packages/core/src/livestock/` holds 21 species: 8 poultry and waterfowl, 5 rabbits, goats and sheep, 3 pigs and cattle, honeybees, and 4 working or fiber animals (guardian dog, donkey and llama, plus alpacas). Each entry records:
- purposes and social needs (minimum group, whether a male is needed, whether it can live alone);
- heat and cold thresholds, with the index each uses;
- indoor, outdoor and pasture space, fencing, and which map objects can house it;
- feed and water, production, and processing (shown only when that setting is on);
- reproduction (gestation or incubation, breeding season, heritability, known mating risks);
- lifespan, labour, noise, costs, predators, diseases to know (names and prevention only), biosecurity;
- companions and animals to keep apart (with the reason), regulatory notes, breeds by climate, and sources.

The data follows the conventions of `packages/data/knowledge/homestead.json`:
- values are `[low, high]` ranges;
- `null` means no acceptable source was found, and nothing is guessed;
- every entry lists its sources with URL and year;
- figures from before 2016 are flagged with `oldData`.

Citations live in `sources.json`. Each source is tagged as extension, government or research (preferred), or industry or secondary. The app shows the tag, so a hatchery or magazine figure is never presented as an extension figure.

**Left out of version 1:** horses, bison, deer, aquaculture and exotic species.

## Licence position

The values are facts (space per bird, gestation days, temperature thresholds) written for this project from the cited extension, government and research sources. No text, tables or images were copied. Care guides are linked, not reproduced (`packages/data/extension/livestock-guides.json`). No third-party livestock database or API is used, so there's no licence to track and nothing to pay for.

## Safety rules applied to the data

- **Conservative thresholds.** Where sources give a range, health and safety decisions use the protective end:
  - poultry heat stress from 85 °F (UMN);
  - rabbits from 85 °F (Texas A&M);
  - finishing pigs from 70 °F (Penn State);
  - cattle from 72 °F at 50% humidity (UW-Madison), or THI 80 (Missouri via Nebraska);
  - sheep and goats from THI 82 (SDSU).
- **Heat index.** THI uses the NRC (1971) formula in its Fahrenheit form, THI = T − (0.55 − 0.0055·RH)(T − 58). That is the form behind the Fahrenheit THI bands used by [Texas A&M](https://animalscience.tamu.edu/wp-content/uploads/sites/4/2023/08/heatstress3.pdf) and Missouri. When a forecast has no humidity, alerts assume humid air (the summer average, never below 70%), because heat stress rises with humidity. All of this lives in `core/livestock/safetyDefaults.ts`.
- **No veterinary content.** Diseases are named for awareness and prevention only. There are no treatments, doses or vaccine schedules (tested).
- **Legal notes:**
  - CDC Salmonella guidance on every poultry and waterfowl species;
  - Scrapie ID on sheep and goats;
  - USDA poultry processing exemptions (shown only with processing details on);
  - raw-milk and apiary rules marked as state-dependent;
  - "check local code" on every species.
- **Compatibility:** sheep warn that goat and cattle minerals are toxic to them (copper, UMaine); llamas are kept singly as guardians (CDFA); donkeys are watched at lambing and kidding time (CDFA).

## Review

`livestock.test.ts` checks that:
- every species passes `validateAnimalSpec`, with ranges in order;
- housing objects exist on the design map, and sources are https;
- breeding species have a gestation or incubation period, and heritabilities are sourced and between 0 and 1;
- social species are never "fine alone";
- the CDC and Scrapie notes are present;
- no dosing language appears.

`scripts/livestock.test.ts` checks that every species has a care guide, and that the planner's 10 livestock profiles in `homestead.json` agree with the library on space, pasture, water, labour, feed and eggs, so the two can't drift (prompt §9).

## How far to trust it

These are typical ranges for small US homesteads, and breeds differ widely. Several figures are thinner than the plant data:
- **Hatchery or secondary sources:** goose space, quail space and laying, guinea run space, alpaca fleece and family-cow lactation length. Each is flagged in its source.
- **No source found (`null`):** many water figures, and heat onsets for ducks, geese and guineas.
- **Variation by source:** goose incubation (28–35 days) and sheep gestation (144–152 days) are recorded as ranges.

Local extension advice, a vet and your state agriculture department win over these figures.

## Herd Book figures (paid; `livestock/breeding.ts`)

- **Inbreeding (COI):** the tabular (kinship) method, which includes each common ancestor's own inbreeding. Hand-worked tests cover half sibs (12.5%), full sibs (25%), first cousins (6.25%) and an inbred common ancestor. Missing ancestors add nothing, so a shallow pedigree reads **low**; the app says so when fewer than 3 generations are mostly known.
- **Limit:** suggestions only below 5% by default. Users can lower it freely; raising it needs an acknowledgement and stops at 6.25%. The app calls it a precaution, not a guarantee.
- **Herd trend:** mean COI by generation; a rise of about 1% or more per generation is flagged (FAO guidance for an effective population of 50 or more).
- **Merit:** only where a heritability is sourced (dairy goat milk yield, rabbit litter size). It uses the **lower** cited heritability and treats repeatability as equal to it, so estimates lean toward zero. Each record is compared with contemporaries (species, sex, year and group). Shown as a range with a confidence word, never a precise score. Other species are ranked by inbreeding only.
- **Mating rules:** `matingRules` turn sourced `knownMatingRisks` into checks (two naturally polled goats are never suggested).

## Care guide links

| File | Contents | Checked |
|---|---|---|
| `packages/data/extension/livestock-guides.json` | One care guide per species, from Cooperative Extension or a government agency where available (FAO for geese, The Livestock Conservancy breed chart for dual-purpose chickens) | 2026-10-16: found by search and checked for an HTTP response. Two hosts block automated checks (Texas A&M, Mississippi State) but load in a browser |
