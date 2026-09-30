/**
 * AI Homestead Planner (§9). Chat with the phone's own AI model where there is one (Apple Intelligence,
 * Gemini Nano) or the same interview as guided questions everywhere else; a phased plan from the
 * rules-based engine; and drafts that only change the design or task list once approved.
 * Everything runs on the phone. The conversation isn't uploaded anywhere.
 */
import {
  buildPlan, plannerTurn, readyToPlan, validateDesignDraft,
  type DesignDraft, type HomesteadGoals, type HomesteadPlan, type PlanItem, type PlannerContext, type PlannerModel,
} from '@plotwright/core';
import { KNOWLEDGE_BASE } from '@plotwright/data';
import { downloadModel, modelAvailability, onDeviceModel, unavailableReason, type ModelAvailability } from '@plotwright/ondevice-llm';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEntitlements } from '../../src/billing/entitlements';
import { ChatList, DraftCard, Interview, PlanView, TaskList } from '../../src/components/planner';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { getOrCreateDesign } from '../../src/db/designs';
import {
  addMessage, clearMessages, deleteTask, listDrafts, listMessages, listTasks, saveDraft, saveGoals, saveTask, setDraftStatus,
  type DraftRow, type StoredMessage, type TaskRecord,
} from '../../src/db/planner';
import { newId } from '../../src/services/identity';
import { applyDesignDraft, applyTaskDrafts, currentTier, plannerContext } from '../../src/services/planner';

type Tab = 'talk' | 'plan' | 'drafts' | 'tasks';

export default function Planner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const ent = useEntitlements((s) => s.entitlements);
  const tier = currentTier();
  const [tab, setTab] = useState<Tab>('talk');
  const [ctx, setCtx] = useState<PlannerContext | null>(null);
  const [goals, setGoals] = useState<HomesteadGoals>({});
  const [avail, setAvail] = useState<ModelAvailability | null | undefined>(undefined);
  const [model, setModel] = useState<PlannerModel | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState<HomesteadPlan | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const scroll = useRef<{ scrollToEnd(o?: { animated?: boolean }): void } | null>(null);

  const refreshLists = useCallback(async () => {
    setDrafts(await listDrafts(id));
    setTasks(await listTasks(id));
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const c = await plannerContext(id, setGoals);
        setCtx(c);
        setGoals(c.goals());
        setMessages(await listMessages(id));
        await refreshLists();
        const a = await modelAvailability();
        setAvail(a);
        setModel(await onDeviceModel());
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, ent, refreshLists]);

  // Rebuild the plan whenever the goals change (fast, deterministic, offline).
  useEffect(() => {
    if (!ctx || !readyToPlan(goals)) { setPlan(null); return; }
    let cancelled = false;
    void ctx.sitePlanInput().then((site) => {
      if (!cancelled) setPlan(buildPlan(goals, site, KNOWLEDGE_BASE, { includeIncome: tier.income, showCosts: tier.multiYear }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, goals, tier.income]);

  // The context saves to the database (and syncs) and reports back through setGoals.
  const onSaveGoals = async (g: HomesteadGoals) => {
    if (ctx) await ctx.saveGoals(g);
    else { await saveGoals(id, g); setGoals(g); }
  };

  const chatAllowed = tier.full && !!model;

  const send = async () => {
    const text = input.trim();
    if (!text || !ctx || !model || thinking) return;
    setInput('');
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    const um = await addMessage(id, 'user', text);
    setMessages((ms) => [...ms, um]);
    setThinking(true);
    try {
      const r = await plannerTurn(model, ctx, history, text);
      const am = await addMessage(id, 'assistant', r.reply, { model: r.model, tools: r.toolCalls.map((c) => c.name), safety: r.safety, unverified: r.unverifiedNumbers });
      setMessages((ms) => [...ms, am]);
      setGoals(ctx.goals());
      await refreshLists();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const friendly = /contextFull/.test(msg) ? 'The conversation got too long for the on-device model. Your answers are saved: tap “New chat” to continue.'
        : /busy/.test(msg) ? 'The on-device model is busy. Try again in a moment.'
          : /background/.test(msg) ? 'The on-device model only works while the app is open.'
            : `The on-device model couldn’t answer (${msg}).`;
      const am = await addMessage(id, 'assistant', friendly);
      setMessages((ms) => [...ms, am]);
    } finally {
      setThinking(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const draftFromItem = async (item: PlanItem) => {
    const design = await getOrCreateDesign(id);
    const d: DesignDraft = { id: newId(), summary: item.title, changes: item.draft ?? [], why: item.why, createdBy: 'rules' };
    const v = validateDesignDraft(d, design.objects);
    if (!v.ok) return Alert.alert('Can’t add that', v.problems.join('\n'));
    await saveDraft(id, 'design', v.cleaned);
    await refreshLists();
    setTab('drafts');
  };

  const approve = async (d: DraftRow) => {
    if (busy || !tier.full) return;
    setBusy(true);
    try {
      if (d.kind === 'design') {
        const r = await applyDesignDraft(id, d.payload);
        Alert.alert('Added to your design', `${r.added} object${r.added === 1 ? '' : 's'} placed${r.plantings ? `, ${r.plantings} planting${r.plantings === 1 ? '' : 's'} planned` : ''}. They’re labelled “planner draft”: move them where they fit best (check the sun layer).${r.unplaced.length ? `\n\nNot placed: ${r.unplaced.join(', ')}.` : ''}`,
          [{ text: 'OK' }, { text: 'Open design', onPress: () => router.push({ pathname: '/design/[id]', params: { id } }) }]);
      } else {
        const n = await applyTaskDrafts(id, d.id, d.payload);
        Alert.alert('Tasks added', `${n} task${n === 1 ? '' : 's'} added to your list.`);
      }
    } catch (e) {
      Alert.alert('Couldn’t apply the draft', (e as Error).message);
    } finally {
      setBusy(false);
    }
    await refreshLists();
  };

  const getModel = async () => {
    setDownloading(0);
    try {
      const ok = await downloadModel((b) => setDownloading(b));
      if (ok) {
        setAvail(await modelAvailability());
        setModel(await onDeviceModel());
      } else Alert.alert('Download didn’t finish', 'Try again on Wi-Fi with the phone charging.');
    } catch (e) {
      Alert.alert('Download failed', (e as Error).message);
    } finally {
      setDownloading(null);
    }
  };

  if (error) return <Body>{error}</Body>;
  if (!ctx || avail === undefined) return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading the planner" />;

  const pending = drafts.length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={[styles.tabs, { borderColor: t.border }]} accessibilityRole="tablist">
        {([['talk', chatAllowed ? 'Chat' : 'Questions'], ['plan', 'Plan'], ['drafts', `Drafts${pending ? ` (${pending})` : ''}`], ['tasks', 'Tasks']] as Array<[Tab, string]>).map(([k, label]) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} style={[styles.tab, tab === k && { borderBottomColor: t.accent }]}>
            <Text style={{ color: tab === k ? t.accent : t.muted, fontWeight: '600' }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        {tab === 'talk' && (chatAllowed ? (
          <View>
            <Body muted>Chatting with {model!.kind === 'native-tools' ? 'Apple’s' : 'Google’s'} AI model on this phone. Nothing is sent anywhere. Figures come from your property’s data and the app’s sourced knowledge base.</Body>
            {messages.length === 0 && <Card title="Say hello"><Body>Tell the planner about your household and what you’d like from your land, e.g. “We’re a family of three and want most of our vegetables and some eggs.”</Body></Card>}
            <ChatList messages={messages} />
            {thinking && <ActivityIndicator accessibilityLabel="The planner is thinking" />}
            {messages.length > 0 && <Button title="New chat (keeps your answers)" kind="secondary" onPress={async () => { await clearMessages(id); setMessages([]); }} />}
          </View>
        ) : (
          <View>
            {!tier.full && avail?.status === 'available' ? <Body muted>Chatting with the on-device AI is part of Grower. The guided questions build the same plan.</Body> : <Body muted>{unavailableReason(avail)}</Body>}
            {tier.full && avail?.status === 'downloadable' && (
              <Button title={downloading !== null ? `Downloading… ${Math.round(downloading / 1e6)} MB` : 'Download the on-device AI (free)'} kind="secondary" disabled={downloading !== null} onPress={() => void getModel()}
                accessibilityHint="Google's Gemini Nano runs on this phone; nothing is sent anywhere" />
            )}
            <Interview goals={goals} onSave={onSaveGoals} />
          </View>
        ))}

        {tab === 'plan' && (plan ? (
          <PlanView plan={plan} tier={tier} onDraft={tier.full ? (i) => void draftFromItem(i) : undefined} />
        ) : (
          <Card title="Not enough to plan yet">
            <Body>The plan needs your household, food goal, weekly hours, budget and garden space. Answer those first.</Body>
            <Button title={chatAllowed ? 'Go to chat' : 'Answer the questions'} onPress={() => setTab('talk')} />
          </Card>
        ))}

        {tab === 'drafts' && (
          <View>
            {!tier.full && <Body muted>Turning the plan into design drafts is part of Grower.</Body>}
            {drafts.length === 0 ? <Body muted>No drafts waiting. Use “Add to my design” on a plan item, or ask the planner.</Body>
              : drafts.map((d) => <DraftCard key={d.id} d={d} canApprove={tier.full && !busy} onApprove={() => void approve(d)} onReject={async () => { await setDraftStatus(d.id, 'rejected'); await refreshLists(); }} />)}
          </View>
        )}

        {tab === 'tasks' && (
          <TaskList tasks={tasks}
            onToggle={async (x) => { await saveTask({ ...x, done: !x.done }); await refreshLists(); }}
            onDelete={async (x) => { await deleteTask(x.id); await refreshLists(); }} />
        )}
      </ScrollView>

      {tab === 'talk' && chatAllowed && (
        <View style={[styles.inputRow, { borderColor: t.border, backgroundColor: t.bg }]}>
          <TextInput value={input} onChangeText={setInput} placeholder="Ask the planner…" placeholderTextColor={t.muted} multiline accessibilityLabel="Message to the planner"
            style={[styles.input, { color: t.text, borderColor: t.border }]} />
          <Button title="Send" onPress={() => void send()} disabled={thinking || !input.trim()} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', minHeight: 44 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44, maxHeight: 120, fontSize: 16 },
});
