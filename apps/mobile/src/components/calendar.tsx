/**
 * Month calendar (Sunday first) with small title cards on each day, a day list, an event detail
 * sheet, and the form for the user's own events. Card colours mark where an event comes from;
 * alerts and overdue items use the warning colour.
 */
import { formatRange, isIsoDate, monthGrid, type AgendaItem, type AgendaSource, type CustomEvent, type Repeat } from '@plotwright/core';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AnimalArt } from './AnimalArt';
import { Icon, type IconName } from './Icon';
import { PlantArt } from './PlantArt';
import { Text } from './Text';
import { Chip } from './plants';
import { Body, Button, Card, useTheme } from './ui';
import { plantById } from '@plotwright/core';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const SOURCE_LABEL: Record<AgendaSource, string> = { planting: 'Garden', animal: 'Animal care', record: 'Records', task: 'Planner task', alert: 'Weather alert', custom: 'Your event' };
const SOURCE_ICON: Record<AgendaSource, IconName> = { planting: 'sprout', animal: 'paw', record: 'clipboard-text-outline', task: 'checkbox-marked-outline', alert: 'weather-lightning-rainy', custom: 'calendar-star' };

/** Card colours per source, readable in both themes (text on a tinted fill). */
export function sourceColors(source: AgendaSource, urgent: boolean | undefined, dark: boolean): { fg: string; bg: string } {
  if (urgent) return dark ? { fg: '#ffd6d1', bg: '#5a2620' } : { fg: '#7a1c16', bg: '#f8d9d5' };
  const c: Record<AgendaSource, [string, string, string, string]> = {
    planting: ['#c9ecb4', '#24401c', '#1f5119', '#dcefd1'],
    animal: ['#f6dcb0', '#4a3415', '#6b4410', '#f6e3c3'],
    record: ['#e3d2f3', '#3b2a4d', '#53306f', '#eadcf6'],
    task: ['#cfe2f7', '#1f3550', '#1d4a78', '#d9e8f8'],
    alert: ['#ffd6d1', '#5a2620', '#7a1c16', '#f8d9d5'],
    custom: ['#c8ece8', '#173f3b', '#155a53', '#d3efec'],
  };
  const [dfg, dbg, lfg, lbg] = c[source];
  return dark ? { fg: dfg, bg: dbg } : { fg: lfg, bg: lbg };
}

export function MonthCalendar({ year, month, items, selected, today, onSelect, onMonth }: {
  year: number; month: number; items: AgendaItem[]; selected: string; today: string;
  onSelect: (iso: string) => void; onMonth: (year: number, month: number) => void;
}) {
  const t = useTheme();
  const weeks = monthGrid(year, month, items);
  const step = (d: number) => { const m = month + d; onMonth(m < 1 ? year - 1 : m > 12 ? year + 1 : year, ((m + 11) % 12) + 1); };
  return (
    <View>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => step(-1)} hitSlop={12}><Icon name="chevron-left" size={28} color={t.accent} /></Pressable>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }} accessibilityRole="header">{MONTHS[month - 1]} {year}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => step(1)} hitSlop={12}><Icon name="chevron-right" size={28} color={t.accent} /></Pressable>
      </View>
      <View style={styles.week}>{WEEKDAYS.map((d, i) => <Text key={i} style={[styles.weekday, { color: t.muted }]}>{d}</Text>)}</View>
      {weeks.map((w, wi) => (
        <View key={wi} style={styles.week}>
          {w.map((c) => {
            const isSel = c.iso === selected, isToday = c.iso === today;
            const more = c.items.length - 2;
            return (
              <Pressable key={c.iso} accessibilityRole="button" accessibilityState={{ selected: isSel }}
                accessibilityLabel={`${MONTHS[Number(c.iso.slice(5, 7)) - 1]} ${c.day}: ${c.items.length ? c.items.map((i) => i.title).join('; ') : 'nothing scheduled'}`}
                onPress={() => onSelect(c.iso)}
                style={[styles.cell, { borderColor: isSel ? t.accent : t.border, backgroundColor: isSel ? t.accentSoft : 'transparent', opacity: c.inMonth ? 1 : 0.45 }]}>
                <Text style={[styles.dayNum, { color: isToday ? t.onAccent : t.text, backgroundColor: isToday ? t.accent : 'transparent' }]}>{c.day}</Text>
                {c.items.slice(0, 2).map((i) => {
                  const col = sourceColors(i.source, i.urgent, t.dark);
                  return <Text key={i.id} numberOfLines={2} style={[styles.chip, { color: col.fg, backgroundColor: col.bg }]}>{i.short ?? i.title}</Text>;
                })}
                {more > 0 && <Text style={[styles.more, { color: t.muted }]}>+{more}</Text>}
                {c.items.length === 0 && c.ongoing > 0 && <View style={[styles.dot, { backgroundColor: t.border }]} />}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** One event as a card in the day list. */
export function EventRow({ item, onPress }: { item: AgendaItem; onPress: () => void }) {
  const t = useTheme();
  const col = sourceColors(item.source, item.urgent, t.dark);
  const plant = item.plantId ? plantById(item.plantId) : undefined;
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Shows the details" onPress={onPress} style={[styles.row, { backgroundColor: col.bg }]}>
      {plant ? <PlantArt plant={plant} size={36} /> : item.animalId ? <AnimalArt animalId={item.animalId} size={36} /> : <View style={styles.rowIcon}><Icon name={SOURCE_ICON[item.source]} size={22} color={col.fg} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={{ color: col.fg, fontWeight: '700' }}>{item.title}</Text>
        <Text style={{ color: col.fg, fontSize: 12, opacity: 0.85 }}>{SOURCE_LABEL[item.source]} · {item.time ? `${item.time} · ` : ''}{formatRange(item.start, item.end)}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={col.fg} />
    </Pressable>
  );
}

/** The details of one event, opened from the calendar. Custom events can be edited or deleted. */
export function EventSheet({ item, onClose, onEdit, onDelete }: { item: AgendaItem | null; onClose: () => void; onEdit?: () => void; onDelete?: () => void }) {
  const t = useTheme();
  if (!item) return null;
  const col = sourceColors(item.source, item.urgent, t.dark);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} accessibilityRole="button" accessibilityLabel="Close details" onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.card }]}>
        <View style={[styles.badge, { backgroundColor: col.bg }]}><Text style={{ color: col.fg, fontSize: 12, fontWeight: '700' }}>{SOURCE_LABEL[item.source]}</Text></View>
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: 8 }} accessibilityRole="header">{item.title}</Text>
        <Body muted>{item.time ? `${item.time} · ` : ''}{formatRange(item.start, item.end)}</Body>
        <ScrollView style={{ maxHeight: 280, marginTop: 8 }}>{item.details.map((d, i) => <Body key={i}>{d}</Body>)}</ScrollView>
        {item.customId && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button title="Edit" kind="secondary" icon="pencil" onPress={() => onEdit?.()} /></View>
            <View style={{ flex: 1 }}><Button title="Delete" kind="secondary" icon="delete-outline" onPress={() => onDelete?.()} /></View>
          </View>
        )}
        <Button title="Close" onPress={onClose} />
      </View>
    </Modal>
  );
}

const REPEATS: Array<[Repeat, string]> = [['none', 'Once'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
const REMINDERS: Array<[number | null, string]> = [[null, 'No reminder'], [0, 'At the time'], [60, '1 hour before'], [1440, '1 day before']];

/** Add or edit one of the user's own events. */
export function EventEditor({ visible, initial, date, onClose, onSave }: {
  visible: boolean; initial?: CustomEvent; date: string; onClose: () => void;
  onSave: (e: { title: string; date: string; endDate?: string; time?: string; notes?: string; repeat: Repeat; remindMinutes: number | null }) => Promise<void>;
}) {
  const t = useTheme();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [d, setD] = useState(initial?.date ?? date);
  const [end, setEnd] = useState(initial?.endDate ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [repeat, setRepeat] = useState<Repeat>(initial?.repeat ?? 'none');
  const [remind, setRemind] = useState<number | null>(initial?.remindMinutes ?? null);
  const timeOk = !time || /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const ok = title.trim() && isIsoDate(d) && (!end || (isIsoDate(end) && end >= d)) && timeOk;
  const input = (value: string, on: (v: string) => void, label: string, extra: object = {}) => (
    <TextInput value={value} onChangeText={on} placeholder={label} placeholderTextColor={t.muted} accessibilityLabel={label} style={[styles.input, { color: t.text, borderColor: t.border }]} {...extra} />
  );
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 48, backgroundColor: t.bg, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <Card title={initial ? 'Edit event' : 'New event'} icon="calendar-star">
          {input(title, setTitle, 'What (e.g. Farrier visit, hay delivery)')}
          {input(d, setD, 'Date (YYYY-MM-DD)', { keyboardType: 'numbers-and-punctuation' })}
          {input(end, setEnd, 'Last day, if it runs several days (optional)', { keyboardType: 'numbers-and-punctuation' })}
          {input(time, setTime, 'Time, 24-hour HH:MM (optional)', { keyboardType: 'numbers-and-punctuation' })}
          {input(notes, setNotes, 'Notes (optional)', { multiline: true })}
          <Text style={{ color: t.text, fontWeight: '600', marginTop: 6 }}>Repeats</Text>
          <View style={styles.chips}>{REPEATS.map(([k, l]) => <Chip key={k} label={l} active={repeat === k} onPress={() => setRepeat(k)} />)}</View>
          <Text style={{ color: t.text, fontWeight: '600', marginTop: 6 }}>Reminder</Text>
          <View style={styles.chips}>{REMINDERS.map(([k, l]) => <Chip key={String(k)} label={l} active={remind === k} onPress={() => setRemind(k)} />)}</View>
          {!time && remind !== null && <Body muted>All-day events remind at 8:00 on the day{remind ? ', minus the time chosen' : ''}.</Body>}
          <Button title="Save" disabled={!ok} onPress={() => void onSave({ title: title.trim(), date: d, endDate: end || undefined, time: time || undefined, notes: notes.trim() || undefined, repeat, remindMinutes: remind })} />
          <Button title="Cancel" kind="secondary" onPress={onClose} />
        </Card>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  cell: { flex: 1, minHeight: 70, borderWidth: StyleSheet.hairlineWidth, padding: 2, borderRadius: 4 },
  dayNum: { fontSize: 12, fontWeight: '700', alignSelf: 'flex-start', paddingHorizontal: 4, borderRadius: 8, overflow: 'hidden', marginBottom: 1 },
  chip: { fontSize: 9, borderRadius: 3, paddingHorizontal: 2, marginTop: 1, overflow: 'hidden' },
  more: { fontSize: 9, marginTop: 1 },
  dot: { width: 6, height: 2, borderRadius: 1, marginTop: 4, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, marginBottom: 6 },
  rowIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  badge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, marginVertical: 5, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 4 },
});
