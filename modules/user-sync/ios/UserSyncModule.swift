import CloudKit
import ExpoModulesCore

/// Stores sync batches in the signed-in user's **private** CloudKit database, in a custom zone, so
/// storage counts against the user's iCloud quota and the developer runs no server (§0 rule 3).
/// Change tracking uses CloudKit's zone change tokens, so no custom indexes are needed in the schema.
public class UserSyncModule: Module {
  private let container = CKContainer(identifier: "iCloud.app.homeground.planner")
  private var db: CKDatabase { container.privateCloudDatabase }
  private let zoneID = CKRecordZone.ID(zoneName: "HomegroundSync", ownerName: CKCurrentUserDefaultName)
  private let recordType = "ChangeBatch"

  public func definition() -> ModuleDefinition {
    Name("UserSync")

    AsyncFunction("isAvailable") { () async -> Bool in
      do {
        return try await self.container.accountStatus() == .available
      } catch {
        return false
      }
    }

    AsyncFunction("upload") { (batchId: String, payload: String) async throws in
      try await self.ensureZone()
      let record = CKRecord(recordType: self.recordType, recordID: CKRecord.ID(recordName: batchId, zoneID: self.zoneID))
      // Large batches go in an asset; CKRecord fields are limited to ~1 MB in total.
      if payload.utf8.count > 700_000 {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(batchId).json")
        try payload.write(to: url, atomically: true, encoding: .utf8)
        record["payloadAsset"] = CKAsset(fileURL: url)
      } else {
        record["payload"] = payload as CKRecordValue
      }
      let (saveResults, _) = try await self.db.modifyRecords(saving: [record], deleting: [], savePolicy: .allKeys)
      // Per-record failures (quota exceeded, record too large) are reported here, not thrown.
      for (_, result) in saveResults {
        if case .failure(let error) = result { throw error }
      }
    }

    AsyncFunction("listSince") { (cursor: String?) async throws -> [String: Any] in
      try await self.ensureZone()
      var token: CKServerChangeToken? = nil
      if let cursor, let data = Data(base64Encoded: cursor) {
        token = try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
      }
      var batches: [String] = []
      var more = true
      while more {
        let changes: (modificationResultsByID: [CKRecord.ID: Result<CKDatabase.RecordZoneChange.Modification, Error>],
                      deletions: [CKDatabase.RecordZoneChange.Deletion],
                      changeToken: CKServerChangeToken,
                      moreComing: Bool)
        do {
          changes = try await self.db.recordZoneChanges(inZoneWith: self.zoneID, since: token)
        } catch let error as CKError where token != nil && (error.code == .changeTokenExpired || error.code == .zoneNotFound) {
          // The zone was wiped by another device, or Apple expired our token: start over from the
          // beginning. Re-applying batches is safe because merges are last-writer-wins by stamp.
          try await self.ensureZone()
          token = nil
          batches.removeAll()
          continue
        }
        for (_, result) in changes.modificationResultsByID {
          guard case .success(let mod) = result else { continue }
          let rec = mod.record
          if let s = rec["payload"] as? String {
            batches.append(s)
          } else if let asset = rec["payloadAsset"] as? CKAsset, let url = asset.fileURL,
                    let s = try? String(contentsOf: url, encoding: .utf8) {
            batches.append(s)
          }
        }
        token = changes.changeToken
        more = changes.moreComing
      }
      let newCursor = try token.map { try NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true).base64EncodedString() }
      return ["batches": batches, "cursor": newCursor as Any]
    }

    AsyncFunction("deleteAll") { () async throws in
      do {
        let (_, deleteResults) = try await self.db.modifyRecordZones(saving: [], deleting: [self.zoneID])
        for (_, result) in deleteResults {
          if case .failure(let error) = result, (error as? CKError)?.code != .zoneNotFound { throw error }
        }
      } catch let error as CKError where error.code == .zoneNotFound {
        // Already gone.
      }
    }
  }

  private func ensureZone() async throws {
    let (saveResults, _) = try await db.modifyRecordZones(saving: [CKRecordZone(zoneID: zoneID)], deleting: [])
    for (_, result) in saveResults {
      if case .failure(let error) = result { throw error }
    }
  }
}
