# Review prompt: find every bug in Plotwright

Copy everything below the line into a new Claude Code session opened at the repository root. It finds and reports problems; it does not fix them.

---

You are reviewing **Plotwright**, a React Native (Expo SDK 55) homestead-planning app that is now live on Google Play. Your job is to **find and report** bugs and issues in every feature, so the owner can decide what to fix. **Do not change app code.** You may write throwaway test scripts in your scratchpad and the report file described in section 6.

## 0. Read first

1. Read `CLAUDE.md`, `docs/PLAN.md`, the latest `docs/PHASE*_REPORT.md`, `docs/PRIVACY.md`, `docs/TERMS.md`, `docs/store/LISTING.md` and `DATA_SOURCES.md`.
2. The owner works in insurance. Rank findings by **exposure**: who could be harmed, how badly, how likely, and what it could cost them. The owner's safety principles are:
   - safety information is free;
   - defaults are conservative;
   - warnings are short and shown at the point of use.
3. Run `pnpm check` and `cd apps/mobile && npx tsc --noEmit` before anything else. Record the results.

## 1. Ground rules

- **Read-only on the app.** Never edit source, config, `app.json` or the generated `android/` folder. If a fix is obvious, describe it in the finding instead.
- **Evidence for every finding.** Each one needs a file and line, plus either a failing test you wrote in the scratchpad, a reproduction on the phone, or a clear explanation of the inputs that produce the wrong result. Leave out anything you couldn't verify, or list it under "Suspected, not confirmed".
- **No secrets.** Never read `~/.gradle/gradle.properties` or `D:\.gradle\gradle.properties`, which hold signing secrets. Never type API keys, passwords or real payment details anywhere.
- **Zero cost.** Don't call paid APIs. Don't use the owner's Claude key: test AI paths with mocks or by reading code.

## 2. On-device testing (optional, only when the owner says the phone is connected)

- Use the guarded helper in your scratchpad, or write one. Before every tap, check that `app.plotwright.planner` has focus. Never tap the system bars. Never press Back to leave the app.
- **Never change the owner's own property ("My homestead") or its animals and records.** Create a separate demo property for anything that writes data, for example 4301 Lake Wheeler Rd, Raleigh NC, and delete it when you finish.
- Don't grant permissions, operate the camera or photo picker, or start purchases. If the phone shows a permission dialog, stop and ask the owner.
- Stop at once if the owner says they need the phone.
- **Release builds:** if you build one, first delete `apps/mobile/android/app/build/generated/assets/react/release`. Otherwise changes made only under `packages/*` are silently left out of the bundle.

## 3. Coverage checklist (go through every item)

For each screen, read the route file and the services and core modules it uses. Then test the happy path, empty states, errors, offline behaviour, and switching property while things are loading.

| Area | Screens (`apps/mobile/app/...`) | Logic to check |
|---|---|---|
| Onboarding and finding a property | `locate.tsx`, `boundary.tsx`, `index.tsx` (no-property state) | `providers/geocode`, `providers/parcel/*` (owner names and addresses must never be stored: `sanitizeAttributes`), `core/boundary` |
| Home | `index.tsx`, `src/components/HomeHomestead.tsx`, `HomeMap.tsx` | property switching, zoom and pan with page scroll, animal sprites, daily brief, Coming up, `homeSummary`, `dailyBrief` |
| Site profile | `profile/[id].tsx` | `providers/siteProfile`, `soils`, `climate`, `hardiness`, `hazards`, `elevation`, provenance on every number, delete property (does it remove all related rows?) |
| Design | `design/[id].tsx` | placing, moving and resizing objects, drawing, existing buildings, layers, imagery choice and zoom limits, badges, undo, object limits per plan |
| Sun | `sun/[id].tsx`, Design's Sun tab | `core/sun` (shade, solar position, canopy), `sunCalibration` |
| Beds and garden | `garden/[id].tsx`, `src/components/bedContents.tsx` | `core/plants` (suitability, setup, bedGrid, layout, rotation, yield), suggestions waiting for sun, `bedAi` |
| Plants | `plants/*` | library, search, custom plants (`customPlants`), data integrity in `core/plants/*` |
| Planner | `planner/[id].tsx`, `src/components/planner.tsx` | `core/planner`, `services/planner` (drafts, placement, approving, projects timeline, progress), AI fallback |
| Calendar and reminders | `calendar/[id].tsx` | `core/calendar`, `agenda`, `eventReminders`, `healthReminders`, frost-date maths, time zones, recurring sowings |
| Animals | `animals/*`, `housing/[id].tsx` | `core/livestock` (fit score, space, heat and cold thresholds, toxic plants), `customAnimals`, housing assignment |
| Records and Herd Book | `records/*`, `herdbook/*` | health and vaccination records, production charts, sales and costs, photos (EXIF location stripped?), import and export (`recordsExport`), pedigree, `herdBookAi` |
| Sensors and weather | `sensors/*` | `ble`, `stations`, `core/sensors`, `sensorInsights`, Ecowitt local and cloud, keys kept in the keychain only |
| Alerts | (background) | `alerts`, `expo-background-task`, heat and frost alerts, urgency, quiet failures |
| Monetisation | `paywall.tsx`, `settings.tsx` | `core/entitlements`, `core/monetization`, `expo-iap` purchase, restore and expiry, access code (`core/accessCode`: expiry, hash only), ads only on the free plan, consent and personalised-ads default off |
| Settings, data and privacy | `settings.tsx`, `data-sources.tsx`, `disclosures.tsx` | export, backup and sync (`core/sync`, `export`), *Delete all my data*, units (`core/units`), secrets (`secrets.ts`) |
| Offline | (everywhere) | `offlinePacks`, `core/offline`; every screen with networking off |
| Database | `src/db/*` | migrations 1→16 on a fresh install and on upgrade, foreign keys and cascades, transactions |
| Android build | `app.json`, `plugins/*` | merged-manifest permissions (no duplicates, nothing unused), ProGuard keep rules, release signing, version codes |

## 4. What to look for

- **Crashes and native errors**, especially native calls on map views that have unmounted or not finished loading, and promises resolving after unmount.
- **Race conditions:** results computed before their inputs have loaded. One real example was a bed suggestion made before sun was modelled. Also look for state left over after switching property, and stale `useMemo` or `useFocusEffect` dependencies.
- **Wrong advice:** scores that average away a dealbreaker (for example sun, frost, heat or toxicity), unit mix-ups (ft/m, °F/°C, lb/kg, sq ft/acre), off-by-one dates, wrong hemisphere or time zone, and text that contradicts the data, like the old "All heavy feeders" note. Check plant and animal data against the sources cited in it.
- **Safety:** toxic plants near animals, livestock heat stress, 811 before digging, food safety, vet disclaimers. Is every safety warning free and shown where it matters?
- **Data loss:** deletes that don't cascade or that cascade too far, failed migrations, export and import round trips, backup restore, unsaved edits lost on navigation.
- **Privacy:** parcel owner names or addresses stored anywhere, EXIF location kept in photos, user data sent to a host not listed in `sources.ts`, secrets logged or exported, and whether the privacy policy matches what the code actually does.
- **Money:** a paid feature reachable for free (other than the access code), a paid user blocked from features or still seeing ads, ads shown before consent where it's required, restore failures, an expired access code still working.
- **Zero cost:** any metered or paid call, and any dependency missing from `licenses.json`.
- **Accessibility and UX:** missing labels, touch targets under 44 dp, contrast in light and dark themes, text clipped at large font sizes, dead ends with no way back.
- **Performance:** slow screens on large properties or with many objects, and work repeated on every render.
- **Build and release:** anything Google Play could reject.

## 5. How to work

1. Make a task list from section 3 and go through it in order. Don't skip an area because it looks fine.
2. In each area:
   1. Read the code.
   2. Write small `tsx --test` scripts in your scratchpad for any pure logic you doubt.
   3. Check every place that calls the code you changed assumptions about.
   4. Then, if allowed, test on the device.
3. Keep a running findings list as you go, so nothing is lost if the context is summarised.
4. At the end, check each finding a second time and drop any you can't reproduce.

## 6. Report (submit to the owner for review)

Write `docs/reviews/BUG_REVIEW_<YYYY-MM-DD>.md`. Don't commit it until the owner says so. Then publish it as a private Artifact page so the owner can read and sort it. It should contain:

1. **Summary:** counts by severity, the five most important findings in plain words, and the results of the commands from 0.3.
2. **Findings**, sorted most severe first. For each one:
   - **ID and title**, e.g. `B-07 Shady beds offered full-sun crops`
   - **Severity:**
     - Critical: crash, data loss, safety or privacy harm, money taken wrongly;
     - High: wrong advice or a broken feature;
     - Medium;
     - Low or polish.
   - **Area** and **file:line**
   - **What happens**, and **who is exposed**
   - **Steps or inputs to reproduce**, and the evidence (test output, screenshot path, log)
   - **Suggested fix**, in a sentence or two, with no code changes made
   - **Confidence:** confirmed or likely
3. **Suspected, not confirmed:** leads you couldn't verify, and why.
4. **Areas checked and found clean**, so the owner knows what was covered.
5. **Limitations** of the review, such as no iOS device or no live purchase test.

End by asking the owner which findings to fix, and in what order. Fix nothing until they answer.
