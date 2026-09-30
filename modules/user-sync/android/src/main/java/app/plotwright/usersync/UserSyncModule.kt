package app.plotwright.usersync

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android side of user-cloud sync: Google Drive **appDataFolder** (hidden, per-app, counts against the
 * user's Drive quota).
 *
 * NOT IMPLEMENTED YET. `isAvailable()` returns false, so the app runs local-only on Android and
 * users can move data with export/import. Finishing this needs decisions from the owner:
 *  1. A Google Cloud project with an OAuth client ID for Android (free). The drive.appdata scope may
 *     need Google's OAuth verification before public release.
 *  2. Sign-in via Credential Manager + AuthorizationClient requesting
 *     https://www.googleapis.com/auth/drive.appdata
 *  3. Drive v3 REST calls:
 *       upload:    POST /upload/drive/v3/files?uploadType=multipart  (parents=["appDataFolder"], name=<batchId>.json)
 *       listSince: GET  /drive/v3/files?spaces=appDataFolder&q=createdTime > '<cursor>'&orderBy=createdTime
 *       download:  GET  /drive/v3/files/<id>?alt=media
 *       deleteAll: list + DELETE /drive/v3/files/<id>
 *     The cursor is the createdTime of the newest batch seen.
 */
class UserSyncModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("UserSync")

    AsyncFunction("isAvailable") { false }

    AsyncFunction("upload") { _: String, _: String ->
      // Explicit Unit result: a body that only throws would infer `Nothing`, which Expo can't reify.
      run<Unit> { throw UnsupportedOperationException("Google Drive sync is not implemented yet") }
    }

    AsyncFunction("listSince") { _: String? ->
      mapOf("batches" to emptyList<String>(), "cursor" to null)
    }

    AsyncFunction("deleteAll") { }
  }
}
