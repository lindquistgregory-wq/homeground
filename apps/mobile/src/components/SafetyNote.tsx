/**
 * One quiet line for a safety note (Safety & Liability Review): an icon, the hazard and how to avoid
 * it, and "Details" for the consequence, the rule to check and the source. The highest hazards open
 * in full the first time, with "Got it"; after that every note stays a single line.
 */
import { ackKey, type SafetyNote } from '@plotwright/core';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';
import { tapFeedback, useTheme } from './ui';
import { useSafetyAcks } from '../services/safetyAcks';

export function SafetyNoteRow({ note }: { note: SafetyNote }) {
  const t = useTheme();
  const { acks, loaded, load, ack } = useSafetyAcks();
  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);
  const needsAck = !!note.acknowledge && loaded && !acks[ackKey(note)];
  const [open, setOpen] = useState(false);
  const expanded = open || needsAck;
  const caution = note.level === 'caution';
  return (
    <View style={[styles.box, { backgroundColor: t.surface }]} accessibilityRole="summary">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${caution ? 'Caution' : 'Note'}: ${note.headline}`}
        accessibilityHint={expanded ? 'Hides the details' : 'Shows the details'}
        accessibilityState={{ expanded }}
        onPress={() => { tapFeedback(); setOpen(!expanded); }}
        style={styles.head}
      >
        <Icon name={caution ? 'shield-alert-outline' : 'information-outline'} size={20} color={caution ? t.warn : t.muted} />
        <Text style={[styles.headline, { color: t.text }]}>{note.headline}</Text>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
      </Pressable>
      {expanded && (
        <View style={styles.body}>
          {note.details.map((d) => <Text key={d} style={[styles.detail, { color: t.muted }]}>{d}</Text>)}
          {note.sources.map((s) => (
            <Text key={s.url} accessibilityRole="link" onPress={() => Linking.openURL(s.url)} style={[styles.detail, { color: t.accent }]}>{s.title}</Text>
          ))}
          {needsAck && (
            <Pressable accessibilityRole="button" onPress={() => { tapFeedback(); void ack(ackKey(note)); setOpen(false); }} style={styles.ack}>
              <Text style={{ color: t.accent, fontWeight: '600' }}>Got it</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** A one-off message in the same quiet style (proximity checks between objects). */
export function SafetyLine({ text, caution }: { text: string; caution?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.box, styles.head, { backgroundColor: t.surface }]} accessible accessibilityLabel={`${caution ? 'Caution' : 'Note'}: ${text}`}>
      <Icon name={caution ? 'shield-alert-outline' : 'information-outline'} size={20} color={caution ? t.warn : t.muted} />
      <Text style={[styles.headline, { color: t.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, marginVertical: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
  headline: { flex: 1, fontSize: 14, lineHeight: 19 },
  body: { paddingHorizontal: 12, paddingBottom: 10, paddingLeft: 42, gap: 6 },
  detail: { fontSize: 13, lineHeight: 18 },
  ack: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingRight: 12 },
});
