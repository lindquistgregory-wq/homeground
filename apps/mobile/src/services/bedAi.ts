/**
 * "Suggest with AI" for a bed. The phone's own AI model (Apple Intelligence, Gemini Nano) is used
 * where there is one, free and on the phone; otherwise the owner's own Claude API key, if they added
 * one in Settings (billed to them by Anthropic, never to us). Either way the model only sees the
 * bed's conditions, its plants and the candidate list, and its picks are checked against that list
 * (validateAiSetup) before they're shown. With neither, the built-in suggestions are all there is.
 */
import Anthropic from '@anthropic-ai/sdk';
import { bedSetupFacts, screenReply, validateAiSetup, type BedSetupInput, type BedSetupPick } from '@plotwright/core';
import { onDeviceModel } from '@plotwright/ondevice-llm';
import * as SecureStore from 'expo-secure-store';

const KEY = 'ai.claudeApiKey';
/** The current Claude model; low effort keeps a short JSON answer quick and cheap for the key owner. */
// A small structured pick from a short candidate list: a mid-size model does it well at a fraction of
// the cost to the user's own key.
const CLAUDE_MODEL = 'claude-sonnet-5-5';

export type AiSource = 'device' | 'claude';

export async function getClaudeKey(): Promise<string | undefined> {
  return (await SecureStore.getItemAsync(KEY)) ?? undefined;
}
export async function setClaudeKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, key.trim(), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}
export async function deleteClaudeKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** Which AI would answer: the phone's own model first (free), then the owner's Claude key. */
export async function aiSource(): Promise<AiSource | null> {
  try { if (await onDeviceModel()) return 'device'; } catch { /* no on-device model */ }
  return (await getClaudeKey()) ? 'claude' : null;
}

const SYSTEM = [
  'You help a home gardener choose what to plant together in one garden bed.',
  'Pick 2 to 4 plants from the candidate list only, using their ids exactly. Consider what is already in the bed, the homestead plan, companion pairings, feeder groups (mix heavy feeders with light feeders or legumes), similar water needs, one growing season, and rotation (avoid the family grown there last year).',
  'Never pick a plant listed as "keep away from" something already chosen or in the bed.',
  'For each pick give one short plain sentence why. Add one short note for the gardener. Do not give pesticide, fertiliser-rate or medical advice.',
  'Reply with JSON only: {"picks":[{"plantId":"…","why":"…"}],"note":"…"}.',
].join(' ');

const SCHEMA = {
  type: 'object',
  properties: {
    picks: { type: 'array', items: { type: 'object', properties: { plantId: { type: 'string' }, why: { type: 'string' } }, required: ['plantId', 'why'], additionalProperties: false } },
    note: { type: 'string' },
  },
  required: ['picks', 'note'],
  additionalProperties: false,
} as const;

/** The first JSON object in a model's text reply. */
function parseJson(text: string): unknown {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function askClaude(apiKey: string, prompt: string): Promise<unknown> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  try {
    const res = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      // If the model declines, Anthropic re-runs the request on its recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this request. Try the built-in suggestions.');
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return parseJson(text);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Your Claude API key was not accepted. Check it in Settings.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Your Claude account is rate-limited right now. Try again in a minute.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Couldn’t reach Claude. Check your connection.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude returned an error (${e.status ?? 'unknown'}).`);
    throw e;
  }
}

export interface AiSetupResult {
  picks: BedSetupPick[];
  note?: string;
  source: AiSource;
}

export async function aiBedSetup(input: BedSetupInput, conditions: string[]): Promise<AiSetupResult> {
  const { facts, candidates } = bedSetupFacts(input, conditions);
  if (!candidates.length) throw new Error('No plants suit this bed well enough to choose from.');
  const prompt = `Facts:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nCandidates (id: details):\n${candidates.map((c) => `- ${c}`).join('\n')}`;

  let raw: unknown = null;
  let source: AiSource;
  const model = await onDeviceModel().catch(() => null);
  if (model) {
    source = 'device';
    const text = model.kind === 'text'
      ? await model.generate({ system: SYSTEM, prompt, maxOutputTokens: 500, temperature: 0.2 })
      : await model.respond({ instructions: SYSTEM, prompt, tools: [], callTool: async () => '' });
    raw = parseJson(text);
  } else {
    const key = await getClaudeKey();
    if (!key) throw new Error('No AI is set up. This phone has no on-device AI; add your own Claude API key in Settings, or use the built-in suggestions.');
    source = 'claude';
    raw = await askClaude(key, prompt);
  }
  const picks = validateAiSetup(raw, input);
  if (!picks) throw new Error('The AI’s answer didn’t fit this bed. The built-in suggestions are shown instead.');
  const note = typeof (raw as { note?: unknown })?.note === 'string' ? screenReply(String((raw as { note: string }).note).slice(0, 300)).reply : undefined;
  return { picks: picks.map((p) => ({ ...p, reasons: p.reasons.map((r) => screenReply(r).reply) })), note: note || undefined, source };
}
