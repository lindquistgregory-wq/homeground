# Phase 5 report: AI Homestead Planner

**Date:** 2026-09-29 · **Branch:** `phase-5` (stacked on `phase-4`) · **Status:** code complete. As in earlier phases, the app, and now the Swift/Kotlin AI bridges, haven't been compiled on a device.

## What was built

| Plan item (§9) | Where | State |
|---|---|---|
| Free on-device AI | `modules/ondevice-llm` | Done. **Apple Foundation Models** (iOS 26+ with Apple Intelligence): tools are defined at runtime and each tool call runs in the shared TypeScript tools; weak-linked so iOS 17–25 still run. **Gemini Nano via ML Kit's Prompt API** (Android, beta): text generation plus model download. Private Cloud Compute is deliberately not used (it has quotas) |
| Rules-based planner for every other device | `packages/core/src/planner/plan.ts`, guided questions in the app | Done. Same interview and the same plan engine; on AI phones the model only talks and calls tools |
| Discovery interview | `interview.ts` | Done. Three questions at a time, essentials first (household, food goal, hours, budget, space), income questions only if wanted, then a summary to confirm |
| Bundled knowledge base | `packages/data/knowledge/` | Done. See "Knowledge base" below |
| The ten §9.2 tools, plus `update_goals` and `make_plan` | `tools.ts` | Done. Flat arguments (small models handle them reliably), short results with sources, gated by tier |
| Orchestrator | `agent.ts` | Done. Details below the table |
| Phased plans | `plan.ts` | Done: Year 0 set-up → Year 1 garden, hens, bees, meat birds → Years 2–5 orchard, berries, perennial beds, larger livestock, high tunnel. Sized to the household's food target, space, time and budget; says what's a planning choice and what's sourced |
| Food self-sufficiency | `nutrition.ts`, `coverage.ts` | Done. Calories, protein, vitamins A and C, calcium, iron and fibre against the household's needs, for year 1 and once everything is mature, with what to store and how |
| Budgets (Pro) | `budget.ts` | Done. Sourced ranges; costs scale only where the source's unit allows, and whole-system budgets are shown for reference, never totalled |
| Income module (Pro) | `enterprises.ts` | Done. 12 small enterprises compared on land, labour, startup cost and market access, with regulatory flags and a "not financial or legal advice" note |
| Drafts, never direct edits | `drafts.ts`, `services/planner.ts`, Drafts tab | Done. Plan items and the model produce drafts; approving places objects near the right anchor (house, garden, parcel middle) without overlaps, and plans the chosen crops into the new beds (they appear in the calendar). Tasks go to a synced to-do list |
| Safety | `safety.ts` | Done. Pesticide mixing, veterinary, foraging and poisoning questions get a fixed, safe answer without reaching the model |
| Storage and sync | migration 5 | Goals and tasks sync; **the conversation, plans and drafts stay on the phone** |

The orchestrator (`agent.ts`) works like this:

- It calls tools natively on Apple, and through a JSON protocol on Gemini Nano, which has no production tool calling.
- It offers only the tools a turn needs (at most six) and keeps the prompt to about 2,000 tokens.
- It summarizes the conversation into the goals profile.
- It runs tool calls one at a time.
- It flags any figure in a reply that didn't come from the user, the profile or a tool.

Tiers follow §10:

- **Free:** guided interview, plus a basic plan covering years 0–1.
- **Grower:** chat with the on-device AI, design and task drafts.
- **Pro:** the income module, budgets and years 2–5. The `planner.multiYear` feature key was added for this.

## Knowledge base

| File | Contents | Source |
|---|---|---|
| `nutrition.json` | Nutrients per 100 g and edible portions for the plants and 13 animal products; calorie needs by age, sex and activity; nutrient targets | USDA FoodData Central SR Legacy (CC0); Dietary Guidelines 2020–2025; National Academies DRIs |
| `homestead.json` | 10 livestock, 12 enterprise, 10 infrastructure and 6 preservation profiles, as ranges | Land-grant extension (Penn State, UMN, UMD, Missouri, Cornell, Virginia Tech, Oregon State, UW, UF…), USDA NASS/ERS/NRCS, PASA/SARE, NCHFP. Every entry carries its URL and year; figures before 2016 are flagged, and so are prices before 2020; unknowns are `null`, never guessed |
| `consumption.json` | Pounds per person per year for 38 crops, used to stop plans proposing more than a household eats | USDA ERS Food Availability (mostly farm weight, not loss-adjusted; a few entries are from secondary sources and flagged) |

## Verification

- `pnpm check` passes: type-check, **213 tests**, and the zero-cost gate. New tests cover:
  - Knowledge-base completeness and ordering.
  - Needs against the published tables.
  - Coverage, budget scaling and enterprise fit.
  - The phased plan for varied households: vegan, no animals, poultry only, beginner, tiny lot, income.
  - Every plan draft validating against the object library.
  - Draft and task validation.
  - Argument parsers.
  - Prompt size.
  - Scripted stand-ins for both model types.
  - The unverified-number check.
  - Tier gates.
  - Safety sentences in both directions (must catch / must not catch).
- The planner screens and the JavaScript side of the AI module type-check against stubbed React Native and Expo types.
- **Independent review: 20 defects, all fixed.** The worst:
  - The model's partial updates reset hours, budget and space to 0.
  - Crops without consumption data grew to hundreds of pounds in big gardens.
  - Fruit trees were added regardless of household.
  - Whole-farm livestock budgets and chore times were applied to 5-bird batches.
  - A number flagged once could slip through on the next turn.
  - The safety filter both missed real risks ("Can I eat dandelions from my yard?") and blocked ordinary questions ("How much forage do goats need?").

  The reviewer's probe scripts were re-run after the fixes.

## Not verified (needs your machine)

1. **Native builds of `modules/ondevice-llm`.** Swift needs Xcode 26 (the iOS 26 SDK; the App Store has required it since April 2026). Kotlin pulls `com.google.mlkit:genai-prompt:1.0.0-beta4`. Two API details come from documentation only:
   - The Swift `DynamicGenerationSchema(name:description:anyOf:)` string-choices initializer.
   - The Kotlin `generateContentRequest { }` DSL.
2. **Real model behaviour.** The orchestrator is tested with scripted stand-ins. How well a ~3B on-device model follows the instructions, calls tools and keeps to the JSON protocol can only be judged on an iPhone 15 Pro / 16 or later, or a Pixel 9 / Galaxy S25 class phone.
3. **Draft placement on real parcels.** Objects land near their anchor without overlapping, and they're labelled "planner draft" so they can be moved. They aren't placed by sun yet.

## Known limitations and flags

- **Gemini Nano terms (Google ML Kit GenAI):**
  - Users must be 18+, and the app must not target minors.
  - Beta, with no SLA.
  - It only runs while the app is in the foreground.

  None of these conflict with a homestead planner, but the store listings should be 18+ or at least not directed at children.
- **Garden labour isn't estimated:** there's no reliable published figure for home gardens. Livestock chore time is shown only where the source's scale matches.
- **Consumption caps cover 38 crops.** ERS has no series for chard, beet, parsnip, leek, kale and similar crops, so those get a small, labelled allowance (one bed per three people).
- **Some livestock yields aren't counted:** rabbit, goat and sheep meat have no sourced dressed weight, so their food value is left out rather than guessed. Pork and goat figures that include bone are marked as upper bounds.
- **Livestock and enterprise figures** are extension ranges, some old (flagged); a few costs come from commercial cost guides (labelled).
- **Sync granularity:** goals sync as one record per property, so answers given on two devices at the same moment keep the later one. Pregnancy and breastfeeding answers sync to your own iCloud only.
- **Question 5 of the prompt's pre-build list (livestock and enterprise priorities) was never answered.** The knowledge base covers the enterprises named in §9.2 and ten common homestead animals; it's easy to extend.

## Zero-cost confirmation

- **On-device AI:** Apple Foundation Models and ML Kit GenAI are free, on-device, keyless and have no per-call cost. Private Cloud Compute is not used.
- **Data:** all bundled, from public-domain or cited sources. No new network hosts; the citation and documentation hosts are recorded as link-only.
- **New native dependencies:** `com.google.mlkit:genai-prompt` and `kotlinx-coroutines-android` (Apache-2.0). They're recorded under `nativeDependencies` in `licenses.json`.
- **No new npm packages.**

## Next: Phase 6 (monetization and polish)

AdMob with UMP consent and ATT, the paywall and trials, Pro features, offline parcel packs, consent-gated free analytics, and the §12 open-source/ads-only assessment with the revenue calculator.
