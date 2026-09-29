package app.plotwright.ondevicellm

import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Gemini Nano through ML Kit's GenAI Prompt API (beta) for the AI planner. On-device and free; runs
 * only while the app is in the foreground. The Prompt API has no production tool calling yet, so the
 * planner runs its tool loop in JS with a JSON protocol and this module only generates text.
 */
class OnDeviceLlmModule : Module() {
  private var model: GenerativeModel? = null
  private fun client(): GenerativeModel = model ?: Generation.getClient().also { model = it }

  override fun definition() = ModuleDefinition {
    Name("OnDeviceLlm")
    Events("onDownloadProgress")

    AsyncFunction("availability") Coroutine { ->
      try {
        when (client().checkStatus()) {
          FeatureStatus.AVAILABLE -> mapOf("engine" to "gemini-nano", "status" to "available")
          FeatureStatus.DOWNLOADABLE -> mapOf("engine" to "gemini-nano", "status" to "downloadable")
          FeatureStatus.DOWNLOADING -> mapOf("engine" to "gemini-nano", "status" to "downloading")
          else -> mapOf("engine" to "gemini-nano", "status" to "unavailable", "reason" to "deviceNotSupported")
        }
      } catch (e: Exception) {
        mapOf("engine" to "gemini-nano", "status" to "unavailable", "reason" to (e.message ?: "error"))
      }
    }

    /** Download the model (AICore manages it; it's shared with other apps). Returns true when ready. */
    AsyncFunction("download") Coroutine { ->
      var ok = false
      client().download().collect { s ->
        when (s) {
          is DownloadStatus.DownloadStarted -> sendEvent("onDownloadProgress", mapOf("bytes" to 0L))
          is DownloadStatus.DownloadProgress -> sendEvent("onDownloadProgress", mapOf("bytes" to s.totalBytesDownloaded))
          is DownloadStatus.DownloadCompleted -> ok = true
          is DownloadStatus.DownloadFailed -> throw IllegalStateException("download: the on-device model couldn't be downloaded")
          else -> {}
        }
      }
      ok
    }

    AsyncFunction("generate") Coroutine { system: String, prompt: String, maxOutputTokens: Int, temperature: Double ->
      // Instructions go first in the prompt (portable across Prompt API versions).
      val req = generateContentRequest(TextPart("$system\n\n$prompt")) {
        this.temperature = temperature.toFloat()
        topK = 10
        this.maxOutputTokens = maxOutputTokens
      }
      try {
        client().generateContent(req).candidates.firstOrNull()?.text ?: ""
      } catch (e: GenAiException) {
        // Map the codes the planner can explain: 9 BUSY, 12 REQUEST_TOO_LARGE, 27 battery quota, 30 background.
        val code = e.errorCode
        throw IllegalStateException(
          when (code) {
            9, 27 -> "busy: the on-device model is busy; try again in a moment"
            12 -> "contextFull: the conversation is too long for the on-device model"
            30 -> "background: the on-device model only works while the app is open"
            else -> "error: ${e.message ?: code.toString()}"
          },
        )
      }
    }

    OnDestroy { model?.close(); model = null }
  }
}
