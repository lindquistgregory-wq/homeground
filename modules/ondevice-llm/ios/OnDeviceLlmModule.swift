import ExpoModulesCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Bridges Apple's on-device Foundation Models (iOS 26+, Apple Intelligence devices) to the planner.
/// Free, offline, no key. Tools are defined in JavaScript: each call is sent to JS as an `onToolCall`
/// event and the answer comes back through `resolveToolCall`, so all facts come from the shared
/// TypeScript tools. Private Cloud Compute is deliberately never used (quotas; not zero-cost).
public class OnDeviceLlmModule: Module {
  private var pending: [String: CheckedContinuation<String, Never>] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("OnDeviceLlm")
    Events("onToolCall")

    AsyncFunction("availability") { () -> [String: String] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
          return ["engine": "apple", "status": "available"]
        case .unavailable(let reason):
          switch reason {
          case .deviceNotEligible: return ["engine": "apple", "status": "unavailable", "reason": "deviceNotEligible"]
          case .appleIntelligenceNotEnabled: return ["engine": "apple", "status": "unavailable", "reason": "appleIntelligenceNotEnabled"]
          case .modelNotReady: return ["engine": "apple", "status": "downloading", "reason": "modelNotReady"]
          @unknown default: return ["engine": "apple", "status": "unavailable", "reason": "unknown"]
          }
        }
      }
      #endif
      return ["engine": "apple", "status": "unavailable", "reason": "osTooOld"]
    }

    /// One planner turn. `toolsJson` is an array of { name, description, parameters: JSON Schema (flat) }.
    AsyncFunction("respond") { (requestId: String, instructions: String, prompt: String, toolsJson: String) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return try await self.respond(requestId: requestId, instructions: instructions, prompt: prompt, toolsJson: toolsJson)
      }
      #endif
      throw BridgeError.unavailable
    }

    Function("resolveToolCall") { (callId: String, result: String) in
      self.resume(callId, with: result)
    }
  }

  private func resume(_ callId: String, with result: String) {
    lock.lock()
    let c = pending.removeValue(forKey: callId)
    lock.unlock()
    c?.resume(returning: result)
  }

  /// Ask JS to run a tool and wait for its answer (30 s timeout so a stuck call can't hang the turn).
  fileprivate func callJs(requestId: String, name: String, argsJson: String) async -> String {
    let callId = UUID().uuidString
    return await withCheckedContinuation { (c: CheckedContinuation<String, Never>) in
      lock.lock()
      pending[callId] = c
      lock.unlock()
      sendEvent("onToolCall", ["requestId": requestId, "callId": callId, "name": name, "argsJson": argsJson])
      Task {
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        self.resume(callId, with: "The tool timed out.")
      }
    }
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  private func respond(requestId: String, instructions: String, prompt: String, toolsJson: String) async throws -> String {
    guard case .available = SystemLanguageModel.default.availability else { throw BridgeError.unavailable }
    let specs = (try? JSONSerialization.jsonObject(with: Data(toolsJson.utf8))) as? [[String: Any]] ?? []
    var tools: [any Tool] = []
    for spec in specs {
      guard let name = spec["name"] as? String, let description = spec["description"] as? String else { continue }
      let schema = try Self.schema(name: name, parameters: spec["parameters"] as? [String: Any] ?? [:])
      tools.append(BridgedTool(name: name, description: description, parameters: schema) { [weak self] args in
        await self?.callJs(requestId: requestId, name: name, argsJson: args) ?? "The planner is closed."
      })
    }
    let session = LanguageModelSession(tools: tools, instructions: instructions)
    do {
      return try await session.respond(to: prompt).content
    } catch {
      // iOS 26 throws LanguageModelSession.GenerationError; iOS 27 adds LanguageModelError and friends.
      // Match both families by case name so this builds with either SDK.
      let text = String(describing: error)
      if text.contains("exceededContextWindowSize") || text.contains("contextSizeExceeded") { throw BridgeError.contextFull }
      if text.contains("guardrailViolation") || text.contains("refusal") { throw BridgeError.declined }
      if text.contains("rateLimited") || text.contains("concurrentRequests") { throw BridgeError.busy }
      if text.contains("unsupportedLanguageOrLocale") { throw BridgeError.language }
      throw error
    }
  }

  /// Flat JSON Schema (string / number / integer / boolean, optional enum) → a runtime GenerationSchema.
  @available(iOS 26.0, *)
  private static func schema(name: String, parameters: [String: Any]) throws -> GenerationSchema {
    let props = parameters["properties"] as? [String: [String: Any]] ?? [:]
    let required = Set(parameters["required"] as? [String] ?? [])
    var properties: [DynamicGenerationSchema.Property] = []
    for (key, p) in props.sorted(by: { $0.key < $1.key }) {
      let desc = p["description"] as? String
      let s: DynamicGenerationSchema
      if let choices = p["enum"] as? [String], !choices.isEmpty {
        s = DynamicGenerationSchema(name: "\(name)_\(key)", description: desc, anyOf: choices)
      } else {
        switch p["type"] as? String {
        case "number": s = DynamicGenerationSchema(type: Double.self)
        case "integer": s = DynamicGenerationSchema(type: Int.self)
        case "boolean": s = DynamicGenerationSchema(type: Bool.self)
        default: s = DynamicGenerationSchema(type: String.self)
        }
      }
      properties.append(.init(name: key, description: desc, schema: s, isOptional: !required.contains(key)))
    }
    let root = DynamicGenerationSchema(name: "\(name)_args", description: nil, properties: properties)
    return try GenerationSchema(root: root, dependencies: [])
  }
  #endif
}

#if canImport(FoundationModels)
/// A tool defined at runtime: arguments arrive as GeneratedContent and go to JS as JSON.
/// (Enum choices aren't enforced for tool arguments, so the JS tools validate every argument.)
@available(iOS 26.0, *)
struct BridgedTool: Tool {
  typealias Arguments = GeneratedContent
  typealias Output = String
  let name: String
  let description: String
  let parameters: GenerationSchema
  let invoke: @Sendable (String) async -> String

  init(name: String, description: String, parameters: GenerationSchema, invoke: @escaping @Sendable (String) async -> String) {
    self.name = name
    self.description = description
    self.parameters = parameters
    self.invoke = invoke
  }

  func call(arguments: GeneratedContent) async throws -> String {
    await invoke(arguments.jsonString)
  }
}
#endif

enum BridgeError: Error, LocalizedError {
  case unavailable, contextFull, declined, busy, language
  var errorDescription: String? {
    switch self {
    case .unavailable: return "unavailable: Apple Intelligence isn't available on this device"
    case .contextFull: return "contextFull: the conversation is too long for the on-device model"
    case .declined: return "declined: the on-device model declined to answer"
    case .busy: return "busy: the on-device model is busy; try again in a moment"
    case .language: return "language: this language isn't supported by the on-device model"
    }
  }
}
