// play-services-ads 25.x ships Kotlin 2.3 metadata; React Native 0.83 compiles with Kotlin 2.1,
// so react-native-google-mobile-ads fails with "compiled with an incompatible version of Kotlin".
// Skip the metadata version check for that one module only. Remove once RN's Kotlin reaches 2.2+.
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// plotwright: ads kotlin metadata fix';
const SNIPPET = `
${MARKER}
subprojects { p ->
  if (p.name == 'react-native-google-mobile-ads') {
    p.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
      compilerOptions.freeCompilerArgs.add('-Xskip-metadata-version-check')
    }
  }
}
`;

module.exports = function withAdsKotlinMetadataFix(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += SNIPPET;
    }
    return cfg;
  });
};
