// Signs release builds with the owner's Play upload key, read from Gradle properties kept outside
// the repo (~/.gradle/gradle.properties): PLOTWRIGHT_UPLOAD_STORE_FILE, PLOTWRIGHT_UPLOAD_STORE_PASSWORD,
// PLOTWRIGHT_UPLOAD_KEY_ALIAS, PLOTWRIGHT_UPLOAD_KEY_PASSWORD. Without them, release builds keep the
// debug key (fine for local testing, rejected by Play). See docs/PLAY_INTERNAL_TEST.md.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// plotwright: release signing';

const SIGNING_CONFIG = `
        ${MARKER}
        release {
            if (project.hasProperty('PLOTWRIGHT_UPLOAD_STORE_FILE')) {
                storeFile file(PLOTWRIGHT_UPLOAD_STORE_FILE)
                storePassword PLOTWRIGHT_UPLOAD_STORE_PASSWORD
                keyAlias PLOTWRIGHT_UPLOAD_KEY_ALIAS
                keyPassword PLOTWRIGHT_UPLOAD_KEY_PASSWORD
            }
        }`;

const RELEASE_SIGNING = `if (project.hasProperty('PLOTWRIGHT_UPLOAD_STORE_FILE')) {
                signingConfig = signingConfigs.release
            } else {
                logger.warn('Plotwright: no upload key configured; release build signed with the debug key (Play will reject it).')
                signingConfig = signingConfigs.debug
            }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    const debugBlock = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
    if (!debugBlock.test(gradle)) throw new Error('withReleaseSigning: signingConfigs.debug not found in app/build.gradle');
    gradle = gradle.replace(debugBlock, `$1${SIGNING_CONFIG}`);

    // The template writes `signingConfig signingConfigs.debug`; later tooling may add `=`.
    const releaseLine = /(release\s*\{[^{}]*?)signingConfig\s*=?\s*signingConfigs\.debug/;
    if (!releaseLine.test(gradle)) throw new Error('withReleaseSigning: release buildType signingConfig not found in app/build.gradle');
    gradle = gradle.replace(releaseLine, `$1${RELEASE_SIGNING}`);

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
