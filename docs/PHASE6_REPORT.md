# Phase 6 report: monetization and polish

**Date:** 2026-09-30 · **Branch:** `phase-6` (stacked on `phase-5`) · **Status:** code complete. This is the last phase in the plan. As before, nothing native has been compiled: the package registries are blocked in the build sandbox, so the new libraries are recorded in `package.json` but not installed, and the app is type-checked against stubs written from the libraries' current source.

## What was built

| Plan item (§10–§13) | Where | State |
|---|---|---|
| Store billing, direct | `apps/mobile/src/billing/adapter.ts` (expo-iap 5.8, MIT) | Done. See "Store billing" below |
| Entitlement logic in one module | `packages/core/src/monetization/store.ts`, `entitlements.ts` | Done. Pure and tested: grace periods, revocations, upgrades, pending purchases, the offline cache and Android plan changes |
| Paywall and trials | `apps/mobile/app/paywall.tsx`, `core/monetization/paywall.ts` | Done. See "Paywall" below |
| AdMob + UMP consent + ATT | `apps/mobile/src/ads/` (react-native-google-mobile-ads 16.5.0, Apache-2.0), `core/monetization/ads.ts` | Done. See "Ads" below |
| Rewarded ads | same | Done. Opt-in, from the paywall only; unlocks one of: sun heatmaps, canopy shade, advanced terrain, PDF export or GIS export, for 24 hours |
| Pro: offline parcel packs | `services/offlinePacks.ts`, `core/offline/tiles.ts`, Site Profile card | Done. See "Offline packs" below |
| Pro: multi-season scenarios | `core/design/scenarios.ts`, design screen → Plan tab | Done. See "Scenarios" below |
| Consent-gated analytics and crash reporting | `services/metrics.ts`, `core/monetization/analytics.ts`, Settings → Privacy | Done, **on the device only**. See "Analytics" below |
| §12 open-source / ads-only assessment | `docs/open-source-ad-model.md`, `docs/revenue-calculator.html`, `core/monetization/revenue.ts` | Done. See "§12 assessment" below |
| CWOP → NOAA MADIS | weather-station screen | Link card only; the app never relays data |
| Privacy policy, terms | `docs/PRIVACY.md`, `docs/TERMS.md` | Drafts for you to review; linked from the paywall and Settings |
| e2e (§11) | `apps/mobile/.maestro/` | Three Maestro flows (onboarding → profile → design → calendar; paywall; offline). **Written, not run** |

### Store billing

- iOS uses StoreKit 2. Only transactions that pass Apple's signed-JWS check reach the app.
- Android uses Play Billing Library 9, reading purchase state on the phone. Purchases are acknowledged within Play's 3-day window, including purchases made while the app was closed.
- There is no receipt server, no subscription SaaS, and expo-iap's hosted IAPKit option is not used.
- Changing plan on Android replaces the current subscription with the right proration mode, instead of starting a second subscription.
- Entitlements load instantly from an on-device cache, then refresh from the store. A new install restores from the store.
- Offline, access continues until each purchase's own expiry. On Android, where Play gives no expiry date on the phone, access continues for 14 days after the last successful check.

### Paywall

- Prices come from the store, localized. A plan with no store price isn't shown.
- **Homestead Pro annual is selected by default.**
- A store-managed free trial is shown when the store offers one to this user. Trials show in the store's own units ("14 days", "1 month").
- Also on the paywall:
  - the Apple 3.1.2 disclosure next to the buy button;
  - **Restore purchases**, **Manage subscription**, Terms of Use and Privacy Policy;
  - a tier comparison table.
- Buying Pro Lifetime while subscribed warns that the subscription must be cancelled.

### Ads

- **Placement:** banners only in the plant library and plant guides, never next to buttons.
- **Interstitials:**
  - at most one per session;
  - only after closing a plant guide, and no earlier than the second such break and 2 minutes into the session;
  - never in a session opened from a frost, heat or threshold alert, whether tapped at launch or while running;
  - never on leaving the calendar or sensor screens, which show alerts.
- **Consent:** the Google UMP form covers GDPR/TCF v2.3 and US state privacy, with an "Ad privacy choices" entry in Settings when required.
- **Personalization:** ads are **non-personalised unless the user opts in** in Settings. On iOS, opting in is the only time Apple's tracking prompt appears.
- **Other settings:** content rating PG; not tagged child-directed (a general-audience app).
- **Paid plans:** the ads SDK isn't started for paid plans.

### Offline packs

- Saves USGS aerial imagery for the parcel plus 250 m, at zoom 12–16. The pack is capped at 3,000 tiles and downloaded two at a time. It can be stopped and resumed.
- Also refreshes the Site Profile.
- Saved imagery sits under the live layer, so it shows wherever the network doesn't.
- Tiles live in the cache folder, which keeps them out of iCloud backups. If the phone clears them, the card offers to download again.
- The vector basemap relies on MapLibre's own cache, raised to 150 MB.

### Scenarios

- A scenario is a season-and-year copy of the plan ("Winter 2027", "Summer 2028"). It syncs like any design and leaves the main plan alone.
- Opening a scenario switches the sun analysis to that season. The panel compares the scenario with the main plan: objects added, removed and moved, and area by category.

### Analytics

- **Off by default.** Once turned on, the phone counts screens and features from an allowlist of events and values; no location, parcel, sensor or free text is recorded.
- Also keeps a scrubbed error log.
- The user can view, share or clear both. Nothing is ever sent.
- Crash reports otherwise come from Apple's and Google's own opt-in reports.

### §12 assessment

- **Licence comparison:** MPL-2.0 is recommended.
- Also covers F-Droid, trademark, donations, affiliate links, CWOP, and a recommendation by scale.
- **Calculator:** every rate is an input you enter. **No eCPM or conversion figure is invented.**

## Decisions made (please confirm)

1. **No Firebase.** Firebase Analytics and Crashlytics are free, but they need a project API key built into the app. CLAUDE.md forbids shared API keys, so analytics stay on the phone. If you'd rather make an exception for Firebase, it's a contained change: a second implementation of `track()` and `recordError()`.
2. **Ads are non-personalised by default** everywhere, not only where the law requires it (§11: "ad personalization only with consent"). This probably lowers eCPM. It's one default to flip in `useAds`.
3. **Offline packs save imagery only, not the OpenFreeMap vector tiles.** OpenFreeMap's terms prohibit "automated" collection without permission and don't mention offline use. If you email the maintainer (zsolt@openfreemap.org) and get permission, vector packs can be added with MapLibre's `OfflineManager`.
4. **Pricing uses the prompt's figures:** Grower $2.99/$24.99, Pro $9.99/$79.99, lifetime "about $199". Prices live only in App Store Connect and Play Console, never in code.
5. **§12 recommendation:** stay on subscription tiers now; revisit at about 10,000 monthly users with real AdMob and conversion data. The app already switches to the open-source model with one setting (`BUSINESS_MODEL`).

## Setup you'll need to do (free, one-time)

- **App Store Connect:**
  - Enrol in the Small Business Program.
  - Create the products `plotwright.grower.monthly`, `plotwright.grower.annual`, `plotwright.pro.monthly`, `plotwright.pro.annual` and `plotwright.pro.lifetime`, plus `plotwright.removeads` only for the open-source model.
  - **Put all four subscriptions in one subscription group**, with Pro ranked above Grower, so upgrades replace rather than stack.
  - Add a free-trial introductory offer (14–30 days) to Pro annual.
  - Turn on Billing Grace Period and Family Sharing for Pro.
- **Play Console:** create the same products, with one base plan each and a free-trial offer on Pro annual (eligibility: new customers).
- **AdMob:**
  - Create the app and ad units. Replace Google's sample app ids in `app.json` and fill in `ADMOB_UNITS` in `config.ts`; debug builds always use test ads.
  - In Privacy & messaging, create the GDPR and US state messages, and **don't enable the IDFA explainer message**.
- **App privacy labels / Data safety:**
  - Declare AdMob's collection (device identifiers, coarse location, usage and advertising data) for the free plan. Declare nothing for the analytics, since they stay on the phone.
  - Review `docs/PRIVACY.md` and `docs/TERMS.md` and publish them.
- **Optional:** GitHub Sponsors; a trademark filing if you go open source.

## Verification

- `pnpm check` passes: type-check, **236 tests** (23 new for Phase 6), and the zero-cost gate. The new tests cover:
  - Store records: verified and upgraded purchases, revocations, grace periods, Android pending and suspended purchases, the offline window, missing expiry dates, plan changes.
  - Paywall: plans, the default choice, savings, trial eligibility on each platform, trial wording, the disclosure.
  - Ads: banner screens, the interstitial cap and timing, the alert block, rewarded unlocks and their expiry.
  - Analytics: allowlist and scrubbing.
  - Revenue calculator: arithmetic and the document's break-even table.
  - Offline packs: tile math and the tile limit.
  - Scenarios: comparison and metadata.
  - Fail-open safety alerts.
- The app type-checks against stubs that follow the libraries' current source (expo-iap 5.8, react-native-google-mobile-ads 16.5, expo-file-system, MapLibre 11.4).
- **Independent review: 8 defects and 9 lower-confidence concerns.** All 8 and 8 of the 9 were fixed, and a second pass confirmed the fixes; it found one new timer race, now fixed too. The worst:
  - An Android upgrade would have billed both plans.
  - A failed store connection could leave the paywall stuck forever.
  - Greenhouse alerts would stop for a paying user who hadn't opened the app since renewal.
  - An interstitial could appear right after reading a frost alert.
  - Offline imagery paths broke after an iOS update.

## Not verified (needs your machine)

1. **Everything native:** a dev build on both platforms with the three new libraries.
   - expo-iap claims Expo SDK 53+ but is only validated upstream on SDK 57.
   - react-native-google-mobile-ads is pinned to 16.5.0, because 17.x needs React Native 0.86.
   - After the build, check `./gradlew :app:dependencies | grep billing` shows only Billing 9.x.
2. **Sandbox purchases:**
   - Trial, upgrade, downgrade, lifetime, restore on reinstall.
   - iOS grace period: whether expo-iap reports `isActive` false during it; the code handles both.
   - Ask to Buy.
   - The Android replacement fields `purchaseTokenAndroid` / `replacementModeAndroid` are from expo-iap's request types as researched; confirm them against the installed version.
3. **Ads:** consent form in EEA debug geography, banners, interstitial timing, rewarded unlocks, and the ATT prompt when opting in.
4. **Offline packs:** MapLibre reading `file://` tile templates from the cache folder, and what USGS returns for imagery.
5. **Maestro flows:** labels and tap positions will likely need adjusting on first run.

## Known limitations

- **Older app versions and scenarios:** a device still on a Phase 5 build treats a synced scenario as an ordinary design and can clear its season tag when it syncs back. Update all devices together.
- **Ask to Buy (iOS):** if the store reports a deferred purchase as an error, the paywall may say "nothing was charged" while approval is pending. The purchase still activates when approved.
- **Paid reinstalls:** the app waits up to 5 seconds for the store before starting ads, so on a very slow connection a paid user reinstalling might see the consent form once.
- **Plan changes:** downgrades are done in the store's subscription settings (Manage subscription), not on the paywall.
- **Store rules move:**
  - Apple's US link-out commission is still being decided in court (not used here).
  - Google's US fee structure changed on 30 June 2026.
  - Re-check `DATA_SOURCES.md` before release.

## Zero-cost confirmation

- **New npm packages:** `expo-iap` (MIT), `react-native-google-mobile-ads` (Apache-2.0) and `expo-tracking-transparency` (MIT). All are recorded in `licenses.json`.
- **Native SDKs:** Google Mobile Ads, UMP, StoreKit and Play Billing are recorded under `nativeDependencies`. The SDKs are free: the stores take a commission on sales and AdMob a revenue share, and neither is a cost to you.
- **Network hosts:**
  - New service entry: AdMob/UMP servers, contacted by Google's SDK.
  - New link-only hosts: store subscription pages, Apple's EULA, and the MADIS/CWOP pages.
  - All are recorded in `sources.ts` and `DATA_SOURCES.md`.
- **No new servers, keys or metered services.** Maestro's CLI is free (Apache-2.0); Maestro Cloud isn't used.
