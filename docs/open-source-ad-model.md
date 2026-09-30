# Alternative business model: open source, funded by ads (§12)

_Written 2026-09-30 for Phase 6. Facts were checked against the linked sources on 29–30 September 2026; re-check before deciding. Not legal or financial advice._

## The question

Plotwright ships with **subscription tiers**: Free with ads, Grower ($2.99/month or $24.99/year), Homestead Pro ($9.99/month, $79.99/year, or a lifetime option). This document evaluates the alternative: **open-source the app, make every feature free, and fund it with ads alone** (plus optional donations and disclosed affiliate links). It also covers the hybrid that keeps a single **"remove ads"** purchase.

## The app already supports both models

| Switch | Where | What it does |
|---|---|---|
| `BUSINESS_MODEL = 'openSource'` | `apps/mobile/src/config.ts` | Every feature is unlocked (`resolveEntitlements` returns the Pro feature set). Ads show unless the one-time `plotwright.removeads` purchase is owned. The paywall becomes a single "Remove ads" offer. |
| `EXPO_PUBLIC_ADS=off` (and removing the `react-native-google-mobile-ads` plugin) | build environment, `app.json` | Uses the `NoAds` provider. No Google code is linked, which is what an F-Droid build needs. |
| `AdProvider` interface | `apps/mobile/src/ads/provider.ts` | AdMob today. A different free SDK, or none, can be swapped in without touching screens. |
| Store billing behind `BillingAdapter` | `apps/mobile/src/billing/adapter.ts` | An F-Droid flavour would use an adapter that reports "no store" (every feature is free there anyway). |

The zero-running-cost design holds under both models: there is no server to pay for in either one.

## 1. Licence choice

| | GPL-3.0 | AGPL-3.0 | MPL-2.0 | Apache-2.0 | MIT |
|---|---|---|---|---|---|
| Changed versions must stay open | Yes: the whole combined app | Yes, plus network use (§13) | Only the changed MPL files | No | No |
| Patent grant | Yes | Yes | Yes | Yes (ends if the user sues over patents) | Not explicit |
| App Store distribution | Conflict: Apple's terms add restrictions (GPLv3 §10). Needs an added permission | Same | Works (VLC for iOS ships under MPL-2.0) | Works | Works |
| Bundling proprietary SDKs (AdMob, UMP, Play Billing, StoreKit) | Needs a linking exception | Needs a linking exception | Works | Works | Works |
| F-Droid | Accepted | Accepted | Accepted | Accepted | Accepted |

Background on the App Store conflict:

- The FSF's position (2010) is that App Store terms conflict with the GPL ([FSF](https://www.fsf.org/news/2010-05-app-store-compliance)).
- VLC was pulled from the App Store in 2011 over this ([9to5Mac](https://9to5mac.com/2011/01/07/vlc-for-ios-removed-from-the-app-store/)), and came back under MPL-2.0.
- Signal, Bitwarden and others ship (A)GPL apps today. They hold the copyright themselves, and some add a §7 "app store" permission. Only the copyright holders can grant such a permission, so it has to be in place **before** outside contributions arrive (or contributors sign a CLA).
- The GPL's "system library" exception does not plausibly cover AdMob or Play Billing, because they ship inside the app.

**Recommendation: MPL-2.0.** It keeps improvements to Plotwright's own files open, lets proprietary SDKs sit alongside, and has a clean App Store record. Apache-2.0 is the choice if maximum adoption, including closed forks, matters more than keeping changes open. GPL/AGPL would need an App Store exception and an SDK linking exception written in from day one, plus a CLA.

## 2. Anyone can build it without ads

With the source public, anyone can compile an ad-free copy. Ad revenue therefore comes only from the **official store builds**, and what protects them is the **name, not the code**:

- **Trademark.** Keep "Plotwright" and the icon outside the code licence (Apache-2.0 §6 says this explicitly; MPL-2.0 §2.3 doesn't grant trademarks either). Publish a `TRADEMARKS.md` in the style of [Mozilla's](https://www.mozilla.org/en-US/foundation/trademarks/policy/) or [Signal's](https://signal.org/brand/) policies: forks must rename.
- **US trademark filing.** $350 per class for the base application since 18 January 2025, plus surcharges ([USPTO exam guide 1-25](https://www.uspto.gov/sites/default/files/documents/TM-ExamGuide-1-25.pdf)).
  - This is a one-time cost, not a running cost. The owner decides whether it's worth it.
  - Unregistered ("™") rights still exist through use.
- **Practical reality.** Most users install from the store they already use. Forks rarely take much of that audience, but a well-funded clone with the ads removed could.

## 3. F-Droid and other open-source catalogs

- **F-Droid**'s [inclusion policy](https://f-droid.org/en/docs/Inclusion_Policy/) forbids proprietary ad and tracking SDKs, Google Play Services, Firebase and Crashlytics. It asks for a build flavour without them.
  - An F-Droid Plotwright would be the `NoAds` build: **no ad revenue from F-Droid.**
  - It would carry no "Ads" anti-feature.
  - It might be labelled **NonFreeNet**, because it relies on public web services that aren't free software themselves (USGS, NOAA, OpenFreeMap). See the [Anti-Features list](https://f-droid.org/en/docs/Anti-Features/).
- **IzzyOnDroid** doesn't accept apps with ads or analytics ([policy](https://izzyondroid.org/docs/general/AppInclusionPolicy/)).

So ads-only revenue is App Store and Google Play revenue.

## 4. Other income that fits the open-source model

- **Donations.**
  - **GitHub Sponsors:** no fee on sponsorships from personal accounts; up to 6% from organisation accounts ([GitHub Docs](https://docs.github.com/en/sponsors/sponsoring-open-source-contributors/about-sponsorships-fees-and-taxes)).
  - **Liberapay:** takes no cut; payment-processor fees apply ([FAQ](https://liberapay.com/about/faq)).
  - **Open Source Collective:** a 10% host fee ([docs](https://docs.oscollective.org/welcome-and-introduction-to-osc/fees)).

  Donations are voluntary and hard to predict, so treat them as a bonus.
- **Affiliate links (optional, §10).** For example, the design screen's material list could link to seeds, bed kits, greenhouses and sensors.
  - Each link must be labelled ("affiliate link: we may earn a commission").
  - Programme rates and terms vary and weren't researched here.
  - Links must never be personalised with user data.
- **"Remove ads" one-time purchase.** Keeps everything free while giving people who dislike ads a way out, and pays for the app directly. Same store fees as subscriptions.

## 5. Public-good option: share your weather station with CWOP → NOAA MADIS

The volunteer **Citizen Weather Observer Program** feeds personal weather-station data into NOAA's MADIS system, where forecasters and researchers use it. Plotwright **only links to instructions**; it never relays data. The station's own software does the uploading.

- **Sign up** for a CWOP id (or register a ham callsign) with NOAA MADIS: https://madis.ncep.noaa.gov/cwop_signup.shtml.
  - The station counts as active once packets arrive.
  - Registrations that never send are removed after 90 days.
- **About the program:** https://madis.ncep.noaa.gov/madis_cwop.shtml and http://www.wxqa.com/.
- **Station software that uploads to CWOP**, all over APRS-IS (`cwop.aprs.net`, about every 10 minutes):
  - **WeeWX:** built-in `[[CWOP]]` section ([docs](https://www.weewx.com/docs/5.3/reference/weewx-options/stdrestful/)).
  - **Cumulus:** built-in APRS/CWOP settings.
  - **Weather Display.**
  - **Davis WeatherLink.com:** an upload option ([Davis KB](https://www.manula.com/manuals/pws/davis-kb/1/en/topic/uploads-to-other-weather-platforms-from-weatherlink-com)).
- **Ambient Weather** has no direct CWOP upload ([Ambient FAQ](https://ambientweather.com/support/question/view/id/1460/)). Owners use WeeWX or Cumulus with Ambient's API, or Ambient's bridge hardware.
- **Ecowitt:** native support wasn't confirmed; WeeWX and Cumulus MX work.
- The NWS page (https://weather.gov/pub/JoinCWOP) still points to an older findU form. The MADIS page looks current, so **confirm which one to link before release.**

The app shows this as a link card on the weather-station screen.

## 6. Revenue calculator

The interactive calculator is [`docs/revenue-calculator.html`](revenue-calculator.html). Open it in a browser; it's a self-contained page. The same formulas are in `packages/core/src/monetization/revenue.ts` and tested in `scripts/monetization.test.ts`.

**Inputs (all editable):**
- monthly active users and sessions per user
- ad requests per session and fill rate by format (banner, interstitial, rewarded, native)
- eCPM by format for each country or region, with that region's share of users
- subscription prices and the share of users on each plan
- store fee, donations, and "remove ads" price and buyers
- a multiplier for "open source brings more users"

**eCPM, fill rate and conversion start empty on purpose.** No figure is invented. Where to find real ones:
- **Your own AdMob reports**, once the app has live traffic. This is the only number that really matters.
- **AdMob eCPM Trends** (in the AdMob console, under Reports): your eCPM against a peer group of apps in your category, by platform and country ([help](https://support.google.com/admob/answer/14659812)).
- **Public dashboards** such as [Appodeal Benchmarks](https://appodeal.com/benchmarks). They're dominated by games; note the date, format, country and category of any figure you borrow.
- **Google doesn't publish AdMob's revenue share.** The often-quoted 68% is for AdSense display ads, not AdMob. Use the net earnings AdMob reports.
- **Subscription conversion:** your own store analytics. For context only:
  - RevenueCat's [State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps) reports a 2.0% median download-to-paid rate by day 35 (2.1% for freemium apps), and trial-to-paid of 42.5% for 17–32-day trials.
  - Adapty's [2026 report](https://adapty.io/state-of-in-app-subscriptions/) gives medians of $12.99/month and $38.42/year.
  - Neither has a gardening or homesteading category, and they define conversion differently.

**Store fees** (the only defaults, because they're published):
- **Apple:** 15% for Small Business Program members ([Apple](https://developer.apple.com/app-store/small-business-program/)).
- **Google Play in the US, UK and EEA** from 30 June 2026: 10% service fee plus 5% billing fee on the first $1M a year and on auto-renewing subscriptions ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/112622)).

### The formula that decides it

Let:
- **p** = share of monthly users who pay
- **N** = net monthly revenue per paying user (price ÷ months × (1 − store fee))
- **A** = monthly ad revenue per user who sees ads
- **g** = how many times more users the open-source version attracts

Then per 100 users:
- **Tiers:** p·N + (1 − p)·A (subscribers see no ads)
- **Open source, ads only:** g·A

Two results follow:

- **With the same audience (g = 1), tiers earn at least as much as ads-only whenever N ≥ A.** One paying user is worth more than one ad viewer.
- **Open source out-earns tiers only if g > p·N / A + (1 − p).** That is, openness has to grow the audience enough to make up for the subscribers it gives up.

Using this plan's own prices, a Grower annual subscriber is worth N = $24.99 ÷ 12 × 0.85 ≈ **$1.77 a month**. For ads to match that, one user's ad impressions must earn $1.77 a month. The blended eCPM needed is **$1.77 × 1,000 ÷ (impressions per user per month)**:

| Impressions per user per month | eCPM needed to match one Grower subscriber |
|---|---|
| 20 | $88.51 |
| 60 | $29.50 |
| 150 | $11.80 |

That is arithmetic, not a forecast. Compare the right-hand column with your own AdMob eCPM Trends figures. Plotwright's placement rules keep impressions low on purpose (no ads on the design canvas or in the AI chat, and at most one interstitial per session), so the left-hand column will be modest.

## 7. Trade-offs

| | Subscription tiers (current) | Open source + ads only | Hybrid: open source + "remove ads" |
|---|---|---|---|
| Revenue driver | A small share of engaged users pays | Every session, through ads | Ads plus one-off purchases |
| Scale needed | Works at small scale | Needs large audiences; revenue ∝ users × impressions × eCPM | Between the two |
| Users' experience | Deep features paywalled | Everything free, with ads (never on design, chat or alerts) | Everything free; ads can be removed |
| Privacy story | Paid tiers see no ads at all | Every user sees ads by default | Buyers see none |
| Community | Closed code, or source-available | Contributors, translators, plant-data fixes; trust from privacy-minded users | Same as open source |
| Forks | Not possible | Possible; the trademark protects the name | Same |
| F-Droid | Not applicable | Only as an ad-free build (no revenue) | Same |
| Work for the owner | Store product setup, paywall compliance | Community management, reviewing contributions, CLA or licence hygiene | Both |

## 8. Recommendation by scale

These bands are about **monthly active users**. Plug your own numbers into the calculator before relying on them.

- **Small (up to about 10,000 MAU): keep subscription tiers**, with ads on Free as built.
  - At this size, ad revenue is small in absolute terms whatever the eCPM, because impressions per user are deliberately low.
  - A few engaged homesteaders paying $25–80 a year out-earn them.
  - Optionally publish the code **source-available** (or MPL-2.0 for the plant and knowledge data only) to invite data corrections without giving up revenue.
- **Medium (about 10,000–250,000 MAU): hybrid.**
  - Open-source the app under **MPL-2.0**, register the trademark, and keep the store builds with tiers or, if the community clearly prefers it, all features free plus a "remove ads" purchase.
  - Add GitHub Sponsors and, optionally, disclosed affiliate links on the materials list.
  - Watch the growth condition above: open source is only worth giving up subscriptions if g > p·N/A + (1 − p) in your own data.
- **Large (hundreds of thousands of MAU and up): open source with ads plus "remove ads" becomes viable**, because ad revenue scales with users and community contributions scale with them too.
  - Even here, the tiers still win at the same audience size unless A ≥ N.
  - So the switch is justified by growth, reach and mission (privacy, openness), not by eCPM alone.

**Overall:** stay on subscription tiers now; revisit at about 10,000 MAU with real AdMob and conversion data in the calculator. The code already switches models with one setting.
