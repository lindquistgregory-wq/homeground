# Play Store internal test

How to get a signed build of Plotwright to a small group of testers through Google Play's **internal testing** track. Internal testing has no Google review wait, holds up to 100 testers, and testers install from the Play Store like any app.

You do the account and key steps yourself; the build is already set up to use your key.

## 1. Create your upload key (once)

The upload key proves uploads come from you. Google Play then re-signs the app with its own app signing key (Play App Signing), so if you ever lose the upload key, Google can reset it.

From a terminal, outside the repository (pick your own passwords when `keytool` asks):

```bash
mkdir "%USERPROFILE%\.android-keys"
```

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore "%USERPROFILE%\.android-keys\plotwright-upload.jks" -alias plotwright-upload -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` comes with the JDK 17 from `docs/ANDROID_BUILD.md` (`%JAVA_HOME%\bin\keytool`). Back up the `.jks` file and its password somewhere safe, such as a password manager. **Never commit it.**

## 2. Tell the build where the key is (once)

Add these four lines to `%USERPROFILE%\.gradle\gradle.properties` (create the file if it doesn't exist). It lives in your user folder, not the repository:

```properties
PLOTWRIGHT_UPLOAD_STORE_FILE=C:/Users/<you>/.android-keys/plotwright-upload.jks
PLOTWRIGHT_UPLOAD_STORE_PASSWORD=<keystore password>
PLOTWRIGHT_UPLOAD_KEY_ALIAS=plotwright-upload
PLOTWRIGHT_UPLOAD_KEY_PASSWORD=<key password>
```

Use forward slashes in the path. The config plugin `apps/mobile/plugins/withReleaseSigning.js` reads these; without them, release builds fall back to the debug key and print a warning (fine for local testing, rejected by Play).

## 3. Build the bundle

Play wants an Android App Bundle (`.aab`), not an APK. From `apps/mobile`:

```bash
npx expo prebuild --platform android --clean
```

```bash
cd android && gradlew.bat bundleRelease
```

The bundle is `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab`. Check it's signed with your key (the certificate owner should be what you entered in step 1, not "Android Debug"):

```bash
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
```

**Every upload needs a higher `versionCode`.** Bump `expo.android.versionCode` in `apps/mobile/app.json` (1, 2, 3, …) before each new bundle, and `expo.version` when you want testers to see a new version name.

## 4. Play Console

1. **Developer account.** Sign up at play.google.com/console. Google charges a one-time registration fee and verifies your identity; personal accounts created after November 2023 must run a closed test with at least 12 testers for 14 days before applying for production (internal testing isn't affected).
2. **Create the app.** Name Plotwright, default language, App, Free (in-app purchases are still allowed), accept the declarations.
3. **Internal testing → Testers.** Create an email list with your testers' Google account addresses and save.
4. **Internal testing → Create new release.** Accept Play App Signing when asked, upload `app-release.aab`, add release notes, then **Review release → Start rollout**.
5. **Share the opt-in link** from the Testers tab. Each tester opens it, accepts, then installs from the Play Store link on their phone.

Play may also ask you to fill in parts of **App content** before the first rollout. What Plotwright needs to declare:

- **Privacy policy:** the published `docs/PRIVACY.md` (it's linked from the app's Settings and paywall).
- **Ads:** yes, the app contains ads (free plan).
- **Data safety:** approximate and precise location (used on the device for the property map; not collected by a server); AdMob's collection on the free plan (device identifiers, coarse location, app interactions, advertising data). Nothing for the app's own usage statistics, which never leave the phone.
- **Content rating** questionnaire, **target audience** (adults; not designed for children), **news app** (no), **government app** (no), **financial features** (none).

## 5. What testers will and won't see

- **Ads:** none yet. Release builds use the ad units in `apps/mobile/src/config.ts` (`ADMOB_UNITS`), which are still empty, and `app.json` still has Google's sample AdMob app id. Create the AdMob app and units first if you want ads in the test (Phase 6 report, "Setup you'll need to do").
- **Purchases:** the paywall shows only products that exist in Play Console (Monetize → Products). Create them as listed in the Phase 6 report, and add testers as **license testers** (Setup → License testing) so their test purchases aren't charged.
- **Gemini Nano** planner chat only on Pixel 9 / Galaxy S25-class phones; everyone else gets the guided questions.
