/** Shared pieces for the planting screens: verdict badges, factor lists, calendars, bed layouts. */
import { formatDoy, type BedLayout, type CalendarEvent, type Factor, type PlantCalendar, type Suitability } from '@plotwright/core';
import type { ExtensionLink } from '@plotwright/data';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { Body, useTheme } from './ui';

const VERDICT_LABEL: Record<Suitability['verdict'], string> = {
  great: 'Great fit', good: 'Good fit', fair: 'Fair', poor: 'Poor fit', 'not-suitable': 'Not suitable',
};

export function VerdictBadge({ s }: { s: Pick<Suitability, 'verdict' | 'score'> }) {
  const t = useTheme();
  const color = s.verdict === 'great' || s.verdict === 'good' ? t.accent : s.verdict === 'fair' ? t.warn : t.bad;
  return (
    <Text style={[styles.badge, { color, borderColor: color }]} accessibilityLabel={`${VERDICT_LABEL[s.verdict]}, ${s.score} out of 100`}>
      {VERDICT_LABEL[s.verdict]} · {s.score}
    </Text>
  );
}

const STATUS_MARK: Record<Factor['status'], string> = { good: '✓', ok: '○', warn: '!', fail: '✕' };

export function FactorList({ factors }: { factors: Factor[] }) {
  const t = useTheme();
  const color = (f: Factor) => (f.status === 'good' ? t.accent : f.status === 'ok' ? t.text : f.status === 'warn' ? t.warn : t.bad);
  return (
    <View>
      {[...factors].sort((a, b) => a.score * a.weight - b.score * b.weight).map((f) => (
        <View key={f.key} style={styles.factor} accessible accessibilityLabel={`${f.label}: ${f.status}. ${f.detail}`}>
          <Text style={[styles.mark, { color: color(f) }]}>{STATUS_MARK[f.status]}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '600' }}>{f.label} <Text style={{ color: t.muted, fontWeight: '400' }}>(weight {f.weight})</Text></Text>
            <Body muted>{f.detail}</Body>
          </View>
        </View>
      ))}
    </View>
  );
}

const range = (e: Pick<CalendarEvent, 'start' | 'end'>) => (e.start === e.end ? formatDoy(e.start) : `${formatDoy(e.start)} – ${formatDoy(e.end)}`);

export function CalendarList({ cal, showBasis = true }: { cal: PlantCalendar; showBasis?: boolean }) {
  const t = useTheme();
  return (
    <View>
      {cal.warnings.map((w, i) => (
        <Text key={`w${i}`} style={{ color: t.warn, marginBottom: 4 }}>• {w}</Text>
      ))}
      {cal.events.map((e, i) => (
        <View key={i} style={styles.event} accessible accessibilityLabel={`${e.label}: ${range(e)}. Based on ${e.basis}.`}>
          <Text style={{ color: t.text, fontWeight: '600' }}>{e.label}</Text>
          <Text style={{ color: t.text }}>{range(e)}</Text>
          {showBasis && <Text style={{ color: t.muted, fontSize: 13 }}>{e.basis}</Text>}
        </View>
      ))}
    </View>
  );
}

export function ExternalLink({ link, prefix }: { link: ExtensionLink; prefix?: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(link.url)} style={{ paddingVertical: 8 }}>
      <Text style={{ color: t.accent, fontWeight: '600' }}>{prefix ? `${prefix}: ` : ''}{link.title} ↗</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>{link.publisher}</Text>
    </Pressable>
  );
}

/** To-scale plan of a bed with one dot per plant. x runs along the bed's length. */
export function LayoutSvg({ layout, widthM, lengthM, share = 1, spreadM }: { layout: BedLayout; widthM: number; lengthM: number; share?: number; spreadM: number }) {
  const t = useTheme();
  const W = 320;
  const scale = W / Math.max(lengthM, 0.1);
  const H = Math.max(24, widthM * scale);
  const r = Math.max(2, Math.min((spreadM / 2) * scale, 40));
  return (
    <View accessible accessibilityLabel={`Layout: ${layout.plantCount} plants in ${layout.rows} rows of ${layout.perRow}`}>
      <Svg width={W} height={Math.min(H, 240)} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} fill={t.dark ? '#3a2e22' : '#8b6b4a'} opacity={0.35} stroke={t.border} />
        {share < 1 && <Rect x={share * W} y={0} width={(1 - share) * W} height={H} fill={t.bg} opacity={0.6} />}
        {layout.positions.slice(0, 2000).map(([x, y], i) => (
          <Circle key={i} cx={x * scale} cy={y * scale} r={r} fill={t.accent} opacity={0.45} />
        ))}
      </Svg>
    </View>
  );
}

/** Shown when the site profile predates the planting guide's climate layers. */
export function StaleProfileNotice({ parcelId }: { parcelId: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/profile/[id]', params: { id: parcelId } })}
      style={[styles.notice, { borderColor: t.warn }]}>
      <Text style={{ color: t.warn, fontWeight: '600' }}>Update the site profile for soil-temperature and heat timing</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>Opening it rebuilds the profile with the climate data this guide uses. Tap to open.</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, disabled }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active, disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={[styles.chip, { borderColor: active ? t.accent : t.border, backgroundColor: active ? t.accent : 'transparent', opacity: disabled ? 0.5 : 1 }]}>
      <Text style={{ color: active ? (t.dark ? '#10200a' : '#ffffff') : t.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { fontSize: 12, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  factor: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  mark: { width: 16, fontWeight: '700', fontSize: 15 },
  event: { marginBottom: 10 },
  notice: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', marginRight: 6, marginBottom: 6 },
});
