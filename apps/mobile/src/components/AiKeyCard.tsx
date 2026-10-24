/**
 * Settings: where AI bed suggestions come from. The phone's own AI is used when there is one; the
 * owner can add their own Claude API key instead (kept in the keychain, billed to their Anthropic
 * account). Plotwright never supplies or pays for a key.
 */
import { useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { aiSource, deleteClaudeKey, getClaudeKey, setClaudeKey, type AiSource } from '../services/bedAi';
import { Text, TextInput } from './Text';
import { Body, Button, Card, useTheme } from './ui';

export function AiKeyCard() {
  const t = useTheme();
  const [source, setSource] = useState<AiSource | null | undefined>(undefined);
  const [hasKey, setHasKey] = useState(false);
  const [draft, setDraft] = useState('');
  const refresh = async () => { setHasKey(!!(await getClaudeKey())); setSource(await aiSource().catch(() => null)); };
  useEffect(() => { void refresh(); }, []);
  const looksLikeKey = /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(draft.trim());

  return (
    <Card title="AI suggestions" icon="auto-fix">
      <Body>“Ask AI” on a bed suggests plants that go together. The built-in suggestions are free, work offline and need nothing here.</Body>
      <Text style={{ color: t.text, marginTop: 6 }}>
        {source === 'device' ? 'Using the AI on this phone: free, and nothing leaves the phone.'
          : source === 'claude' ? 'Using your own Claude API key.'
          : source === null ? 'This phone has no on-device AI. Add your own Claude API key to use AI.' : ''}
      </Text>
      {hasKey ? (
        <View>
          <Body muted>Your Claude key is saved in this phone’s secure storage{source === 'device' ? ' (used only when the on-device AI isn’t available)' : ''}.</Body>
          <Button title="Remove my Claude key" kind="secondary" onPress={() => Alert.alert('Remove your Claude key?', 'AI suggestions will use the on-device AI if this phone has one.', [
            { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await deleteClaudeKey(); await refresh(); } },
          ])} />
        </View>
      ) : (
        <View>
          <TextInput value={draft} onChangeText={setDraft} placeholder="Your Claude API key (sk-ant-…)" placeholderTextColor={t.muted} secureTextEntry autoCapitalize="none" autoCorrect={false}
            accessibilityLabel="Your Claude API key" style={{ borderWidth: 1, borderColor: draft && !looksLikeKey ? t.bad : t.border, borderRadius: 8, minHeight: 44, paddingHorizontal: 10, color: t.text, fontSize: 16, marginTop: 6 }} />
          <Button title="Save key" disabled={!looksLikeKey} onPress={async () => { await setClaudeKey(draft); setDraft(''); await refresh(); }} />
        </View>
      )}
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>
        Optional. Requests with your key are billed to your Anthropic account (usually a fraction of a cent each). Only a bed’s conditions and its plant list are sent, never your location, names or photos. Create a key at console.anthropic.com.
      </Text>
      <Button title="Get a Claude API key" kind="secondary" onPress={() => void Linking.openURL('https://console.anthropic.com/settings/keys')} />
    </Card>
  );
}
