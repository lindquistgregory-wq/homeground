// Android Auto Backup and device-to-device transfer (free, through the user's own Google account).
// expo-secure-store's default rules back up only shared preferences, which left out the database
// (properties, designs, plantings, animal and health records) and animal photos. These rules keep
// secure-store's exclusion (its values are encrypted with keys that never leave the device) and add:
//   files/SQLite/        the expo-sqlite database
//   files/animal-photos/ full-size animal photos (thumbnails live in the database)
// Offline map packs live in the cache folder, which Android never backs up; they can be re-downloaded.
// Note: Auto Backup skips an app whose backup is over 25 MB, so the database should stay lean.
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const INCLUDES = `
    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>
    <include domain="file" path="SQLite/"/>
    <include domain="file" path="animal-photos/"/>`;

const FULL_BACKUP = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup for Android 11 and lower (plugins/withBackupRules.js) -->
<full-backup-content>${INCLUDES}
</full-backup-content>
`;

const EXTRACTION = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup and device transfer for Android 12 and higher (plugins/withBackupRules.js) -->
<data-extraction-rules>
  <cloud-backup>${INCLUDES.replace(/\n    /g, '\n      ')}
  </cloud-backup>
  <device-transfer>${INCLUDES.replace(/\n    /g, '\n      ')}
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withBackupRules(config) {
  config = withDangerousMod(config, ['android', (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plotwright_backup_rules.xml'), FULL_BACKUP);
    fs.writeFileSync(path.join(dir, 'plotwright_data_extraction_rules.xml'), EXTRACTION);
    return cfg;
  }]);
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:allowBackup'] = 'true';
    app.$['android:fullBackupContent'] = '@xml/plotwright_backup_rules';
    app.$['android:dataExtractionRules'] = '@xml/plotwright_data_extraction_rules';
    return cfg;
  });
};
module.exports.FULL_BACKUP = FULL_BACKUP;
module.exports.EXTRACTION = EXTRACTION;
