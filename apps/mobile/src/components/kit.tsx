/**
 * Building blocks for the app's look: icon buttons, action tiles, pills and list rows. Every
 * control is at least 48 dp tall (or wide) for outdoor, gloved use, and carries its own label for
 * screen readers.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text, TextInput } from './Text';
import { Button, tapFeedback, useTheme } from './ui';

/** A round icon-only button. `label` is read by screen readers and shown as a long-press hint. */
export function IconButton({ icon, label, onPress, tone = 'soft', size = 48 }: {
  icon: IconName; label: string; onPress: () => void; tone?: 'soft' | 'solid' | 'plain'; size?: number;
}) {
  const t = useTheme();
  const bg = tone === 'solid' ? t.accent : tone === 'soft' ? t.accentSoft : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => { tapFeedback(); onPress(); }}
      hitSlop={8}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1 }]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} color={tone === 'solid' ? t.onAccent : t.accent} />
    </Pressable>
  );
}

/** A large tappable tile: icon in a tinted well, a short label, and an optional one-line caption. */
export function Tile({ icon, label, caption, onPress }: { icon: IconName; label: string; caption?: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}, ${caption}` : label}
      onPress={() => { tapFeedback(); onPress(); }}
      style={({ pressed }) => [styles.tile, { backgroundColor: t.surface, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
    >
      <View style={[styles.tileIcon, { backgroundColor: t.accentSoft }]}>
        <Icon name={icon} size={26} color={t.accent} />
      </View>
      <Text style={[styles.tileLabel, { color: t.text }]} numberOfLines={1}>{label}</Text>
      {caption ? <Text style={[styles.tileCaption, { color: t.muted }]} numberOfLines={1}>{caption}</Text> : null}
    </Pressable>
  );
}

/** Tiles laid out in equal columns (wraps on narrow screens). */
export function TileRow({ children }: { children: ReactNode }) {
  return <View style={styles.tileRow}>{children}</View>;
}

/** A compact fact: icon and value on a tinted pill (e.g. zone, frost date). */
export function Pill({ icon, text, tone = 'neutral', accessibilityLabel }: { icon?: IconName; text: string; tone?: 'neutral' | 'accent' | 'warn'; accessibilityLabel?: string }) {
  const t = useTheme();
  const fg = tone === 'accent' ? t.accent : tone === 'warn' ? t.warn : t.text;
  const bg = tone === 'accent' ? t.accentSoft : t.surface;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]} accessible accessibilityLabel={accessibilityLabel ?? text}>
      {icon && <Icon name={icon} size={15} color={fg} />}
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

/** A settings-style row: icon, title, optional detail, chevron. */
export function ListRow({ icon, title, detail, onPress }: { icon: IconName; title: string; detail?: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      onPress={() => { tapFeedback(); onPress(); }}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface : 'transparent' }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: t.accentSoft }]}>
        <Icon name={icon} size={20} color={t.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: t.text }]}>{title}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: t.muted }]} numberOfLines={2}>{detail}</Text> : null}
      </View>
      <Icon name="chevron-right" size={22} color={t.muted} />
    </Pressable>
  );
}

/** Facts in a two-column grid: icon, small label, bold value (e.g. Sun · 6+ hours). */
export function FactGrid({ items }: { items: Array<{ icon: IconName; label: string; value: string }> }) {
  const t = useTheme();
  return (
    <View style={styles.factGrid}>
      {items.map((f) => (
        <View key={f.label} style={[styles.fact, { backgroundColor: t.surface }]} accessible accessibilityLabel={`${f.label}: ${f.value}`}>
          <Icon name={f.icon} size={20} color={t.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.factLabel, { color: t.muted }]}>{f.label}</Text>
            <Text style={[styles.factValue, { color: t.text }]}>{f.value}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** A friendly "nothing here yet" panel: a big icon, a title, one sentence and one action. */
export function EmptyState({ icon, title, text, action, onAction, art }: {
  icon: IconName; title: string; text: string; action?: string; onAction?: () => void; art?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[styles.empty, { backgroundColor: t.card, borderColor: t.border }]}>
      {art ?? (
        <View style={[styles.emptyIcon, { backgroundColor: t.accentSoft }]}>
          <Icon name={icon} size={40} color={t.accent} />
        </View>
      )}
      <Text style={[styles.emptyTitle, { color: t.text }]} accessibilityRole="header">{title}</Text>
      <Text style={[styles.emptyText, { color: t.muted }]}>{text}</Text>
      {action && onAction ? <View style={{ alignSelf: 'stretch' }}><Button title={action} onPress={onAction} /></View> : null}
    </View>
  );
}

/** A one-line search box with a magnifier and a clear button. */
export function SearchField({ value, onChangeText, placeholder, accessibilityLabel }: {
  value: string; onChangeText: (s: string) => void; placeholder: string; accessibilityLabel: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: t.card, borderColor: t.border }]}>
      <Icon name="magnify" size={22} color={t.muted} />
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={t.muted}
        accessibilityLabel={accessibilityLabel} autoCorrect={false} numberOfLines={1} returnKeyType="search"
        style={[styles.searchInput, { color: t.text }]}
      />
      {value ? <IconButton icon="close-circle" label="Clear search" tone="plain" size={36} onPress={() => onChangeText('')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  factLabel: { fontSize: 12, fontWeight: '500' },
  factValue: { fontSize: 15, fontWeight: '700' },
  empty: { alignItems: 'center', gap: 10, borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 14 },
  emptyIcon: { width: 84, height: 84, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14, paddingLeft: 12, paddingRight: 4, minHeight: 50 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 8 },
  tile: { flexGrow: 1, flexBasis: 96, minHeight: 104, borderRadius: 16, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tileIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 15, fontWeight: '600' },
  tileCaption: { fontSize: 12 },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowDetail: { fontSize: 13, marginTop: 1 },
});
