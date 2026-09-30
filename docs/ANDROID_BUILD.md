# First Android build

Works on macOS, Windows or Linux. Free: Android Studio and the emulator cost nothing, and no Google Play account is needed to run the app locally.

## One-time setup

1. Install **Android Studio** (it brings the Android SDK). In its SDK Manager, install an **Android 15/16 system image** and create a **Pixel emulator** (Device Manager → Create device). A physical phone with USB debugging also works (see below).
2. Install a **JDK 17** (for example Microsoft OpenJDK 17 or Eclipse Temurin 17) and point `JAVA_HOME` at it. Recent Android Studio releases bundle a newer JDK (25), which Gradle can use, but React Native 0.83 expects 17.
3. Install **Node.js 22 LTS** and the pnpm version the repo pins (`npm install -g pnpm@10.28.0`, matching `packageManager` in `package.json`). A newer global pnpm tries to switch versions itself and can fail on Windows.
4. Set `ANDROID_HOME` to the SDK folder (Android Studio shows the path under SDK Manager), and add `$ANDROID_HOME/platform-tools` to `PATH` so `adb` works.

**Emulator on Windows:** the emulator needs hardware virtualization. Turn on **Intel VT-x / AMD-V** in the BIOS/UEFI setup, then in SDK Manager → SDK Tools tick **Android Emulator hypervisor driver** and run its `silent_install.bat` (under `Sdk\extras\google\`) as administrator. `emulator -accel-check` reports whether it's ready.

## Build and run

From the repository root:

```sh
git clone https://github.com/lindquistgregory-wq/homeground.git
cd homeground
pnpm install
cd apps/mobile
npx expo-doctor            # reports version or config problems before the slow part
npx expo prebuild --platform android --clean
npx expo run:android       # builds, installs on the running emulator or phone, starts Metro
```

The first Gradle build takes a while (10–20 minutes). Later builds are much faster.

Expo and React Native versions are pinned to SDK 55 in `apps/mobile/package.json`, with root `pnpm.overrides` for `expo-modules-core`, `react`, `react-dom` and `react-native`. Don't use `"*"` ranges for Expo or React Native packages: pnpm resolves them to the newest SDK. If `expo-doctor` reports mismatches after an upgrade, `npx expo install --fix` repins them.

### On a phone over USB

Turn on Developer options and **USB debugging**, plug in, and accept the "Allow USB debugging?" prompt. `adb devices` should list the phone as `device`. Route Metro over the cable so Wi-Fi and the Windows firewall don't matter:

```sh
adb reverse tcp:8081 tcp:8081
```

Keep the phone unlocked while the app first loads; a bundle that starts loading behind the lock screen can leave the app blank. Force-stop and reopen it if that happens.

## Known workarounds

These got the first build through. Each is marked in the code with what would let it go.

- **Local modules** (`modules/shade-native`, `modules/user-sync`, `modules/ondevice-llm`) use the `expo-module-gradle-plugin` (which sets `compileSdk` and Kotlin) and import from `expo`, not `expo-modules-core`.
- **Kotlin 2.1 vs Google libraries built with Kotlin 2.3.** React Native 0.83 compiles with Kotlin 2.1.20; setting `kotlinVersion` in `expo-build-properties` doesn't change the compiler it uses.
  - `react-native-google-mobile-ads`: `apps/mobile/plugins/withAdsKotlinMetadataFix.js` skips the Kotlin metadata version check for that module only (Play Services Ads 25.x ships 2.3 metadata but only needs the 2.1 standard library).
  - ML Kit `genai-prompt` is pinned to **1.0.0-beta2** in `modules/ondevice-llm`. beta3+ require `kotlin-stdlib` 2.3 for the whole app, which crashes the Kotlin 2.1 compiler. The module only uses the core Prompt API.
  - Remove both once React Native moves to Kotlin 2.2 or newer.
- **MapLibre must be loaded with `import`, never `require()`.** Its package `exports` send `require()` to the CommonJS build and `import` to the ESM build; loading both registers the native views twice ("Tried to register two views with the same name MLRNCamera").

If a build fails, save the full output (`npx expo run:android 2>&1 | tee build.log`): the first error in the log is the one that matters.

## Quick smoke test once it launches

1. Find your property (search an address), draw the boundary, open the Site Profile.
2. Design: place a raised bed; switch to the Sun tab.
3. Planting calendar; plant library (debug builds show Google **test** ads on the library screens only).
4. Settings → Dev: Homestead Pro, then save an offline pack from the Site Profile. The Dev tier buttons only appear with the stub billing adapter; native builds link Play Billing, so start Metro with the stub switched on (debug builds only, no rebuild needed):

   ```sh
   EXPO_PUBLIC_BILLING_STUB=1 npx expo start --dev-client --clear
   ```

   On Windows PowerShell: `$env:EXPO_PUBLIC_BILLING_STUB="1"; npx expo start --dev-client --clear`. Stop Metro and start it again without the variable to go back to Play Billing.
5. Planner: the guided questions work on every phone; Gemini Nano chat only on supported phones (Pixel 9 / Galaxy S25 class), not in the emulator.

Bluetooth sensors need a physical phone; the emulator has no Bluetooth.
