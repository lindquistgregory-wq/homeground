/** Small shared UI pieces. Colours meet WCAG AA against their backgrounds (§11 accessibility). */
import type { Attribution, Layer } from '@plotwright/core';
import { useState, type ReactNode } from 'react';
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  // Text colours meet WCAG AA (4.5:1) on bg, card and surface; accent meets it on card for labels.
  return {
    dark,
    bg: dark ? '#0f1411' : '#f3f6f0',
    card: dark ? '#18201b' : '#ffffff',
    /** Raised or inset areas inside a card (chips, input fields, icon wells). */
    surface: dark ? '#212b24' : '#edf2e9',
    text: dark ? '#e9efe7' : '#17211a',
    muted: dark ? '#a5afa6' : '#56615a',
    accent: dark ? '#8fd16a' : '#2e6b25',
    /** Tinted background behind accent icons and selected items. */
    accentSoft: dark ? '#22381f' : '#e2efdb',
    /** Text and icons drawn on an accent fill. */
    onAccent: dark ? '#0d1f08' : '#ffffff',
    border: dark ? '#2a352d' : '#dfe6da',
    warn: dark ? '#f2c14e' : '#8a5a00',
    bad: dark ? '#ff8a80' : '#a8231f',
  };
}

/** A light tick on press, so taps feel physical. Fails silently where the device has no haptics. */
export const tapFeedback = () => { Haptics.selectionAsync().catch(() => undefined); };

export function Button({ title, onPress, kind = 'primary', disabled, accessibilityHint, icon }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary'; disabled?: boolean; accessibilityHint?: string; icon?: IconName;
}) {
  const t = useTheme();
  const primary = kind === 'primary';
  const color = primary ? t.onAccent : t.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { tapFeedback(); onPress(); }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? t.accent : t.accentSoft, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      {icon && <Icon name={icon} size={20} color={color} />}
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ title, children, right, icon }: { title: string; children: ReactNode; right?: ReactNode; icon?: IconName }) {
  const t = useTheme();
  return (
    <View style={[styles.card, t.dark ? { backgroundColor: t.card, borderColor: t.border, borderWidth: 1 } : { backgroundColor: t.card, ...styles.cardShadow }]} accessibilityRole="summary">
      <View style={styles.cardHead}>
        <View style={styles.cardTitleRow}>
          {icon && (
            <View style={[styles.cardIcon, { backgroundColor: t.accentSoft }]}>
              <Icon name={icon} size={18} color={t.accent} />
            </View>
          )}
          <Text style={[styles.cardTitle, { color: t.text }]} accessibilityRole="header">{title}</Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const t = useTheme();
  return <Text style={[styles.body, { color: muted ? t.muted : t.text }]}>{children}</Text>;
}

const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

export function ConfidenceBadge({ a }: { a: Attribution }) {
  const t = useTheme();
  const color = a.confidence === 'high' ? t.accent : a.confidence === 'medium' ? t.warn : t.bad;
  return (
    <Text style={[styles.badge, { color, borderColor: color }]} accessibilityLabel={`${CONFIDENCE_LABEL[a.confidence]}, ${a.basis}`}>
      {a.confidence} · {a.basis}
    </Text>
  );
}

/**
 * Renders a Site Profile layer: its content with source/licence/date, or an explicit unavailable state.
 * With `summary`, the card starts collapsed to that one line and expands on tap.
 */
export function LayerCard<T>({ title, layer, children, summary, icon }: {
  title: string; layer: Layer<T> | undefined; children: (v: T) => ReactNode; summary?: (v: T) => string; icon?: IconName;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  if (!layer) {
    return (
      <Card title={title} icon={icon}>
        <ActivityIndicator accessibilityLabel={`Loading ${title}`} />
      </Card>
    );
  }
  if (layer.status === 'unavailable') {
    return (
      <Card title={title} icon={icon} right={<Text style={[styles.badge, { color: t.muted, borderColor: t.muted }]}>unavailable</Text>}>
        <Body muted>{layer.reason}</Body>
        <Text style={[styles.source, { color: t.muted }]}>Source tried: {layer.source}{layer.retryable ? ' · tap Refresh to try again' : ''}</Text>
      </Card>
    );
  }
  const a = layer.attribution;
  if (summary && !open) {
    return (
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: false }} accessibilityHint="Shows the details and sources" onPress={() => setOpen(true)}>
        <Card title={title} icon={icon} right={<ConfidenceBadge a={a} />}>
          <Body>{summary(layer.value)}</Body>
          <Text style={[styles.more, { color: t.accent }]}>Details ▾</Text>
        </Card>
      </Pressable>
    );
  }
  return (
    <Card title={title} icon={icon} right={<ConfidenceBadge a={a} />}>
      {children(layer.value)}
      {a.notes?.map((n, i) => (
        <Text key={i} style={[styles.note, { color: t.muted }]}>• {n}</Text>
      ))}
      <Text style={[styles.source, { color: t.muted }]}>
        {a.source}{a.resolution ? ` · ${a.resolution}` : ''} · retrieved {a.retrievedAt.slice(0, 10)}
      </Text>
      <Text style={[styles.source, { color: t.muted }]}>{a.license}</Text>
      {summary && (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: true }} onPress={() => setOpen(false)}>
          <Text style={[styles.more, { color: t.accent }]}>Less ▴</Text>
        </Pressable>
      )}
    </Card>
  );
}

export const LEGAL_DISCLAIMER =
  'Parcel lines from GIS are approximate and are not a legal survey. Use a licensed surveyor for fences, setbacks and structures.';

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  card: { borderRadius: 18, padding: 16, marginBottom: 14 },
  cardShadow: { elevation: 2, shadowColor: '#1b2a1e', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  cardIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  body: { fontSize: 15, lineHeight: 21 },
  badge: { fontSize: 12, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  note: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  source: { fontSize: 12, marginTop: 6 },
  more: { fontSize: 14, fontWeight: '600', marginTop: 8 },
});
