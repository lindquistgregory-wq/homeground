/**
 * Planner turns with an on-device model (§9.1): the model does conversation, routing and summarising;
 * every fact comes from the local tools. Works with models that call tools natively (Apple Foundation
 * Models) and with text-only models (Gemini Nano via ML Kit's Prompt API) through a small JSON protocol.
 *
 * Small-model limits shape everything here: ~4,096 tokens of context, so the instructions are short, the
 * conversation is summarised into the goals profile, only the last few turns are sent, only the tools a
 * turn needs are offered, and tool results are clipped. Replies are screened for safety topics and for
 * numbers that didn't come from a tool.
 */
import { summarizeGoals } from './goals';
import { nextQuestions, readyToPlan } from './interview';
import { SAFETY_REPLY, safetyTopic, screenReply, type SafetyTopic } from './safety';
import { TOOLS, type PlannerContext, type Tool, type ToolSpec } from './tools';

/** §9.3 starter instructions, kept short for small models. */
export const PLANNER_INSTRUCTIONS = [
  'You are the Homestead Planner. Help the user design a homestead that fits their life, land, and climate.',
  'Use tools for all facts about their parcel, plants, yields, costs, and enterprises. Never invent numbers; if a tool has no data, say so.',
  'First learn: household size and diet, weekly hours available, budget, physical limits, experience, goals (food, savings, income, lifestyle, ecology), and rules (HOA/zoning, animals allowed).',
  'Ask at most 3 questions at a time. Save answers with update_goals. Summarize what you learned and ask the user to confirm.',
  'Recommend phased, realistic plans matched to their time and money. Prefer low-input systems that suit the site.',
  'If they want income, compare small enterprises using lookup_enterprise_profile and remind them to check local regulations. Estimates are rough, not financial or legal advice.',
  'Propose design or calendar changes as drafts for approval. Keep replies short.',
].join('\n');

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

/** A model that can call tools itself (Foundation Models). `callTool` runs a local tool. */
export interface NativeToolModel {
  kind: 'native-tools';
  name: string;
  respond(req: { instructions: string; prompt: string; tools: ToolSpec[]; callTool(name: string, argsJson: string): Promise<string> }): Promise<string>;
}

/** A text-in, text-out model (Gemini Nano). */
export interface TextModel {
  kind: 'text';
  name: string;
  generate(req: { system: string; prompt: string; maxOutputTokens: number; temperature: number }): Promise<string>;
}

export type PlannerModel = NativeToolModel | TextModel;

export interface TurnResult {
  reply: string;
  toolCalls: ToolCallRecord[];
  safety?: SafetyTopic;
  /** Figures in the reply that no tool, the profile or the user supplied. */
  unverifiedNumbers: string[];
  model: string;
}

const MAX_HISTORY_TURNS = 3;
const MAX_TURN_CHARS = 400;
const MAX_TOOL_STEPS = 4;
const MAX_TOOLS_PER_TURN = 6;

/** Rough token estimate for budgeting (English averages ~4 characters per token). */
export const approxTokens = (s: string) => Math.ceil(s.length / 4);

/** Which tools this message plausibly needs, most relevant first (always including the core ones). */
export function toolsForTurn(text: string, ctx: PlannerContext): Tool[] {
  const t = text.toLowerCase();
  const want = new Set<string>(['update_goals']);
  const ready = readyToPlan(ctx.goals());
  if (ready) want.add('make_plan');
  const add = (re: RegExp, name: string) => { if (re.test(t)) want.add(name); };
  add(/grow|plant|crop|vegetable|fruit|tree|bed|suit|sun|soil/, 'get_plant_suitability');
  add(/cost|budget|price|\$|afford|spend|money/, 'estimate_budget');
  add(/sell|income|business|market|profit|earn|enterprise/, 'lookup_enterprise_profile');
  add(/add|place|put|map|design|build|where should/, 'propose_design_changes');
  add(/task|to-?do|remind|schedule|when should|calendar/, 'create_tasks');
  add(/yield|harvest|how (much|many)|pounds|lb|eggs|honey|milk/, 'estimate_yield');
  add(/enough|self[- ]?suffic|calorie|nutrient|protein|vitamin|feed (us|our|my)|how much of our food/, 'estimate_food_coverage');
  add(/sensor|soil temp|reading|station|frost|rain|water/, 'get_sensor_summary');
  add(/parcel|land|property|acre|zone|frost|slope|flood|climate|site/, 'get_site_profile');
  add(/already|existing|current (design|layout)|what('s| is) on/, 'get_design');
  if (!ready) want.add('get_site_profile');
  // Tier gates: tools the plan doesn't include are not offered at all.
  if (!ctx.tier.full) { want.delete('propose_design_changes'); want.delete('create_tasks'); }
  if (!ctx.tier.income) want.delete('lookup_enterprise_profile');
  if (!ctx.tier.multiYear) want.delete('estimate_budget');
  return TOOLS.filter((x) => want.has(x.name)).slice(0, MAX_TOOLS_PER_TURN);
}

function contextBlock(ctx: PlannerContext): string {
  const g = ctx.goals();
  const lines = [`Profile so far: ${summarizeGoals(g)}`];
  if (!readyToPlan(g)) lines.push(`Still to learn (ask up to 3): ${nextQuestions(g).map((q) => q.ask).join(' | ')}`);
  else if (!g.confirmedAt) lines.push('You have enough to plan. Summarize the profile and ask the user to confirm before recommending.');
  else lines.push('The profile is confirmed. Use make_plan and the other tools to answer.');
  if (!ctx.tier.multiYear) lines.push('This plan tier covers years 0-1 and no cost figures.');
  return lines.join('\n');
}

function historyBlock(history: ChatMessage[]): string {
  return history.slice(-MAX_HISTORY_TURNS * 2).map((m) => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.text.length > MAX_TURN_CHARS ? `${m.text.slice(0, MAX_TURN_CHARS)}…` : m.text}`).join('\n');
}

const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const normNum = (s: string) => s.replace(/[$,%]/g, '').replace(/\.0+$/, '');

/** Figures in a reply that don't appear in the evidence (tool results, profile, conversation). Small counts are ignored. */
export function unverifiedNumbers(reply: string, evidence: string[]): string[] {
  const known = new Set<string>();
  for (const e of evidence) for (const m of e.match(NUM_RE) ?? []) known.add(normNum(m));
  const out: string[] = [];
  for (const m of reply.match(NUM_RE) ?? []) {
    const n = normNum(m);
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 12 || (v >= 1990 && v <= 2100 && !m.includes('$'))) continue; // counts, years
    if (!known.has(n)) out.push(m);
  }
  return [...new Set(out)];
}

async function runTool(ctx: PlannerContext, allowed: Tool[], name: string, args: Record<string, unknown>, calls: ToolCallRecord[]): Promise<string> {
  const tool = allowed.find((t) => t.name === name);
  let result: string;
  if (!tool) result = `No tool named ${name}. Available: ${allowed.map((t) => t.name).join(', ')}.`;
  else {
    try {
      result = await tool.run(ctx, args ?? {});
    } catch (e) {
      result = `Tool error: ${(e as Error).message}`;
    }
  }
  calls.push({ name, args, result });
  return result;
}

/** Pull the first JSON object out of a model's text (models often wrap JSON in prose or code fences). */
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        const v = JSON.parse(text.slice(start, i + 1));
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function textToolProtocol(tools: Tool[]): string {
  const sig = tools.map((t) => {
    const args = Object.entries(t.parameters.properties).map(([k, p]) => `${k}${p.enum ? `=${p.enum.join('|')}` : `:${p.type}`}`).join(', ');
    return `- ${t.name}(${args}): ${t.description}`;
  });
  return [
    'Reply with ONE JSON object and nothing else.',
    'To use a tool: {"tool": "<name>", "args": {...}}',
    'To answer the user: {"say": "<your reply>"}',
    'Tools:', ...sig,
  ].join('\n');
}

/**
 * One planner turn. Safety questions get a fixed answer without the model; otherwise the model answers
 * using tools, and its reply is screened before it's shown.
 */
export async function plannerTurn(model: PlannerModel, ctx: PlannerContext, history: ChatMessage[], userText: string): Promise<TurnResult> {
  const topic = safetyTopic(userText);
  if (topic) return { reply: SAFETY_REPLY[topic], toolCalls: [], safety: topic, unverifiedNumbers: [], model: 'safety-rules' };

  const tools = toolsForTurn(userText, ctx);
  const calls: ToolCallRecord[] = [];
  const context = contextBlock(ctx);
  const past = historyBlock(history);
  let reply: string;

  if (model.kind === 'native-tools') {
    const prompt = [context, past && `Recent conversation:\n${past}`, `User: ${userText}`].filter(Boolean).join('\n\n');
    reply = await model.respond({
      instructions: PLANNER_INSTRUCTIONS,
      prompt,
      tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      callTool: async (name, argsJson) => {
        if (calls.length >= MAX_TOOL_STEPS * 2) return 'Tool limit reached for this turn; answer with what you have.';
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(argsJson || '{}'); } catch { /* keep empty */ }
        return runTool(ctx, tools, name, args, calls);
      },
    });
  } else {
    const system = `${PLANNER_INSTRUCTIONS}\n\n${textToolProtocol(tools)}`;
    let scratch = [context, past && `Recent conversation:\n${past}`, `User: ${userText}`].filter(Boolean).join('\n\n');
    reply = '';
    for (let step = 0; step <= MAX_TOOL_STEPS; step++) {
      const out = await model.generate({ system, prompt: scratch, maxOutputTokens: 400, temperature: 0.2 });
      let msg = extractJson(out);
      if (!msg) {
        // One reminder, then accept plain text as the answer.
        const retry = await model.generate({ system, prompt: `${scratch}\n\n(Reply with one JSON object only.)`, maxOutputTokens: 400, temperature: 0 });
        msg = extractJson(retry);
        if (!msg) { reply = out.trim(); break; }
      }
      if (typeof msg.say === 'string') { reply = msg.say; break; }
      if (typeof msg.tool === 'string' && step < MAX_TOOL_STEPS) {
        const args = msg.args && typeof msg.args === 'object' ? (msg.args as Record<string, unknown>) : {};
        const result = await runTool(ctx, tools, msg.tool, args, calls);
        scratch += `\n\nTool ${msg.tool} returned:\n${result}`;
        continue;
      }
      reply = typeof msg.say === 'string' ? msg.say : 'I couldn’t finish that. Could you ask in a different way?';
      break;
    }
  }

  const screened = screenReply(reply.trim() || 'Sorry, I didn’t catch that. Could you rephrase?');
  const evidence = [userText, ...history.map((h) => h.text), summarizeGoals(ctx.goals()), ...calls.map((c) => c.result), ...calls.map((c) => JSON.stringify(c.args))];
  const unverified = screened.replaced ? [] : unverifiedNumbers(screened.reply, evidence);
  let final = screened.reply;
  if (unverified.length) final += `\n\n(Check: ${unverified.join(', ')} didn’t come from the app’s data; treat ${unverified.length === 1 ? 'it' : 'them'} as unverified.)`;
  return { reply: final, toolCalls: calls, safety: screened.replaced, unverifiedNumbers: unverified, model: model.name };
}
