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

/** Keyword routes, in priority order (actions first, then the facts they need). Whole words only. */
const ROUTES: Array<[RegExp, string]> = [
  [/\b(add|place|put|map|design|build|where should)\b/, 'propose_design_changes'],
  [/\b(tasks?|to-?dos?|remind(er)?s?|schedule|when should|calendar)\b/, 'create_tasks'],
  [/\b(enough|self[- ]?suffic\w*|calories?|nutrients?|protein|vitamins?|feed (us|our|my)|how much of our food)\b/, 'estimate_food_coverage'],
  [/\b(grow|plant|plants|crops?|vegetables?|fruits?|trees?|beds?|suit\w*|sun|soil)\b/, 'get_plant_suitability'],
  [/(\$|\b(cost|costs|budget|price|afford|spend|money)\b)/, 'estimate_budget'],
  [/\b(sell|income|business|markets?|profit|earn|enterprises?)\b/, 'lookup_enterprise_profile'],
  [/\b(yield|harvest|how (much|many)|pounds|lbs?|eggs|honey|milk)\b/, 'estimate_yield'],
  [/\b(parcel|land|property|acres?|zone|frost|slope|flood|climate|site)\b/, 'get_site_profile'],
  [/\b(sensors?|soil temp\w*|readings?|station|rain|water)\b/, 'get_sensor_summary'],
  [/\b(already|existing|current (design|layout)|what('s| is) on)\b/, 'get_design'],
];

/** Which tools this message plausibly needs: the core ones first, then keyword matches by priority. */
export function toolsForTurn(text: string, ctx: PlannerContext): Tool[] {
  const t = text.toLowerCase();
  const order: string[] = ['update_goals'];
  const ready = readyToPlan(ctx.goals());
  if (ready) order.push('make_plan');
  else order.push('get_site_profile');
  for (const [re, name] of ROUTES) if (re.test(t) && !order.includes(name)) order.push(name);
  // Tier gates: tools the plan doesn't include are not offered at all.
  const gated = new Set<string>();
  if (!ctx.tier.full) gated.add('propose_design_changes').add('create_tasks');
  if (!ctx.tier.income) gated.add('lookup_enterprise_profile');
  if (!ctx.tier.multiYear) gated.add('estimate_budget');
  return order.filter((n) => !gated.has(n)).slice(0, MAX_TOOLS_PER_TURN).map((n) => TOOLS.find((x) => x.name === n)!).filter(Boolean);
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

const YEAR_BEFORE = /\b(in|by|since|until|from|year|spring|summer|fall|autumn|winter|of)\s*$/i;

/**
 * Figures in a reply that don't appear in the evidence (the user's words, the saved profile and tool
 * results; never the model's own earlier replies or arguments). Small counts are ignored, and 1990–2100
 * only counts as a year after a date word ("in 2027").
 */
export function unverifiedNumbers(reply: string, evidence: string[]): string[] {
  const known = new Set<string>();
  for (const e of evidence) for (const m of e.match(NUM_RE) ?? []) known.add(normNum(m));
  const out: string[] = [];
  for (const m of reply.matchAll(NUM_RE)) {
    const n = normNum(m[0]);
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 12) continue;
    const isYear = v >= 1990 && v <= 2100 && !m[0].includes('$') && !m[0].includes(',') && YEAR_BEFORE.test(reply.slice(Math.max(0, m.index! - 12), m.index!));
    if (isYear) continue;
    if (!known.has(n)) out.push(m[0]);
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

/** Parse one balanced {...} starting at `start`, tolerating raw newlines/tabs inside strings. */
function parseObjectAt(text: string, start: number): Record<string, unknown> | null {
  let depth = 0, inStr = false, esc = false, out = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      out += ch === '\n' ? '\\n' : ch === '\r' ? '' : ch === '\t' ? '\\t' : ch;
      continue;
    }
    out += ch;
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        const v = JSON.parse(out);
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Pull a JSON object out of a model's text. Models wrap JSON in prose or code fences, put braces in the
 * prose, or break lines inside strings; each "{" is tried in turn.
 */
export function extractJson(text: string): Record<string, unknown> | null {
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    const v = parseObjectAt(text, i);
    if (v && ('say' in v || 'tool' in v)) return v;
  }
  // Last resort: a "say" value in otherwise broken JSON.
  const m = /"say"\s*:\s*"((?:[^"\\]|\\.)*)"/s.exec(text);
  return m ? { say: m[1]!.replace(/\\n/g, '\n').replace(/\\"/g, '"') } : null;
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

  let queue: Promise<unknown> = Promise.resolve();
  if (model.kind === 'native-tools') {
    const prompt = [context, past && `Recent conversation:\n${past}`, `User: ${userText}`].filter(Boolean).join('\n\n');
    reply = await model.respond({
      instructions: PLANNER_INSTRUCTIONS,
      prompt,
      tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      // The model may call tools in parallel; run them one at a time so two update_goals calls can't
      // both start from the old profile.
      callTool: (name, argsJson) => {
        const run = queue.then(async () => {
          if (calls.length >= MAX_TOOL_STEPS * 2) return 'Tool limit reached for this turn; answer with what you have.';
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(argsJson || '{}'); } catch { /* keep empty */ }
          return runTool(ctx, tools, name, args, calls);
        });
        queue = run.catch(() => undefined);
        return run;
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
  // Evidence: what the user said, the saved profile and tool results; never the model's own words.
  const evidence = [userText, ...history.filter((h) => h.role === 'user').map((h) => h.text), summarizeGoals(ctx.goals()), ...calls.map((c) => c.result)];
  const unverified = screened.replaced ? [] : unverifiedNumbers(screened.reply, evidence);
  let final = screened.reply;
  if (unverified.length) final += `\n\n(Check: ${unverified.join(', ')} didn’t come from the app’s data; treat ${unverified.length === 1 ? 'it' : 'them'} as unverified.)`;
  return { reply: final, toolCalls: calls, safety: screened.replaced, unverifiedNumbers: unverified, model: model.name };
}
