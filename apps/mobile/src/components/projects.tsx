/**
 * The plan as a timeline of projects. Each project is a node on the line (garden, hens, bees…); tap
 * one to see its steps as a checklist, put it on the calendar from a start date, and check steps off.
 * Finished steps switch on the routine chores they bring.
 */
import {
  PHASE_TITLE, activeChores, isoAdd, nextStep, projectFor, projectProgressShare, projectSpanDays, scheduleProject,
  type PhaseId, type PlanProject, type ProjectIcon, type ProjectProgress, type ProjectSnapshot,
} from '@plotwright/core';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { localToday } from '../services/animals';
import { Icon, type IconName } from './Icon';
import { Chip } from './plants';
import { Text, TextInput } from './Text';
import { Body, Button, Card, tapFeedback, useTheme } from './ui';

const ICON: Record<ProjectIcon, IconName> = {
  garden: 'sprout', hens: 'egg-outline', poultry: 'bird', bees: 'bee', goats: 'sheep', rabbits: 'rabbit', pigs: 'pig', orchard: 'fruit-cherries', tunnel: 'greenhouse', water: 'water-outline',
};
const PHASE_SHORT: Record<PhaseId, string> = { year0: 'Year 0 · set up', year1: 'Year 1 · first season', years2to5: 'Years 2–5 · grow' };
const REPEAT_LABEL = { daily: 'every day', weekly: 'every week', monthly: 'every month' } as const;

const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
/** The coming Saturday (or today if it is one). */
const saturday = (today: string) => isoAdd(today, (6 - new Date(`${today}T12:00:00`).getDay() + 7) % 7);

type Change = (p: Omit<ProjectProgress, 'updatedAt'>) => Promise<void>;

export function ProjectTimeline({ parcelId, projects, progress, phases, onChange, onDraft }: {
  parcelId: string; projects: PlanProject[]; progress: Record<string, ProjectProgress>; phases: PhaseId[];
  onChange: Change; onDraft?: (p: PlanProject) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const shown = projects.filter((p) => phases.includes(p.phase));
  const started = shown.filter((p) => progress[p.id]?.startDate || Object.keys(progress[p.id]?.done ?? {}).length);
  const fresh = shown.filter((p) => !started.includes(p));
  if (!shown.length) return <Body muted>No projects in this plan yet.</Body>;

  return (
    <View>
      <Card title={started.length ? 'Your projects' : 'Where would you like to start?'} icon="flag-outline">
        <Body muted>{started.length ? 'Pick up where you left off, or start another project.' : 'Each project is a short checklist. Start with whichever you’re most excited about; you can run several at once.'}</Body>
        <View style={styles.wrap}>
          {[...started, ...fresh].map((p) => <Chip key={p.id} label={p.title} active={open === p.id} onPress={() => setOpen(open === p.id ? null : p.id)} />)}
        </View>
      </Card>

      {phases.map((ph) => {
        const inPhase = shown.filter((p) => p.phase === ph);
        if (!inPhase.length) return null;
        return (
          <View key={ph}>
            <View style={styles.phaseRow} accessibilityRole="header" accessibilityLabel={PHASE_TITLE[ph]}>
              <View style={[styles.phaseDot, { backgroundColor: t.secondarySoft, borderColor: t.border }]} />
              <Text style={{ color: t.muted, fontWeight: '700', fontSize: 13, letterSpacing: 0.4 }}>{PHASE_SHORT[ph].toUpperCase()}</Text>
            </View>
            {inPhase.map((p, i) => (
              <ProjectNode key={p.id} parcelId={parcelId} live={p} progress={progress[p.id]} open={open === p.id} last={i === inPhase.length - 1 && ph === phases[phases.length - 1]}
                onToggle={() => setOpen(open === p.id ? null : p.id)} onChange={onChange} onDraft={onDraft ? () => onDraft(p) : undefined} />
            ))}
          </View>
        );
      })}
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Step lengths and chores are planning suggestions. The calendar follows what you check off.</Text>
    </View>
  );
}

function ProjectNode({ parcelId, live, progress, open, last, onToggle, onChange, onDraft }: {
  parcelId: string; live: PlanProject; progress?: ProjectProgress; open: boolean; last: boolean;
  onToggle: () => void; onChange: Change; onDraft?: () => void;
}) {
  const t = useTheme();
  const project = projectFor(live, progress)!;
  const share = projectProgressShare(project, progress);
  const complete = share.total > 0 && share.done === share.total;
  const next = nextStep(project, progress);
  const onCal = !!progress?.startDate;
  const today = localToday();
  const schedule = scheduleProject(project, progress, today);
  const dot = complete ? t.growth : onCal || share.done ? t.accent : t.card;

  const save = (patch: Partial<ProjectProgress>) => onChange({
    parcelId, projectId: live.id, done: progress?.done ?? {}, ...(progress?.choresOff ? { choresOff: progress.choresOff } : {}),
    ...(progress?.startDate ? { startDate: progress.startDate } : {}),
    // Keep the steps the owner started with; take the plan's current ones for a project not yet begun.
    project: progress?.project ?? snapshot(live), ...patch,
  });

  const toggleStep = (id: string) => {
    tapFeedback();
    const done = { ...(progress?.done ?? {}) };
    if (done[id]) delete done[id];
    else done[id] = today;
    void save({ done });
  };

  return (
    <View style={styles.nodeRow}>
      <View style={styles.rail}>
        <View style={[styles.node, { backgroundColor: dot, borderColor: complete ? t.growth : t.accent }]}>
          <Icon name={complete ? 'check' : ICON[project.icon]} size={18} color={complete || onCal || share.done ? t.onAccent : t.accent} />
        </View>
        {!last && <View style={[styles.line, { backgroundColor: t.border }]} />}
      </View>
      <View style={[styles.nodeCard, { backgroundColor: t.card, borderColor: open ? t.accent : t.border }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${project.title}, ${share.done} of ${share.total} steps done`} onPress={onToggle} style={{ minHeight: 44 }}>
          <View style={styles.headRow}>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, flex: 1 }}>{project.title}</Text>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={t.muted} />
          </View>
          <Text style={{ color: t.muted, fontSize: 13 }}>{live.summary}</Text>
          <View style={[styles.track, { backgroundColor: t.surface }]}>
            <View style={{ width: `${share.total ? (100 * share.done) / share.total : 0}%`, height: '100%', backgroundColor: complete ? t.growth : t.accent, borderRadius: 3 }} />
          </View>
          <Text style={{ color: t.muted, fontSize: 12 }}>
            {complete ? 'All steps done' : `${share.done} of ${share.total} steps`}
            {!complete && next ? ` · Next: ${next.title}` : ''}
            {onCal ? ` · On the calendar from ${fmt(progress!.startDate!)}` : ` · About ${Math.max(1, Math.round(projectSpanDays(project) / 7))} weeks`}
          </Text>
        </Pressable>

        {open && <ProjectDetail live={live} project={project} progress={progress} schedule={schedule} today={today} onToggleStep={toggleStep} save={save} onDraft={onDraft} />}
      </View>
    </View>
  );
}

const snapshot = (p: PlanProject): ProjectSnapshot => ({ id: p.id, title: p.title, icon: p.icon, steps: p.steps });

function ProjectDetail({ live, project, progress, schedule, today, onToggleStep, save, onDraft }: {
  live: PlanProject; project: ProjectSnapshot; progress?: ProjectProgress; schedule: ReturnType<typeof scheduleProject>; today: string;
  onToggleStep: (id: string) => void; save: (patch: Partial<ProjectProgress>) => Promise<void>; onDraft?: () => void;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState('');
  const chores = activeChores(project, progress);
  const off = new Set(progress?.choresOff ?? []);
  const allChores = project.steps.flatMap((s) => (progress?.done[s.id] ? s.chores ?? [] : []));
  const when = (id: string) => schedule.find((s) => s.step.id === id);
  const start = (iso: string) => { setPicking(false); setCustom(''); void save({ startDate: iso }); };

  return (
    <View style={{ marginTop: 10 }}>
      {project.steps.map((s, i) => {
        const done = progress?.done[s.id];
        const sc = when(s.id);
        return (
          <View key={s.id} style={[styles.step, { borderColor: t.border }]}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!done }} accessibilityLabel={`Step ${i + 1}: ${s.title}`} onPress={() => onToggleStep(s.id)} hitSlop={6}
              style={[styles.box, { borderColor: done ? t.growth : t.muted, backgroundColor: done ? t.growth : 'transparent' }]}>
              {done ? <Icon name="check" size={16} color={t.onAccent} /> : null}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: done ? t.muted : t.text, fontWeight: '600', fontSize: 15, textDecorationLine: done ? 'line-through' : 'none' }}>{s.title}{s.optional ? ' (optional)' : ''}</Text>
              {!!s.detail && !done && <Text style={{ color: t.muted, fontSize: 13 }}>{s.detail}</Text>}
              <Text style={{ color: sc?.late ? t.warn : t.muted, fontSize: 12 }}>
                {done ? `Done ${fmt(done)}` : sc ? `${fmt(sc.start)}${sc.end !== sc.start ? ` – ${fmt(sc.end)}` : ''}${sc.late ? ' · running late, later steps moved' : ''}` : `About ${s.days} day${s.days === 1 ? '' : 's'}`}
              </Text>
              {s.chores?.length && !done ? <Text style={{ color: t.muted, fontSize: 12 }}>Then: {s.chores.map((c) => `${c.title.toLowerCase()} ${REPEAT_LABEL[c.repeat]}`).join('; ')}</Text> : null}
            </View>
          </View>
        );
      })}

      {allChores.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: t.text, fontWeight: '700' }}>Routine chores on your calendar</Text>
          {allChores.map((c) => (
            <View key={c.id} style={styles.choreRow}>
              <Text style={{ color: t.text, flex: 1 }}>{c.title} <Text style={{ color: t.muted }}>({REPEAT_LABEL[c.repeat]})</Text></Text>
              <Switch accessibilityLabel={`${c.title} on the calendar`} value={!off.has(c.id)} onValueChange={(v) => void save({ choresOff: v ? [...off].filter((x) => x !== c.id) : [...off, c.id] })} />
            </View>
          ))}
          {chores.length === 0 && <Body muted>All switched off.</Body>}
        </View>
      )}

      <View style={{ marginTop: 10 }}>
        {progress?.startDate ? (
          <>
            <Button title="Change the start date" kind="secondary" icon="calendar-edit" onPress={() => setPicking(!picking)} />
            <Button title="Take the steps off the calendar" kind="secondary" onPress={() => Alert.alert('Take the steps off the calendar?', 'Your checked-off steps and chores stay.', [
              { text: 'Cancel', style: 'cancel' }, { text: 'Take off', onPress: () => void save({ startDate: undefined }) },
            ])} />
          </>
        ) : <Button title="Add the steps to my calendar" icon="calendar-plus" onPress={() => setPicking(!picking)} />}
        {picking && (
          <View style={[styles.picker, { borderColor: t.border, backgroundColor: t.surface }]}>
            <Text style={{ color: t.text, fontWeight: '600' }}>Start on</Text>
            <View style={styles.wrap}>
              <Chip label={`Today (${fmt(today)})`} active={false} onPress={() => start(today)} />
              <Chip label={`Saturday (${fmt(saturday(today))})`} active={false} onPress={() => start(saturday(today))} />
              <Chip label={`In 2 weeks (${fmt(isoAdd(today, 14))})`} active={false} onPress={() => start(isoAdd(today, 14))} />
            </View>
            <View style={styles.dateRow}>
              <TextInput value={custom} onChangeText={setCustom} placeholder="Or a date: YYYY-MM-DD" placeholderTextColor={t.muted} keyboardType="numbers-and-punctuation" accessibilityLabel="Start date"
                style={[styles.input, { color: t.text, borderColor: custom && !isIso(custom) ? t.bad : t.border, backgroundColor: t.card }]} />
              <Button title="Set" disabled={!isIso(custom)} onPress={() => start(custom)} />
            </View>
            <Text style={{ color: t.muted, fontSize: 12 }}>Each step gets dates one after another. Check a step off early or late and the rest move.</Text>
          </View>
        )}
        {onDraft && <Button title="Add to my design (as a draft)" kind="secondary" icon="pencil-ruler" onPress={onDraft} />}
      </View>

      {(live.why.length > 0 || live.regulatory.length > 0) && (
        <View style={{ marginTop: 6 }}>
          {live.why.slice(0, 3).map((w, i) => <Text key={i} style={{ color: t.muted, fontSize: 13 }}>• {w}</Text>)}
          {live.regulatory.map((r, i) => <Text key={`r${i}`} style={{ color: t.warn, fontSize: 13 }}>Check locally: {r}</Text>)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  phaseRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 6 },
  phaseDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, marginLeft: 13 },
  nodeRow: { flexDirection: 'row', alignItems: 'stretch' },
  rail: { width: 40, alignItems: 'center' },
  node: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  line: { width: 2, flex: 1, marginVertical: 2 },
  nodeCard: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 12, marginLeft: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 6, borderRadius: 3, marginTop: 8, marginBottom: 4, overflow: 'hidden' },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderTopWidth: 1 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  choreRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  picker: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, minHeight: 44, paddingHorizontal: 10, fontSize: 16 },
});
