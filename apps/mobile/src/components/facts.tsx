/** Key Site Profile facts as chips, shared by the home screen's property cards and the Site Profile summary. */
import { formatDoy } from '@plotwright/core';
import type { SiteProfile } from '@plotwright/providers';
import { StyleSheet, View } from 'react-native';
import type { IconName } from './Icon';
import { Pill } from './kit';

/** The few facts worth seeing at a glance (skipped when a layer is missing or unavailable). */
export function keyFacts(p: Partial<SiteProfile> | null | undefined): string[] {
  if (!p) return [];
  const facts: string[] = [];
  if (p.hardiness?.status === 'ok') facts.push(`Zone ${p.hardiness.value.zone}`);
  if (p.climate?.status === 'ok' && !p.climate.value.frost.dates.freezeRare) {
    const last = p.climate.value.frost.dates.lastSpring[32][50];
    const first = p.climate.value.frost.dates.firstFall[32][50];
    if (last !== null) facts.push(`Last frost ${formatDoy(last)}`);
    if (first !== null) facts.push(`First frost ${formatDoy(first)}`);
  }
  const soil = p.soils?.status === 'ok' ? p.soils.value.units[0]?.name : undefined;
  if (soil) facts.push(soil.split(',')[0]!);
  return facts;
}

const factIcon = (f: string): IconName =>
  f.startsWith('Zone') ? 'thermometer' : f.startsWith('Last frost') ? 'snowflake' : f.startsWith('First frost') ? 'snowflake-alert' : 'shovel';

export function FactChips({ profile }: { profile: Partial<SiteProfile> | null | undefined }) {
  const facts = keyFacts(profile);
  if (!facts.length) return null;
  return (
    <View style={styles.facts}>
      {facts.map((f) => <Pill key={f} icon={factIcon(f)} text={f} tone={f.startsWith('Zone') ? 'accent' : 'neutral'} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
});
