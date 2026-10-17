/**
 * First-launch agreement (Safety & Liability Review): a short, plain summary with a real
 * click-to-agree step. The courts' test (Berman v. Freedom Financial, 9th Cir. 2022) is a reasonably
 * conspicuous notice and an action the person is told means agreement, so the sentence above the
 * button says exactly that. Acceptance is stored with the terms version and date, and asked again
 * only when the terms change.
 */
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { Button, useTheme } from './ui';
import { kvGet, kvSet } from '../db/database';
import { APP_TERMS_URL, PRIVACY_POLICY_URL } from '../config';

/** Bump when the terms change in a way people must agree to again. */
export const TERMS_VERSION = '2026-10-16';
const KEY = 'terms.accepted';

export async function termsAccepted(): Promise<boolean> {
  try {
    const v = JSON.parse((await kvGet(KEY)) ?? 'null') as { version?: string } | null;
    return v?.version === TERMS_VERSION;
  } catch {
    return false;
  }
}

export async function acceptTerms(): Promise<void> {
  await kvSet(KEY, JSON.stringify({ version: TERMS_VERSION, at: new Date().toISOString() }));
}

const POINTS: Array<{ icon: IconName; text: string }> = [
  { icon: 'map-legend', text: 'Plotwright is a planning aid. Its maps, figures and suggestions are estimates from public sources, not professional, legal, veterinary or medical advice.' },
  { icon: 'shovel', text: 'You’re responsible for work on your land and for your animals: check local rules, call 811 before digging, and use licensed professionals where the law requires them.' },
  { icon: 'bell-alert-outline', text: 'Alerts can be late or missed and aren’t official warnings. Follow the National Weather Service for watches and warnings.' },
];

export function TermsGate({ onAccept }: { onAccept: () => void }) {
  const t = useTheme();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>Before you start</Text>
      <View style={{ gap: 14 }}>
        {POINTS.map((p) => (
          <View key={p.icon} style={styles.point}>
            <View style={[styles.well, { backgroundColor: t.accentSoft }]}><Icon name={p.icon} size={22} color={t.accent} /></View>
            <Text style={[styles.body, { color: t.text }]}>{p.text}</Text>
          </View>
        ))}
      </View>
      <View style={styles.links}>
        <Text accessibilityRole="link" onPress={() => Linking.openURL(APP_TERMS_URL)} style={{ color: t.accent, fontWeight: '600', padding: 8 }}>Terms of Use</Text>
        <Text accessibilityRole="link" onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} style={{ color: t.accent, fontWeight: '600', padding: 8 }}>Privacy Policy</Text>
      </View>
      <Text style={[styles.small, { color: t.muted }]}>
        By tapping “Agree and continue” you accept the Terms of Use, including the assumption of risk and limits of liability, and confirm you’re 18 or older.
      </Text>
      <Button title="Agree and continue" onPress={() => void acceptTerms().then(onAccept)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 64, gap: 18 },
  title: { fontSize: 28, fontWeight: '700' },
  point: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  well: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, fontSize: 15, lineHeight: 21 },
  links: { flexDirection: 'row', gap: 8, marginLeft: -8 },
  small: { fontSize: 13, lineHeight: 18 },
});
