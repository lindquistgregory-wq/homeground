/** Small shared UI pieces. Colours meet WCAG AA against their backgrounds (§11 accessibility). */
import type { Attribution, Layer } from '@homeground/core';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    bg: dark ? '#141613' : '#f7f6f1',
    card: dark ? '#1f221e' : '#ffffff',
    text: dark ? '#eceee8' : '#1c1f1a',
    muted: dark ? '#a9aea3' : '#5a6055',
    accent: dark ? '#9ccf6a' : '#3f6b1f',
    border: dark ? '#2f332d' : '#e2e1d8',
    warn: dark ? '#f2c14e' : '#8a5a00',
    bad: dark ? '#ff8a80' : '#a4262c',
  };
}

export function Button({ title, onPress, kind = 'primary', disabled, accessibilityHint }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary'; disabled?: boolean; accessibilityHint?: string;
}) {
  const t = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? t.accent : 'transparent', borderColor: t.accent, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? (t.dark ? '#10200a' : '#ffffff') : t.accent }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]} accessibilityRole="summary">
      <View style={styles.cardHead}>
        <Text style={[styles.cardTitle, { color: t.text }]} accessibilityRole="header">{title}</Text>
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

/** Renders a Site Profile layer: its content with source/licence/date, or an explicit unavailable state. */
export function LayerCard<T>({ title, layer, children }: { title: string; layer: Layer<T> | undefined; children: (v: T) => ReactNode }) {
  const t = useTheme();
  if (!layer) {
    return (
      <Card title={title}>
        <ActivityIndicator accessibilityLabel={`Loading ${title}`} />
      </Card>
    );
  }
  if (layer.status === 'unavailable') {
    return (
      <Card title={title} right={<Text style={[styles.badge, { color: t.muted, borderColor: t.muted }]}>unavailable</Text>}>
        <Body muted>{layer.reason}</Body>
        <Text style={[styles.source, { color: t.muted }]}>Source tried: {layer.source}{layer.retryable ? ' · will retry' : ''}</Text>
      </Card>
    );
  }
  const a = layer.attribution;
  return (
    <Card title={title} right={<ConfidenceBadge a={a} />}>
      {children(layer.value)}
      {a.notes?.map((n, i) => (
        <Text key={i} style={[styles.note, { color: t.muted }]}>• {n}</Text>
      ))}
      <Text style={[styles.source, { color: t.muted }]}>
        {a.source}{a.resolution ? ` · ${a.resolution}` : ''} · retrieved {a.retrievedAt.slice(0, 10)}
      </Text>
      <Text style={[styles.source, { color: t.muted }]}>{a.license}</Text>
    </Card>
  );
}

export const LEGAL_DISCLAIMER =
  'Parcel lines from GIS are approximate and are not a legal survey. Use a licensed surveyor for fences, setbacks and structures.';

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 10, borderWidth: 2, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTitle: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  body: { fontSize: 15, lineHeight: 21 },
  badge: { fontSize: 12, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  note: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  source: { fontSize: 12, marginTop: 6 },
});
