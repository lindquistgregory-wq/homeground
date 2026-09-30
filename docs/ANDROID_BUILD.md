# First Android build

Works on macOS, Windows or Linux. Free: Android Studio and the emulator cost nothing, and no Google Play account is needed to run the app locally.

## One-time setup

1. Install **Android Studio** (it brings the Android SDK and a Java 17 runtime). In its SDK Manager, install an **Android 15/16 system image** and create a **Pixel emulator** (Device Manager → Create device). A physical phone with USB debugging also works.
2. Install **Node.js 22 LTS** and **pnpm** (`npm install -g pnpm`).
3. Set `ANDROID_HOME` to the SDK folder (Android Studio shows the path under SDK Manager), and add `$ANDROID_HOME/platform-tools` to `PATH` so `adb` works.

## Build and run

From the repository root:

```sh
git clone https://github.com/lindquistgregory-wq/homeground.git
cd homeground
pnpm install
cd apps/mobile
npx expo install --fix     # pins every Expo / React Native package to the versions SDK 55 expects
npx expo-doctor            # reports version or config problems before the slow part
npx expo prebuild --platform android --clean
npx expo run:android       # builds, installs on the running emulator, starts Metro
```

The first Gradle build takes a while (10–20 minutes). Later builds are much faster.

## What to expect

This is the first time the native code is compiled, so errors are likely. Save the full output (`npx expo run:android 2>&1 | tee build.log`) and share it: the first error in the log is the one that matters. Common first-build issues:

- **Version mismatches** after `pnpm install`: `npx expo install --fix` and `npx expo-doctor` should resolve them.
- **Kotlin compile errors** in `modules/shade-native`, `modules/user-sync` or `modules/ondevice-llm`: these three local modules have never been built.
- **Duplicate class / manifest merger** errors between Google libraries (ads, consent, ML Kit, Play Billing).

## Quick smoke test once it launches

1. Find your property (search an address), draw the boundary, open the Site Profile.
2. Design: place a raised bed; switch to the Sun tab.
3. Planting calendar; plant library (debug builds show Google **test** ads on the library screens only).
4. Settings → Dev: Homestead Pro, then save an offline pack from the Site Profile.
5. Planner: the guided questions work on every phone; Gemini Nano chat only on supported phones (Pixel 9 / Galaxy S25 class), not in the emulator.

Bluetooth sensors need a physical phone; the emulator has no Bluetooth.
