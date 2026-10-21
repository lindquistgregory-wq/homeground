/** Name a herd or animal on the map ("Bruno", "The girls"); clearing it goes back to "1 livestock guardian dog". */
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import type { Herd } from '../db/herds';
import { herdCount } from '../services/animals';
import { useTheme } from './ui';

export function HerdNameField({ herd, onSave }: { herd: Herd; onSave: (name: string | undefined) => void | Promise<void> }) {
  const t = useTheme();
  const [v, setV] = useState(herd.name ?? '');
  useEffect(() => setV(herd.name ?? ''), [herd.id, herd.name]);
  const commit = () => { const n = v.trim(); if (n !== (herd.name ?? '')) void onSave(n || undefined); };
  return (
    <TextInput value={v} onChangeText={setV} onEndEditing={commit} onSubmitEditing={commit} returnKeyType="done" maxLength={40}
      placeholder={`Name (optional), e.g. ${herd.count === 1 ? 'Bruno' : 'The girls'}`} placeholderTextColor={t.muted}
      accessibilityLabel={`Name for ${herdCount(herd)}`} style={[styles.input, { color: t.text, borderColor: t.border }]} />
  );
}

const styles = StyleSheet.create({ input: { borderWidth: 1, borderRadius: 10, padding: 10, marginVertical: 6, fontSize: 15 } });
