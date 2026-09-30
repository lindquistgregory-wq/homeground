/** Planner UI pieces: guided interview, chat, plan view, drafts and tasks. */
import {
  NUTRIENT_KEYS, NUTRIENT_LABEL, PHASE_TITLE, QUESTIONS, interviewProgress, mergeGoals, moneyRange, nextQuestions, pct, readyToPlan, rng, summarizeGoals,
  type Activity, type DesignDraft, type HomesteadGoals, type HomesteadPlan, type HouseholdMember, type PhaseId, type PlanItem, type Question, type TaskDraft,
} from '@plotwright/core';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DraftRow, StoredMessage, TaskRecord } from '../db/planner';
import { Chip } from './plants';
import { Body, Button, Card, useTheme } from './ui';

// ---------------- Guided interview ----------------

const ACTIVITY: Array<[Activity, string]> = [['sedentary', 'Mostly sitting'], ['moderatelyActive', 'Moderately active'], ['active', 'Very active']];

function HouseholdInput({ value, onChange }: { value: HouseholdMember[]; onChange: (v: HouseholdMember[]) => void }) {
  const t = useTheme();
  const set = (i: number, patch: Partial<HouseholdMember>) => onChange(value.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  return (
    <View>
      {value.map((m, i) => (
        <View key={i} style={[styles.member, { borderColor: t.border }]}>
          <View style={styles.row}>
            <TextInput value={String(m.age)} keyboardType="number-pad" accessibilityLabel={`Person ${i + 1} age`} onChangeText={(v) => set(i, { age: Math.max(0, Math.min(110, Number(v.replace(/\D/g, '')) || 0)) })}
              style={[styles.ageInput, { color: t.text, borderColor: t.border }]} />
            <Text style={{ color: t.muted }}>years</Text>
            <Chip label="Male" active={m.sex === 'male'} onPress={() => set(i, { sex: 'male' })} />
            <Chip label="Female" active={m.sex === 'female'} onPress={() => set(i, { sex: 'female' })} />
          </View>
          <View style={styles.wrap}>
            {ACTIVITY.map(([a, l]) => <Chip key={a} label={l} active={m.activity === a} onPress={() => set(i, { activity: a })} />)}
            {m.sex === 'female' && m.age >= 14 && m.age <= 50 && <Chip label="Pregnant" active={!!m.pregnant} onPress={() => set(i, { pregnant: !m.pregnant })} />}
            {m.sex === 'female' && m.age >= 14 && m.age <= 50 && <Chip label="Breastfeeding" active={!!m.lactating} onPress={() => set(i, { lactating: !m.lactating })} />}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove person ${i + 1}, age ${m.age}`} onPress={() => onChange(value.filter((_, k) => k !== i))} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: t.bad }}>Remove</Text></Pressable>
        </View>
      ))}
      <Button title="Add a person" kind="secondary" onPress={() => onChange([...value, { age: 35, sex: 'female', activity: 'moderatelyActive' }])} />
    </View>
  );
}

function QuestionInput({ q, value, onChange }: { q: Question; value: unknown; onChange: (v: unknown) => void }) {
  const t = useTheme();
  switch (q.kind) {
    case 'household':
      return <HouseholdInput value={(value as HouseholdMember[]) ?? []} onChange={onChange} />;
    case 'number':
      return <TextInput value={value === undefined ? '' : String(value)} keyboardType="number-pad" placeholder={q.unit} placeholderTextColor={t.muted} accessibilityLabel={q.ask}
        onChangeText={onChange} style={[styles.input, { color: t.text, borderColor: t.border }]} />;
    case 'choice':
      return <View style={styles.wrap}>{q.options!.map((o) => <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(o.value)} />)}</View>;
    case 'multi': {
      const arr = (value as string[]) ?? [];
      return <View style={styles.wrap}>{q.options!.map((o) => <Chip key={o.value} label={o.label} active={arr.includes(o.value)} onPress={() => onChange(arr.includes(o.value) ? arr.filter((x) => x !== o.value) : [...arr, o.value])} />)}</View>;
    }
    case 'boolean':
      return <View style={styles.row}><Chip label="Yes" active={value === true} onPress={() => onChange(true)} /><Chip label="No" active={value === false} onPress={() => onChange(false)} /></View>;
  }
}

/** Three questions at a time; answers merge into the goals profile. Ends with a summary to confirm. */
export function Interview({ goals, onSave }: { goals: HomesteadGoals; onSave: (g: HomesteadGoals) => Promise<void> }) {
  const t = useTheme();
  const qs = nextQuestions(goals);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [more, setMore] = useState(false);
  const prog = interviewProgress(goals);
  const submit = async () => {
    let g = goals;
    for (const q of qs) {
      const a = answers[q.id];
      // Multi-choice "none of these" is a valid answer (empty list).
      if (a === undefined && q.kind !== 'multi') continue;
      g = mergeGoals(g, q.apply(a ?? []));
    }
    setAnswers({});
    await onSave(g);
  };
  // Once the essentials are in, show the summary to confirm; optional questions only when asked for.
  if (!qs.length || (readyToPlan(goals) && !more)) {
    return (
      <Card title={goals.confirmedAt ? 'Your homestead goals' : 'Does this sound right?'}>
        <Body>{summarizeGoals(goals)}</Body>
        {!goals.confirmedAt && <Button title="Yes, make my plan" onPress={() => void onSave({ ...goals, confirmedAt: new Date().toISOString() })} />}
        {qs.length > 0 && <Body muted>{qs.length} more optional question{qs.length === 1 ? '' : 's'} below sharpen the plan.</Body>}
        {qs.length > 0 && <Button title="Answer a few more" kind="secondary" onPress={() => setMore(true)} />}
        <Button title="Start over" kind="secondary" onPress={() => Alert.alert('Start over?', 'This clears your answers for this property.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => void onSave({}) }])} />
      </Card>
    );
  }
  return (
    <View>
      <Body muted>Question {Math.min(prog.answered + 1, prog.total)} of about {prog.total}. Skip anything you’d rather not answer.</Body>
      {qs.map((q) => (
        <Card key={q.id} title={q.ask}>
          {q.help && <Body muted>{q.help}</Body>}
          <QuestionInput q={q} value={answers[q.id] ?? (q.id === 'household' ? goals.household ?? [] : undefined)} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
        </Card>
      ))}
      <Button title="Next" onPress={() => void submit()} />
      {readyToPlan(goals) && <Button title="Done for now" kind="secondary" onPress={() => setMore(false)} />}
      {prog.answered > 0 && <Text style={{ color: t.muted, fontSize: 13 }}>So far: {summarizeGoals(goals)}</Text>}
    </View>
  );
}

// ---------------- Chat ----------------

export function ChatList({ messages }: { messages: StoredMessage[] }) {
  const t = useTheme();
  return (
    <View>
      {messages.map((m) => (
        <View key={m.id} style={[styles.bubble, m.role === 'user' ? { alignSelf: 'flex-end', backgroundColor: t.accent } : { alignSelf: 'flex-start', backgroundColor: t.card, borderColor: t.border, borderWidth: 1 }]}
          accessible accessibilityLabel={`${m.role === 'user' ? 'You' : 'Planner'}: ${m.text}`}>
          <Text style={{ color: m.role === 'user' ? (t.dark ? '#10200a' : '#ffffff') : t.text, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>
          {m.role === 'assistant' && m.meta?.tools?.length ? <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Used: {m.meta.tools.join(', ').replace(/_/g, ' ')}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ---------------- Plan ----------------

function Bar({ share }: { share: [number, number] }) {
  const t = useTheme();
  const lo = Math.min(1, share[0]), hi = Math.min(1, share[1]);
  return (
    <View style={[styles.bar, { backgroundColor: t.border }]} accessible accessibilityLabel={`${pct(share[0])} to ${pct(share[1])}`}>
      <View style={{ width: `${lo * 100}%`, backgroundColor: t.accent, height: '100%' }} />
      <View style={{ width: `${(hi - lo) * 100}%`, backgroundColor: t.accent, opacity: 0.4, height: '100%' }} />
    </View>
  );
}

function ItemCard({ item, onDraft }: { item: PlanItem; onDraft?: () => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.item, { borderColor: t.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
        <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }}>{item.title}{item.optional ? '  (optional)' : ''} <Text accessibilityElementsHidden importantForAccessibility="no">{open ? '▾' : '▸'}</Text></Text>
        {!!item.detail && <Body muted>{item.detail}</Body>}
      </Pressable>
      {open && (
        <View style={{ marginTop: 4 }}>
          {item.why.map((w, i) => <Body key={i}>• {w}</Body>)}
          {item.laborHoursPerWeek && <Body muted>Chores: about {rng(item.laborHoursPerWeek)} h/week (extension budget)</Body>}
          {item.regulatory?.map((r, i) => <Text key={i} style={{ color: t.warn, fontSize: 13 }}>Check locally: {r}</Text>)}
          {onDraft && item.draft?.length ? <Button title="Add to my design (as a draft)" kind="secondary" onPress={onDraft} /> : null}
        </View>
      )}
    </View>
  );
}

export function PlanView({ plan, tier, onDraft }: { plan: HomesteadPlan; tier: { full: boolean; income: boolean; multiYear: boolean }; onDraft?: (item: PlanItem) => void }) {
  const t = useTheme();
  const phases: PhaseId[] = tier.multiYear ? ['year0', 'year1', 'years2to5'] : ['year0', 'year1'];
  const c = plan.coverage;
  const y1 = plan.coverageYear1;
  return (
    <View>
      {plan.warnings.length > 0 && (
        <Card title="Worth knowing">
          {plan.warnings.map((w, i) => <Text key={i} style={{ color: t.warn, marginBottom: 4 }}>• {w}</Text>)}
        </Card>
      )}
      {phases.map((ph) => {
        const items = plan.items.filter((i) => i.phase === ph && (tier.income || i.category !== 'income'));
        if (!items.length) return null;
        const b = plan.budgetByPhase[ph];
        return (
          <Card key={ph} title={PHASE_TITLE[ph]}>
            {items.map((i) => <ItemCard key={i.id} item={i} onDraft={tier.full && onDraft ? () => onDraft(i) : undefined} />)}
            {tier.multiYear && (b.startupTotal[1] > 0 || b.annualTotal[1] > 0) && (
              <Body muted>Priced items: start {moneyRange(b.startupTotal)}{b.annualTotal[1] > 0 ? `, then ${moneyRange(b.annualTotal)} a year` : ''}.</Body>
            )}
          </Card>
        );
      })}
      {!tier.multiYear && <Body muted>Years 2–5 (orchard, perennials, more animals) and budgets are part of Homestead Pro.</Body>}

      <Card title={tier.multiYear ? 'How much of your food this covers' : 'How much of your food year 1 covers'}>
        {NUTRIENT_KEYS.map((k) => (
          <View key={k} style={{ marginBottom: 6 }}>
            <Text style={{ color: t.text }}>
              {NUTRIENT_LABEL[k]}: year 1 {pct(y1.share[k][0])}–{pct(y1.share[k][1])}{tier.multiYear ? `; once mature ${pct(c.share[k][0])}–${pct(c.share[k][1])}` : ''}
            </Text>
            <Bar share={y1.share[k]} />
          </View>
        ))}
        {c.notCounted.map((n, i) => <Body key={i} muted>Not counted: {n.reason}</Body>)}
        {y1.storage.length > 0 && <Body>To store from year 1: {y1.storage.map((s) => `${Math.round(s.lb[0])}–${Math.round(s.lb[1])} lb for ${s.method.replace('-', ' ')}`).join('; ')}.</Body>}
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>{tier.multiYear ? '“Once mature” counts everything planned, including fruit trees that take years to bear. ' : ''}{c.sources.join('. ')}.</Text>
      </Card>

      {tier.multiYear && (
        <Card title="Budget (priced items)">
          {plan.budget.lines.map((l, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Text style={{ color: t.text }}>{l.label}: {l.startup ? `start ${moneyRange(l.startup)}` : ''}{l.annual ? `${l.startup ? ', ' : ''}${moneyRange(l.annual)}/yr` : ''}</Text>
              {!!l.basis && <Text style={{ color: t.muted, fontSize: 12 }}>{l.basis}</Text>}
              {l.reference && <Text style={{ color: t.muted, fontSize: 12 }}>For reference only (not in the totals): {moneyRange(l.reference.startup)} for {l.reference.scale}.</Text>}
              {l.caution && <Text style={{ color: t.warn, fontSize: 12 }}>{l.caution}</Text>}
              {l.sources[0] && <Pressable accessibilityRole="link" onPress={() => Linking.openURL(l.sources[0]!.url)}><Text style={{ color: t.accent, fontSize: 12 }}>{l.sources[0]!.title} ↗</Text></Pressable>}
            </View>
          ))}
          <Body>Total to start: {moneyRange(plan.budget.startupTotal)}; yearly: {moneyRange(plan.budget.annualTotal)}.</Body>
          {plan.budget.unknown.length > 0 && <Body muted>No sourced price for: {plan.budget.unknown.join(', ')}.</Body>}
        </Card>
      )}

      {tier.income && plan.enterprises && (
        <Card title="Income ideas">
          {plan.enterprises.slice(0, 6).map((e) => (
            <View key={e.id} style={{ marginBottom: 8 }}>
              <Text style={{ color: e.fit === 'good' ? t.accent : e.fit === 'possible' ? t.warn : t.muted, fontWeight: '600' }}>{e.name}: {e.fit} fit</Text>
              <Body muted>{e.revenue}</Body>
              {e.reasons.map((r, i) => <Body key={i} muted>• {r}</Body>)}
            </View>
          ))}
          <Text style={{ color: t.muted, fontSize: 12 }}>Rough ranges from extension budgets and benchmark studies; not financial, tax or legal advice. Check your state’s cottage-food, licensing and processing rules.</Text>
        </Card>
      )}

      <Card title="Assumptions and data used">
        {plan.assumptions.map((a, i) => <Body key={`a${i}`} muted>• {a}</Body>)}
        {plan.dataUsed.map((d, i) => <Body key={`d${i}`} muted>• {d}</Body>)}
      </Card>
    </View>
  );
}

// ---------------- Drafts & tasks ----------------

export function DraftCard({ d, canApprove, onApprove, onReject }: { d: DraftRow; canApprove: boolean; onApprove: () => void; onReject: () => void }) {
  const t = useTheme();
  const title = d.kind === 'design' ? (d.payload as DesignDraft).summary : `${(d.payload as TaskDraft[]).length} tasks`;
  return (
    <Card title={title}>
      {d.kind === 'design'
        ? (d.payload as DesignDraft).changes.map((c, i) => (
          <Body key={i}>{c.op === 'add' ? `Add ${c.count ?? 1} × ${c.kind.replace(/-/g, ' ')}${c.near ? ` near the ${c.near}` : ''}${c.plants?.length ? ` for ${c.plants.join(', ')}` : ''}` : `Remove an object${c.reason ? ` (${c.reason})` : ''}`}</Body>
        ))
        : (d.payload as TaskDraft[]).map((x, i) => <Body key={i}>• {x.title}{x.due ? ` (${x.due})` : ''}</Body>)}
      <Text style={{ color: t.muted, fontSize: 12 }}>Suggested by {d.kind === 'design' && (d.payload as DesignDraft).createdBy === 'model' ? 'the AI planner' : 'the planner'}. Nothing changes until you approve.</Text>
      <View style={styles.row}>
        <Button title="Approve" onPress={onApprove} disabled={!canApprove} />
        <Button title="Dismiss" kind="secondary" onPress={onReject} />
      </View>
    </Card>
  );
}

export function TaskList({ tasks, onToggle, onDelete }: { tasks: TaskRecord[]; onToggle: (t: TaskRecord) => void; onDelete: (t: TaskRecord) => void }) {
  const t = useTheme();
  if (!tasks.length) return <Body muted>No tasks yet. Approve task drafts from the planner, or ask it for a to-do list.</Body>;
  return (
    <View>
      {tasks.map((x) => (
        <View key={x.id} style={[styles.task, { borderColor: t.border }]}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: x.done }} onPress={() => onToggle(x)} style={{ flex: 1 }}>
            <Text accessibilityLabel={x.title} style={{ color: x.done ? t.muted : t.text, textDecorationLine: x.done ? 'line-through' : 'none', fontSize: 15 }}>{x.done ? '☑' : '☐'} {x.title}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{x.category}{x.due ? ` · ${x.due}` : ''}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${x.title}`} onPress={() => onDelete(x)} style={{ padding: 10 }}><Text style={{ color: t.bad }}>✕</Text></Pressable>
        </View>
      ))}
    </View>
  );
}

export const QUESTION_COUNT = QUESTIONS.length;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  member: { borderWidth: 1, borderRadius: 10, padding: 8, marginBottom: 8 },
  ageInput: { borderWidth: 1, borderRadius: 8, minHeight: 44, minWidth: 64, paddingHorizontal: 10, fontSize: 16 },
  input: { borderWidth: 1, borderRadius: 8, minHeight: 44, paddingHorizontal: 10, fontSize: 16 },
  bubble: { maxWidth: '88%', borderRadius: 14, padding: 10, marginBottom: 8 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  item: { borderTopWidth: 1, paddingVertical: 8 },
  task: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingVertical: 6 },
});
