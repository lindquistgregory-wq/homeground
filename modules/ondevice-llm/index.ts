/**
 * Free on-device language models for the AI planner (§9.1): Apple Foundation Models on iOS 26+ with
 * Apple Intelligence (tool calling bridged to the shared TypeScript tools), and Gemini Nano via the ML
 * Kit GenAI Prompt API on supported Android phones (text only; the planner's JSON protocol runs the
 * tools). Everything runs on the phone: no network, no key, no cost. Other devices use the rules-based
 * planner.
 */
import type { NativeToolModel, PlannerModel, TextModel, ToolSpec } from '@plotwright/core';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface ModelAvailability {
  engine: 'apple' | 'gemini-nano';
  status: 'available' | 'downloadable' | 'downloading' | 'unavailable';
  reason?: string;
}

interface Subscription { remove(): void }

interface OnDeviceLlmNative {
  availability(): Promise<ModelAvailability>;
  download?(): Promise<boolean>;
  respond?(requestId: string, instructions: string, prompt: string, toolsJson: string): Promise<string>;
  resolveToolCall?(callId: string, result: string): void;
  generate?(system: string, prompt: string, maxOutputTokens: number, temperature: number): Promise<string>;
  addListener(event: 'onToolCall', cb: (e: { requestId: string; callId: string; name: string; argsJson: string }) => void): Subscription;
  addListener(event: 'onDownloadProgress', cb: (e: { bytes: number }) => void): Subscription;
}

export const OnDeviceLlmModule = requireOptionalNativeModule<OnDeviceLlmNative>('OnDeviceLlm');

export async function modelAvailability(): Promise<ModelAvailability | null> {
  if (!OnDeviceLlmModule) return null;
  try {
    return await OnDeviceLlmModule.availability();
  } catch {
    return null;
  }
}

/** Download Gemini Nano on Android (Apple manages its model itself). */
export async function downloadModel(onBytes?: (bytes: number) => void): Promise<boolean> {
  const m = OnDeviceLlmModule;
  if (!m?.download) return false;
  const sub = onBytes ? m.addListener('onDownloadProgress', (e) => onBytes(e.bytes)) : undefined;
  try {
    return await m.download();
  } finally {
    sub?.remove();
  }
}

let seq = 0;

/** The planner model for this device, or null when only the rules-based planner can run. */
export async function onDeviceModel(): Promise<PlannerModel | null> {
  const m = OnDeviceLlmModule;
  const a = await modelAvailability();
  if (!m || !a || a.status !== 'available') return null;
  if (a.engine === 'apple' && m.respond && m.resolveToolCall) {
    const model: NativeToolModel = {
      kind: 'native-tools',
      name: 'Apple Foundation Models (on-device)',
      async respond({ instructions, prompt, tools, callTool }: { instructions: string; prompt: string; tools: ToolSpec[]; callTool(name: string, argsJson: string): Promise<string> }) {
        const requestId = `r${Date.now()}-${++seq}`;
        const sub = m.addListener('onToolCall', (e) => {
          if (e.requestId !== requestId) return;
          callTool(e.name, e.argsJson)
            .catch((err: Error) => `Tool error: ${err.message}`)
            .then((result) => m.resolveToolCall!(e.callId, result));
        });
        try {
          return await m.respond!(requestId, instructions, prompt, JSON.stringify(tools));
        } finally {
          sub.remove();
        }
      },
    };
    return model;
  }
  if (a.engine === 'gemini-nano' && m.generate) {
    const model: TextModel = {
      kind: 'text',
      name: 'Gemini Nano (on-device)',
      generate: ({ system, prompt, maxOutputTokens, temperature }) => m.generate!(system, prompt, maxOutputTokens, temperature),
    };
    return model;
  }
  return null;
}

/** A plain-language reason for why the AI chat isn't available, for the planner screen. */
export function unavailableReason(a: ModelAvailability | null): string {
  if (!a) return 'This device doesn’t have a built-in AI model, so the planner uses guided questions instead. It works the same way and gives the same plan.';
  switch (a.reason) {
    case 'appleIntelligenceNotEnabled': return 'Turn on Apple Intelligence in Settings to chat with the planner. Until then, it uses guided questions.';
    case 'deviceNotEligible': return 'This iPhone doesn’t support Apple Intelligence, so the planner uses guided questions instead.';
    case 'osTooOld': return 'The AI chat needs iOS 26 or later. The planner uses guided questions instead.';
    case 'modelNotReady': return 'Apple’s on-device model is still downloading. The planner uses guided questions until it’s ready.';
    default:
      return a.status === 'downloadable' ? 'The on-device model can be downloaded (free, over Wi-Fi recommended).' : 'The on-device AI isn’t available on this phone, so the planner uses guided questions instead.';
  }
}
