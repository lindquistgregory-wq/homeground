<!-- Owner: have this reviewed by your attorney for the regions you publish in before relying on it. Keep "Effective date" current when anything below changes, and update the Play data safety form to match. -->

# Plotwright privacy policy

**Effective date:** October 27, 2026

Plotwright ("the app") is a homestead and garden planner published by **Birdmoss Farms LLC**, Asheboro, North Carolina, USA ("we", "us"). This policy explains what information the app uses, where it goes, and the choices you have. It applies to the Plotwright apps on Android (Google Play) and iPhone (App Store).

**The short version:** Plotwright has no server of its own and no user accounts. What you enter stays on your phone (and, if you choose, in your own cloud account). We never see it, never sell it, and never share it for advertising. The app contacts public data services about your property's location to build its maps and profiles, and, on the free plan, Google's ad service.

## 1. Information you enter, and where it's stored

Everything you create in Plotwright is stored **on your phone**:

- properties, boundaries and site profiles; designs, beds, plantings and garden notes;
- planner answers (including household ages, sex and activity level, used only to estimate food needs), plans, project progress, tasks and calendar events;
- animal and pet records (individual animals, production logs, breeding and health records) and their reminders;
- animal photos, sensor readings and weather-station settings;
- your settings, safety acknowledgements and acceptance of the terms.

We (the developer) do not receive any of it.

**Backups and sync.**
- *Android:* if your phone's Google backup is turned on, Android may include the app's data in your device backup, stored in **your own Google account** and encrypted by Google. Keys you've saved in the app (see section 4) are excluded. Plotwright doesn't yet offer its own sync on Android.
- *iPhone:* if you turn on sync in Settings, your data is stored in **your own iCloud account** (Apple's CloudKit private database). We can't access it.

## 2. Location

With your permission, the app uses your phone's location **only while you're using it**, to find your property and to trace its boundary as you walk it. Your location isn't sent to us. The coordinates of your property (not your live location) are sent to the public data services in section 3 to fetch maps and data about it. You can deny or revoke location permission in your phone's settings and search for your property by address or on the map instead.

## 3. Information the app sends to other services

The app sends only what each service needs, over encrypted connections (HTTPS), and never includes your name, contacts or records.

| Service | What it receives | Why |
|---|---|---|
| **Public data services**: USGS, NOAA, National Weather Service, USDA (including NRCS soils), FEMA, U.S. Census Bureau, NASA, NC OneMap, OpenFreeMap and county parcel services | Your property's coordinates or outline, and the app's name and a contact address (required by some services) | Map tiles, aerial imagery, soils, frost dates, flood zones, weather forecasts and parcel outlines. Parcel requests ask only for outlines, ids and acreage; owner names and mailing addresses are never requested or stored. The full list is in the app under *Data sources*. |
| **Google AdMob** (free plan only; paid plans show no ads) | Device information such as model, operating system, IP address (from which an approximate location can be inferred), the advertising ID, and ad interactions | Showing ads, measuring them, and preventing fraud. Ads are **non-personalised** unless you turn on *Allow personalised ads* in Settings. In the EU, UK and Switzerland, Google's consent form asks you first. See [how Google uses information from apps that use its services](https://policies.google.com/technologies/partner-sites). |
| **Google Play / Apple App Store** | Your purchase | When you buy or restore a plan. Payment is handled entirely by Google or Apple; we never see your payment details. |
| **Your weather-station service** (Ambient Weather, Ecowitt, Davis WeatherLink, Tempest), only if you connect one | The API keys you enter, sent only to that service | Reading your own station's data. |
| **Anthropic (Claude API)**, only if you add your own Claude API key in Settings | A garden bed's conditions (sun hours, soil, hardiness zone, month), the plants in it and the plants that fit | Optional AI bed suggestions, when your phone has no on-device AI. The request is made under **your own** Anthropic account, which bills you. No location, names, photos or other records are sent. |

**On-device AI.** The planner's chat and AI bed suggestions use the AI model built into your phone (Gemini Nano on Android, Apple Intelligence on iPhone) where available. That runs entirely on the phone; nothing you type is sent to a cloud AI.

**Shopping links**, where shown, are marked "Paid link" and open in your browser. They carry only a product search term such as "chicken feeder", never anything about your property, location, animals or records. Retailers' own privacy policies apply once you visit them. You can turn these links off in Settings.

## 4. Camera, photos, Bluetooth, notifications and stored keys

- **Camera and photos:** used only when you choose to take or pick a photo of your animals. Each photo is re-encoded on your phone, which removes location (GPS) and other camera data, and the original isn't kept. Photos stay on your phone; only small thumbnails travel with your records into your own backup or sync.
- **Bluetooth:** used only to listen for readings broadcast by your own garden and weather sensors. The app doesn't use Bluetooth to find your location.
- **Local network:** used only if you connect a weather station on your home Wi-Fi.
- **Notifications:** frost, heat and calendar reminders are scheduled by your phone from information on your phone.
- **Stored keys:** weather-station keys, sensor keys and an optional Claude API key are kept in your phone's secure storage (Android Keystore / iOS Keychain). They're excluded from backups and never sent to us.

## 5. Usage statistics and crash reports

Usage statistics are **off by default**. If you turn on *Keep usage statistics on this phone*, the app counts which screens and features you use and keeps a log of app errors **on your phone only**. They're never sent anywhere automatically; you can view, share or clear them in Settings. Crash reports reach us only if you've allowed your phone to share diagnostics with app developers (Google Play's or Apple's settings), and then only as those platforms provide them.

## 6. Health-related and household information

Household details (ages, sex, activity level, pregnancy or breastfeeding if you enter them) and animal health records are used only to calculate food needs and to remind you of care dates. They're stored only on your phone and in your own backup or sync, never sent to us, never shared with advertisers or partners, and never used to choose ads. A record leaves your phone only when you export or share it yourself.

## 7. What we don't do

- We don't sell or rent your information.
- We don't share your information with data brokers.
- We don't use your records, location or household details for advertising.
- We don't create accounts or profiles about you.

## 8. Keeping and deleting your information

Your information stays on your phone until you delete it.

- **Delete all my data** (in Settings) erases everything the app stores on your phone: properties, records, photos, saved offline map packs, usage statistics and stored keys. On iPhone it also deletes your iCloud copy.
- Uninstalling the app removes its data from your phone. A device backup you've made stays in your Google or Apple account until you delete it there.
- You can export your designs and plans (PDF, GeoJSON, KML, DXF) and your animal records (CSV, JSON) at any time.
- Because we don't hold your data, there's nothing on our side to delete. Data held by Google (AdMob), Google Play or Apple, or Anthropic under your own account, is governed by their policies, and you can make requests to them directly.

## 9. Security

Data on your phone is protected by your phone's own security (screen lock and device encryption), and keys are kept in its secure storage. Everything the app sends travels over encrypted connections (HTTPS). No method of storage or transmission is completely secure, but because we don't collect your information, there's no central store of it to breach.

## 10. Your rights

Depending on where you live (for example under the GDPR in the EU and UK, or state privacy laws such as California's), you may have rights to access, correct, delete or move your personal information, and to object to or limit certain uses. Because your information is stored on your device and in your own accounts, you can exercise most of these yourself in the app (export, edit, *Delete all my data*). For ads, use *Ad privacy choices* in Settings (where your region requires it) and your phone's own ad settings, where you can reset or delete the advertising ID. For anything else, contact us below and we'll respond within 30 days.

## 11. Children

Plotwright is intended for adults and isn't directed at children. You must be 18 or older to use it. We don't knowingly collect information from children; if you believe a child has used the app, contact us.

## 12. Changes to this policy

If we change this policy, we'll update the effective date above and, for significant changes, give notice in the app or on its store listing. The current version is always at https://github.com/lindquistgregory-wq/homeground/blob/main/docs/PRIVACY.md.

## 13. Contact

Birdmoss Farms LLC
Asheboro, North Carolina, USA
Email: handlenterprises1988@gmail.com
