/**
 * Herd Book explanations (prompt §7): the on-device model only explains results the deterministic
 * math in core `livestock/breeding.ts` already produced, and answers questions about the user's own
 * records. Nothing leaves the phone; health questions get the planner's "ask your vet" reply; with
 * no on-device model, the written explanation is shown instead.
 */
import { SAFETY_REPLY, safetyTopic, screenReply } from '@plotwright/core';
import { onDeviceModel } from '@plotwright/ondevice-llm';

const SYSTEM = [
  'You explain livestock breeding results from a farm records app to the owner, in two to four plain sentences.',
  'Use only the facts given. Do not add numbers, breeds, products or claims that are not in the facts.',
  'Inbreeding (COI) limits are a precaution, not a guarantee. Never give veterinary, medical, medication or dosing advice; for any health question say to ask their veterinarian.',
].join(' ');

export async function askHerdBook(question: string, facts: string[], fallback: string): Promise<{ reply: string; source: 'model' | 'written' | 'safety' }> {
  const topic = safetyTopic(question);
  if (topic) return { reply: SAFETY_REPLY[topic], source: 'safety' };
  let model = null;
  try { model = await onDeviceModel(); } catch { model = null; }
  if (!model) return { reply: fallback, source: 'written' };
  const prompt = `Facts:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nQuestion: ${question}`;
  try {
    const raw = model.kind === 'text'
      ? await model.generate({ system: SYSTEM, prompt, maxOutputTokens: 260, temperature: 0.2 })
      : await model.respond({ instructions: SYSTEM, prompt, tools: [], callTool: async () => '' });
    const screened = screenReply(raw.trim());
    return { reply: screened.reply || fallback, source: screened.replaced ? 'safety' : 'model' };
  } catch {
    return { reply: fallback, source: 'written' };
  }
}
