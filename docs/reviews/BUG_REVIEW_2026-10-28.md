# Plotwright bug review, 2026-10-28

Run from `docs/prompts/BUG_REVIEW_PROMPT.md` on main at `8cad41e` (0.2.5, version code 8). Report only: no app code was changed.

## Summary

**24 findings:** 1 critical, 2 high, 9 medium, 12 low.

Most important, in plain words:

1. On Android nothing is backed up: a new phone or a reinstall loses every property, design and animal health record (B-01).
2. Heat-stress alerts never fire for guardian dogs, alpacas, llamas, ducks and five more animals, including heat-sensitive ones (B-02).
3. The live app uses Google's sample AdMob IDs and has no ad units, so the free plan shows no ads and earns nothing (B-03).
4. Safety alerts are off by default, and the only switch is in Settings (B-04).
5. Health reminders keep coming for animals that were sold or have died, and for groups that were removed (B-05, B-06).

Baseline checks: `pnpm check`: 332 tests pass, 0 fail; zero-cost gate passes. `npx tsc --noEmit` in apps/mobile: clean.

## Findings

Sorted most severe first. Severity: Critical = data loss, safety or privacy harm, money taken wrongly; High = wrong advice or a broken feature; Medium; Low = polish.

### B-01 Android users have no backup at all

- **Severity:** Critical · **Area:** Data and backup · **Confidence:** Confirmed
- **Where:** `modules/user-sync/android/src/main/java/app/plotwright/usersync/UserSyncModule.kt:10`, `modules/user-sync/android/src/main/java/app/plotwright/usersync/UserSyncModule.kt:27`, `merged manifest: secure_store_backup_rules.xml, secure_store_data_extraction_rules.xml`, `apps/mobile/app/settings.tsx:216`

**What happens.** Google Drive sync is a stub that always reports unavailable. Android's own Auto Backup uses rules from expo-secure-store that include only app preferences, so the database (properties, designs, plantings, animal health and vaccination records) and animal photos are left out of both cloud backup and phone-to-phone transfer. There is no full export and restore either, only CSV exports of records.

**Who is exposed.** Every Android user. A new phone, a factory reset or an uninstall loses everything, including animal health and vaccination history. The Settings privacy card says data stays "on this phone and in your own cloud account", which isn't true on Android today.

**Evidence.** Read the module source (isAvailable returns false) and the merged backup XML from the 0.2.5 build: only <include domain="sharedpref">.

**Suggested fix.** Add the database and the animal-photos folder to the Auto Backup and device-transfer rules (free, uses the user's own Google account backup). Then add a full JSON export and import, and correct the Settings wording until Drive sync ships.

**Status: Fixed** (bad5054). Android backup and phone transfer now include the database and animal photos; Settings has Back up to a file and Restore from a file; the device ID moved to secure storage; the privacy wording is corrected.

### B-02 No heat-stress alerts for guardian dogs, alpacas, llamas, ducks and four more

- **Severity:** High · **Area:** Animal safety alerts · **Confidence:** Confirmed
- **Where:** `packages/core/src/livestock/alerts.ts:44`, `packages/core/src/livestock/safetyDefaults.ts:36`, `packages/core/src/livestock/working.ts:34`, `packages/core/src/livestock/working.ts:72`, `packages/core/src/livestock/working.ts:88`, `packages/core/src/livestock/poultry.ts:112`

**What happens.** Heat alerts fire only when a species has a numeric onset (air temperature, temperature plus humidity, or THI). Nine library animals have none: guardian dogs, alpacas, llamas, guardian donkeys, ducks, geese, guinea fowl, honeybees and barn cats. Guardian dogs, llamas and alpacas are even marked as low heat tolerance, yet never trigger an alert.

**Who is exposed.** Animals that are heat-sensitive go without the free safety alert the app promises. Your own Dahlia gets no heat alert. Camelids and heavy-coated dogs can die of heat stress.

**Evidence.** Test run: livestockAlerts at 104 °F and 60% humidity gave 0 heat alerts for guardian_dog, alpacas, guardian_llama and ducks_layers, and 1 each for laying_hens and dairy_goats.

**Suggested fix.** Follow the conservative-defaults rule: when tolerance is 'low' (or there's no sourced onset), use a protective fallback such as the widely cited temperature-plus-humidity 120 rule already used for horses, and say so in the alert.

**Status: Fixed** (0f59b42). Animals with no sourced heat figure use a cautious temperature + humidity limit by tolerance (120 / 130 / 150).

### B-03 The live app uses Google's sample AdMob IDs and has no ad units

- **Severity:** High · **Area:** Ads and revenue · **Confidence:** Confirmed
- **Where:** `apps/mobile/app.json:84`, `apps/mobile/app.json:85`, `apps/mobile/src/config.ts:20`

**What happens.** app.json still has Google's sample AdMob app IDs (ca-app-pub-3940256099942544~…), and every ad unit in ADMOB_UNITS is null. Release builds therefore show no ads, while the ads SDK still starts, gathers consent and declares the advertising ID.

**Who is exposed.** The free plan earns nothing. Shipping the sample app ID in production is against AdMob guidance. The store and Data Safety declarations say the app has ads.

**Evidence.** Read app.json and config.ts. AdMobProvider.unitId returns null outside debug builds.

**Suggested fix.** Create the AdMob app and units in your own AdMob account, put the real app ID in app.json and the unit IDs in config.ts, and rebuild. If ads should stay off for now, remove the SDK and update the Play declarations instead.

**Status: Partly fixed** (28b3877). App side done: with no ad units the ads SDK no longer starts. Still needs your own AdMob app ID and unit IDs to show ads.

### B-04 Frost, heat and animal alerts are off by default and only switchable in Settings

- **Severity:** Medium · **Area:** Animal safety alerts · **Confidence:** Confirmed
- **Where:** `apps/mobile/app/settings.tsx:150`, `apps/mobile/src/services/alerts.ts:189`, `apps/mobile/src/services/alerts.ts:225`

**What happens.** Weather alerts, animal heat and freeze alerts, and the housing-sensor checks (commented in the code as 'free and on by default') all sit behind one Settings switch that starts off. Nothing suggests turning them on when crops are planted or animals are placed.

**Who is exposed.** Most users never get the free safety alerts. The safety principle says warnings belong at the point of use.

**Evidence.** setAlertsEnabled is only called from Settings. runCheck and checkThresholdsNow return early unless alerts are enabled.

**Suggested fix.** Offer to turn alerts on the first time animals are placed or a crop is marked planted, and on the calendar screen. Let housing-sensor checks run without the switch, as the comment intends.

**Status: Fixed** (8d06078). A Turn on free alerts card on Home, the calendar and housing; housing-sensor checks run whenever notifications are allowed.

### B-05 Health reminders keep coming for animals that were sold or have died

- **Severity:** Medium · **Area:** Records and reminders · **Confidence:** Confirmed
- **Where:** `packages/core/src/livestock/records.ts:172`, `apps/mobile/src/services/healthReminders.ts:53`, `apps/mobile/app/records/index.tsx:55`, `apps/mobile/src/services/agenda.ts:74`

**What happens.** healthDue never checks the animal's status, so a vaccination due for an animal marked sold, retired or deceased still raises a notification, a Health dates entry and a calendar item.

**Who is exposed.** Upsetting after a death ("Dahlia: rabies due"), and noise that trains people to ignore real reminders.

**Evidence.** Code read: no status filter in healthDue or in any of its three callers.

**Suggested fix.** Drop records whose animal (or herd) isn't active before computing due dates.

**Status: Fixed** (f9acfc9). Due dates count only animals still active and groups that still exist; reminders refresh when a status changes.

### B-06 Removing a group leaves its health records live, so its reminders continue

- **Severity:** Medium · **Area:** Records and reminders · **Confidence:** Confirmed
- **Where:** `apps/mobile/src/db/herds.ts:74`, `apps/mobile/app/design/[id].tsx:619`, `apps/mobile/app/housing/[id].tsx:86`, `apps/mobile/app/records/index.tsx:150`

**What happens.** deleteHerd only marks the herd deleted. Health records attached to the herd (herdId) stay, so reminders and the agenda keep showing dues for a group that no longer exists. The dialog says individual animals' records stay, but the herd's records stay too.

**Who is exposed.** Reminders for animals that are gone, with no way to clear them except deleting each record.

**Evidence.** Code read of deleteHerd and its three callers.

**Suggested fix.** When a group is removed, delete or archive its herd-level health records too (or ask), and refresh reminders.

**Status: Fixed** (f9acfc9). Removed groups stop raising reminders; reminders refresh on removal.

### B-07 The 'hard cold, bring them into shelter' alert can never fire

- **Severity:** Medium · **Area:** Animal safety alerts · **Confidence:** Confirmed
- **Where:** `packages/core/src/livestock/alerts.ts:58`

**What happens.** The cold alert needs cold.safeMinF, and no species in the library has one. Only the freezing-water alert fires. Animals marked low cold tolerance (donkeys, guinea fowl, quail) get no cold warning.

**Who is exposed.** No shelter advice on dangerous nights, for the animals the data itself flags as cold-sensitive.

**Evidence.** Test run: a 5 °F night for guardian_donkey produced only 'freeze-water'. A script listing species found no safeMinF anywhere.

**Suggested fix.** Add sourced minimums where they exist, and a protective fallback for 'low' tolerance (for example a hard-freeze or wind-chill threshold).

**Status: Fixed** (0f59b42). Hard-cold alerts use a fallback minimum by cold tolerance (20 / 10 / 0 °F).

### B-08 Toxic-plant warnings appear only on the plant's own page

- **Severity:** Medium · **Area:** Plant and animal safety · **Confidence:** Confirmed
- **Where:** `packages/core/src/safety/toxicity.ts`, `apps/mobile/app/plants/[plantId].tsx:167`

**What happens.** The toxicity data (ASPCA lists and extension guides) is shown only in the plant library. Nothing warns when a toxic planting or tree is inside or next to a paddock or housing, or when animals are placed near one. Examples: avocado near poultry or goats, Prunus or black walnut near horses, grapes or alliums near a dog run. The planner itself puts an orchard next to goat pasture.

**Who is exposed.** Animal poisoning, the kind of harm the safety review was meant to prevent, with the warning hidden away from where decisions are made.

**Evidence.** toxicityFor is referenced only in plants/[plantId].tsx.

**Suggested fix.** Add a proximity check (like the well-buffer one) that pairs toxic plantings with nearby housing for the eaters listed, shown as a short caution on the design and housing screens.

**Status: Fixed** (dafed76). Design shows a caution on both objects when a toxic planting is within 10 m of the animals housed nearby.

### B-09 'Watch an ad to unlock' always says no ad is available

- **Severity:** Medium · **Area:** Ads and revenue · **Confidence:** Confirmed
- **Where:** `apps/mobile/app/paywall.tsx:166`, `apps/mobile/src/ads/provider.ts:122`

**What happens.** The paywall offers a rewarded ad for one-day unlocks, but with no rewarded unit configured showRewarded returns 'unavailable' every time.

**Who is exposed.** Free users meet a button that never works. Caused by B-03.

**Evidence.** Code read: unitId('rewarded') is null in release, so showRewarded returns 'unavailable' immediately.

**Suggested fix.** Hide the card when no rewarded unit is configured. It works once B-03 is fixed.

**Status: Fixed** (28b3877). The Watch an ad card stays hidden until rewarded ads are set up.

### B-10 Deleting a property leaves its animal photos on the phone

- **Severity:** Medium · **Area:** Privacy · **Confidence:** Confirmed
- **Where:** `apps/mobile/src/db/parcels.ts:103`, `apps/mobile/src/db/herds.ts:89`, `apps/mobile/src/db/records.ts:80`

**What happens.** Deleting a property marks its herds and animal records deleted, but never removes their full-size photo files from Documents/animal-photos. The deletes also aren't wrapped in a transaction, so a failure partway leaves some rows behind.

**Who is exposed.** Photos people expect to be gone stay on the device and keep using storage. Only 'Delete all my data' or 'Free up space' removes them.

**Evidence.** Code read: deletePhotoFiles is called when a single group or animal is removed, but not on the property-delete path.

**Suggested fix.** Collect herd and animal photos before deleting a property and remove their files. Run the row deletes in one transaction.

**Status: Fixed** (f9acfc9). Property delete removes its photo files and runs in one transaction.

### B-11 Raw parcel responses are cached before owner fields are stripped

- **Severity:** Medium · **Area:** Privacy · **Confidence:** Likely
- **Where:** `packages/providers/src/http.ts:185`, `packages/providers/src/parcel/arcgis.ts:114`, `apps/mobile/src/db/database.ts:339`

**What happens.** Parcel queries ask only for ID and acreage fields, and sanitizeAttributes strips anything that looks like owner data, but only from the object handed back. The HTTP client caches the raw JSON in SQLite first. If a county server ignores outFields and returns owner names or mailing addresses, they're written to the device cache.

**Who is exposed.** Owner names and addresses could be stored on the device, against a stated non-negotiable. Low likelihood, but the second line of defence doesn't cover the cache.

**Evidence.** Code read: http.json caches the body before the caller sanitises it. The parcel call passes ttlMs: TTL.parcel.

**Suggested fix.** Pass an accept or transform hook that strips attributes before caching, or don't cache parcel query responses.

**Status: Fixed** (7c4b697). Parcel responses are stripped to ID and acreage before caching; tested.

### B-12 Crops from later-phase projects are planned for this year

- **Severity:** Medium · **Area:** Planner · **Confidence:** Likely
- **Where:** `apps/mobile/src/services/planner.ts:241`

**What happens.** When a planner draft is approved, its plantings always get the current year, even for projects the timeline puts in Year 1 or Years 2–5 (the orchard, for example).

**Who is exposed.** The calendar shows sowing and planting tasks now for things the plan schedules for later, which makes the plan contradict itself.

**Evidence.** Code read: year = new Date().getFullYear() for every approved draft. Not reproduced on the phone.

**Suggested fix.** Use the project's phase start year for its plantings, or keep them unscheduled until the project starts.

**Status: Fixed** (71f169a). Draft crops are planned for their phase year.

### B-13 Deleting a property doesn't cancel its scheduled reminders

- **Severity:** Low · **Area:** Records and reminders · **Confidence:** Confirmed
- **Where:** `apps/mobile/app/profile/[id].tsx:227`, `apps/mobile/app/_layout.tsx:68`

**What happens.** After a property is deleted, its health and calendar notifications stay scheduled until the app next starts from cold.

**Who is exposed.** Reminders for a deleted property.

**Evidence.** Code read: no refreshHealthReminders or refreshEventReminders call after deleteParcel.

**Suggested fix.** Refresh both reminder sets after a property is deleted.

**Status: Fixed** (f9acfc9). Reminders refresh after a property is deleted.

### B-14 A reminder saved during a refresh can be missed until the next launch

- **Severity:** Low · **Area:** Records and reminders · **Confidence:** Likely
- **Where:** `apps/mobile/src/services/healthReminders.ts:46`, `apps/mobile/src/services/eventReminders.ts:24`

**What happens.** Refreshes are coalesced (running ??= …). A call made while one is in flight, such as saving a record right after launch, gets the stale run, so the new reminder isn't scheduled.

**Who is exposed.** An occasional missing reminder.

**Evidence.** Code read.

**Suggested fix.** If a refresh is requested while one is running, run once more after it finishes.

**Status: Fixed** (f9acfc9). A refresh requested during one runs again afterwards.

### B-15 In leap years, dates after February show one day early

- **Severity:** Low · **Area:** Calendar · **Confidence:** Confirmed
- **Where:** `packages/core/src/climate/normals.ts:47`, `packages/core/src/calendar/agenda.ts:45`

**What happens.** Day-of-year is counted on a non-leap calendar but turned back into dates with the real calendar, so in 2028 every frost and planting date after Feb 28 is a day early.

**Who is exposed.** Small, but frost dates drive planting advice.

**Evidence.** Test run: 04/15 → day 105 → 2027-04-15, but 2028-04-14.

**Suggested fix.** Convert with a fixed non-leap mapping (the same table used to parse), then build the date for the target year.

**Status: Fixed** (fce8968, 1287c85). Dates map back through the same 365-day table; tested for 2028.

### B-16 The metric setting is ignored on several screens

- **Severity:** Low · **Area:** Units · **Confidence:** Confirmed
- **Where:** `apps/mobile/app/animals/[animalId].tsx:52`, `apps/mobile/app/animals/index.tsx:69`, `apps/mobile/app/animals/edit.tsx:104`, `apps/mobile/app/plants/[plantId].tsx:101`, `apps/mobile/app/calendar/[id].tsx:241`, `apps/mobile/src/components/planner.tsx:221`, `apps/mobile/src/services/alerts.ts:246`

**What happens.** Animal pages (sq ft, acres, gal/day, lb, °F), plant germination temperatures, calendar heat units, planner storage weights and sensor alert notifications are always shown in imperial units.

**Who is exposed.** Metric users get mixed units.

**Evidence.** Code read: hard-coded unit strings without the units setting.

**Suggested fix.** Route these through the existing format helpers.

**Status: Fixed** (e3c6347). Metric applies to animal pages, germination, calendar, planner and all alerts. Entry forms for custom plants and animals still take US units, as labelled.

### B-17 Planner drafts can straddle the property line

- **Severity:** Low · **Area:** Planner · **Confidence:** Confirmed
- **Where:** `apps/mobile/src/services/planner.ts:201`

**What happens.** Placement only checks that an object's centre is inside the parcel, so a large paddock, orchard row or fence can extend over the boundary or a road. When space runs out, fewer objects are placed, and that is reported only in the unplaced list.

**Who is exposed.** Plans that put fences or animals on a neighbour's land.

**Evidence.** Code read.

**Suggested fix.** Require every footprint corner to be inside the parcel, with a small setback.

**Status: Fixed** (71f169a). Every corner of a placed object must be on the property.

### B-18 A planner approval that fails partway can't be retried

- **Severity:** Low · **Area:** Planner · **Confidence:** Likely
- **Where:** `apps/mobile/src/services/planner.ts:235`

**What happens.** The draft is marked approved before any changes are applied. If anything throws midway, it stays 'already handled' with partial or no changes. Plantings are saved before the design, so a failed design save leaves orphans. 'Remove' changes leave that object's plantings and herds behind.

**Who is exposed.** Rare, but a stuck draft and leftover rows.

**Evidence.** Code read.

**Suggested fix.** Mark the draft approved only after the design saves, and remove dependants of removed objects.

**Status: Fixed** (71f169a). Drafts are marked approved only after everything saves; removed objects take their plantings and animals.

### B-19 The planner can go past the free plan's 100-object limit

- **Severity:** Low · **Area:** Plans and limits · **Confidence:** Confirmed
- **Where:** `apps/mobile/src/services/planner.ts:232`, `apps/mobile/app/design/[id].tsx:225`

**What happens.** The object limit is checked only when objects are added by hand on the design screen. Approving planner drafts adds objects with no limit check.

**Who is exposed.** A small leak in the paid tiers.

**Evidence.** Code read.

**Suggested fix.** Check the limit in applyDesignDraft and report what didn't fit.

**Status: Fixed** (71f169a). Placement stops at the plan limit and says so.

### B-20 The access code's 90-day limit is soft

- **Severity:** Low · **Area:** Plans and limits · **Confidence:** Confirmed
- **Where:** `apps/mobile/src/billing/entitlements.ts:47`, `packages/core/src/accessCode.ts`

**What happens.** Expiry is checked only when entitlements are re-resolved (launch, store events), so an app left open stays unlocked past 90 days. Moving the device clock back extends it, and anyone with the code can enter it again after it expires.

**Who is exposed.** If the code leaks, the only fix is shipping a new fingerprint.

**Evidence.** Code read.

**Suggested fix.** Accept as designed, or re-resolve on app focus and allow one redemption per install.

**Status: Fixed** (d63da12). Unlocks are re-checked when the app returns and can’t be stretched by setting the clock back.

### B-21 When sync arrives, edits on two devices will overwrite each other

- **Severity:** Low · **Area:** Sync · **Confidence:** Confirmed
- **Where:** `packages/core/src/sync.ts:107`

**What happens.** Sync is last-writer-wins per record, and a whole design is one record. Editing the design on two devices between syncs drops one device's changes. This affects iOS today and Android once Drive sync ships.

**Who is exposed.** Silent loss of map edits for people with two devices.

**Evidence.** Code read of mergeRecord and how designs are stored.

**Suggested fix.** Merge designs per object (each object carries its own stamp), or warn when two devices have edited the same design.

**Status: Fixed** (4f7f5b8). Designs merge object by object across devices; tested.

### B-22 The app reports version 0.1.0 to the weather services

- **Severity:** Low · **Area:** Build and release · **Confidence:** Confirmed
- **Where:** `apps/mobile/src/config.ts:5`

**What happens.** APP_VERSION is hard-coded '0.1.0' and goes into the User-Agent sent to NWS and Nominatim. The app is 0.2.5.

**Who is exposed.** Confusing if NWS or Nominatim ever contact you about traffic.

**Evidence.** Code read.

**Suggested fix.** Read the version from expo-constants.

**Status: Fixed** (77cda06). The version comes from app.json.

### B-23 Contour chips lack a selected state, and month chips use 9 pt text

- **Severity:** Low · **Area:** Accessibility · **Confidence:** Confirmed
- **Where:** `apps/mobile/app/design/[id].tsx:706`, `apps/mobile/src/components/calendar.tsx:170`

**What happens.** The contour-interval chips have no accessibilityRole or selected state, so screen readers can't tell which is chosen. Calendar month-grid chips use 9 pt text.

**Who is exposed.** Harder to use with a screen reader or large text.

**Evidence.** Code read.

**Suggested fix.** Use the shared Chip component; raise the minimum font size.

**Status: Fixed** (77cda06). The contour chips have a role and selected state; calendar chips use 11 pt text.

### B-24 Bed AI suggestions use the most expensive Claude model

- **Severity:** Low · **Area:** AI · **Confidence:** Confirmed
- **Where:** `apps/mobile/src/services/bedAi.ts:15`

**What happens.** Ask AI sends a small structured request to claude-opus-5-5 on the user's own key.

**Who is exposed.** Users pay more per suggestion than needed.

**Evidence.** Code read.

**Suggested fix.** Use a smaller model for this JSON pick, or let the user choose.

**Status: Fixed** (77cda06). Bed AI uses claude-sonnet-5-5.

## Suspected, not confirmed

- The berry row in the demo modelled 1.9 hours of sun in what looked like open ground. It sits by a tree line, so it's plausible, but sun hours next to canopy edges deserve a field check against a sensor.
- Potato and other nightshade greens aren't in the toxicity table. That may simply follow the cited ASPCA lists; worth checking against the sources.
- When a property lookup returns no parcel that contains the point, the nearest or smallest parcel is pre-selected with 'Is this your land?'. That's correct behaviour if people read the map, but easy to accept by mistake.

## Checked and found clean

- Delete all my data: wipes every SQLite table, keychain secrets, photos, offline packs, scheduled reminders and metrics consent, and defers the cloud wipe when offline.
- Database upgrades: each migration runs in its own transaction and bumps user_version.
- Station and AI keys: kept in the keychain, sent with ttlMs 0 so never cached, and error messages show the host only, never the URL with keys.
- Paid features: every gate in TIER_FEATURES is checked where its feature is used (planner, exports, layers, sensors, Herd Book).
- Ads consent: the UMP consent form runs before the SDK initialises, ads only on the free plan, and never on design, records, health, Herd Book, housing or alert screens.
- Photo privacy: EXIF is stripped on re-encode, and a photo that still has EXIF is refused.
- Bed AI answers are validated against the bed's ranked candidates before they're shown.
- Parcel requests ask only for ID and acreage fields, and lookups fail over endpoint by endpoint.
- Well-buffer and boundary proximity checks, and the heat-stress maths (THI, temperature plus humidity).
- Sync clock: the HLC moves past every stored stamp at launch, and pulls are applied in causal and parent-first order.

## Limitations

- No device testing in this pass (the owner didn't ask for it). Everything is from reading code and running small test scripts.
- No iOS device, and no live purchase, restore or subscription-expiry test.
- Sun, shade and solar-position maths, BLE sensor parsing, Herd Book breeding and CSV import were checked through their existing tests rather than re-derived.
- Plant and animal data were spot-checked, not compared entry by entry against every cited source.

## Outcome

The owner asked for every finding to be fixed. All 24 are fixed on the `review-fixes` branch; B-03 still needs the owner's own AdMob app and unit IDs before ads can show.
