# Plotwright privacy policy

_Draft for the owner to review before release. Last updated 2026-10-16. Not legal advice; have it checked for the regions you publish in._

Plotwright is a homestead and garden planner. It has **no server of its own** and no user accounts.

## What stays with you

- **Properties, boundaries, Site Profiles, designs, plantings, sensor readings, planner goals, tasks, project progress and conversations** are stored on your phone. If you turn on sync, they go to **your own** iCloud (CloudKit private database). Plotwright's developer can't see them.
- **Location** is used on the phone to find your property and to trace a boundary. It isn't sent to Plotwright.
- **Weather-station keys and sensor keys** are kept in the phone's keychain.
- The **AI planner** runs on the phone (Apple Foundation Models or Gemini Nano). Nothing you type is sent to a cloud AI.
- **AI bed suggestions** use the same on-device AI. Only if you add **your own** Claude API key in Settings (optional, off by default) and the phone has no on-device AI, a bed's conditions (sun hours, soil, zone, month), its plants and the list of plants that fit are sent to Anthropic's Claude API under your own Anthropic account, which bills you. No location, names, photos or other data are sent. The key stays in the phone's secure storage and is removed by "Delete all my data".

## What the app sends, and to whom

- **Public data services** (USGS, NOAA, NWS, USDA, FEMA, the Census Bureau, OpenFreeMap, NASA and county parcel services): the coordinates or area of your property, to fetch map tiles and data about it. The full list and each service's terms are in the app under *Data sources* and in [`DATA_SOURCES.md`](../DATA_SOURCES.md). These requests carry the app's name and a contact address, never anything about you.
- **Parcel services**: only parcel outlines, ids and acreage are requested. Owner names and mailing addresses are never requested or stored.
- **Your weather-station service** (Ambient, Ecowitt, Davis, Tempest), with your own key, if you connect one.
- **The App Store or Google Play**, when you buy or restore a plan. Payment is handled entirely by Apple or Google.
- **Google AdMob** (free plan only; paid plans load no ads). Google's ads SDK and its consent form (User Messaging Platform) contact Google's servers and receive device information such as the device model, OS, IP address (from which coarse location is inferred) and ad interactions. **Ads are non-personalised unless you turn on "Allow personalised ads"** in Settings; on iPhone that also requires Apple's tracking permission, which Plotwright asks for only when you turn that setting on. In the EU, UK and Switzerland, Google's consent form asks you first. See [how Google uses information from apps that use its services](https://policies.google.com/technologies/partner-sites).

## Usage statistics

Off by default. If you turn on *Keep usage statistics on this phone*, Plotwright counts which screens and features you use and keeps a log of app errors, **on your phone only**. They are never sent anywhere; you can view, share or clear them in Settings. Crash reports reach the developer only if you've allowed your phone to share them (Apple's *Share with App Developers*, Google Play's diagnostics).

## Health-related information

The planner's household details (ages, sex and activity level, used to estimate food needs) and any animal or pet health records are stored **only on your phone and in your own cloud account**. The developer never receives them, and they are never shared with advertisers, affiliate partners or anyone else, or used to choose ads. Safety acknowledgements ("Got it" on a safety note) and your acceptance of the terms are stored the same way.

Animal records (individual animals and pets, production logs, breeding and health records) follow the same rule. Health reminders are scheduled on your phone by its own notification system from the dates you enter; nothing is sent to a server. A vet history or CSV leaves the phone only when you share it yourself.

**Animal photos** (taken with the camera or chosen from your library, for an animal or a group on your homestead) are re-encoded on your phone when you add them, which removes location (GPS) and other camera data; a photo that still carries it isn't saved. The original isn't kept. Full-size photos stay on the phone; only small thumbnails travel to your own cloud account with the record. The camera is used only when you choose "Take a photo", and nothing is uploaded anywhere else.

**Shopping links**, where shown, are labelled "Paid link" and open in your phone's browser. They carry only a product search term such as "chicken feeder": never your property, location, animals or records. Turn them off in More.

## Children

Plotwright is for adults: you must be 18 or older to use it (the on-device Gemini Nano features also require it). It isn't directed at children.

## Your choices

- **Delete all my data** in Settings erases everything on the phone, including saved offline map packs and usage statistics, and deletes your cloud copy.
- Export your designs and plans at any time (PDF, GeoJSON, KML, DXF), and your animal records as CSV or JSON.
- Change ad privacy choices in Settings (*Ad privacy choices*, when your region requires it) and in your phone's tracking settings.

## Contact

Questions: open an issue at https://github.com/lindquistgregory-wq/homeground or email handlenterprises1988@gmail.com.
