// react-native-ble-plx adds ACCESS_COARSE/FINE_LOCATION as <uses-permission-sdk-23 maxSdkVersion="30">
// for BLE scanning on Android 11 and older. The app also asks for location on every version (to find
// the property and walk its boundary), so the manifest declared each permission twice with different
// maxSdkVersions, which Play rejects. The unrestricted declaration (android.permissions in app.json)
// covers BLE too, so the sdk-23 copies go, including the ones rxandroidble's own library manifest merges
// in (tools:node="remove"). List this plugin before react-native-ble-plx in app.json: manifest mods run
// last-listed first, so it then runs after ble-plx has added its copies.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const LOCATION = ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION'];

module.exports = function withoutDuplicateLocationPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission-sdk-23'] = [
      ...(manifest['uses-permission-sdk-23'] ?? []).filter((p) => !LOCATION.includes(p.$['android:name'])),
      ...LOCATION.map((name) => ({ $: { 'android:name': name, 'tools:node': 'remove' } })),
    ];
    return cfg;
  });
};
