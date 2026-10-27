/**
 * Settings: "Have an access code?" For app reviewers and the owner: a valid code unlocks every paid
 * feature on this phone for 90 days. Hidden until the owner has added a code's fingerprint to the config.
 */
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useEntitlements } from '../billing/entitlements';
import { ACCESS_CODE_HASHES } from '../config';
import { Text, TextInput } from './Text';
import { Body, Button, useTheme } from './ui';

export function AccessCodeField() {
  const t = useTheme();
  const access = useEntitlements((s) => s.access);
  const redeem = useEntitlements((s) => s.redeemCode);
  const clear = useEntitlements((s) => s.clearAccess);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ACCESS_CODE_HASHES.length) return null;

  const active = access && Date.parse(access.expiresAt) > Date.now();
  if (active) {
    const until = new Date(access.expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    return (
      <View style={{ marginTop: 6 }}>
        <Body>Full access with an access code until {until}.</Body>
        <Button title="Remove the access code" kind="secondary" onPress={() => Alert.alert('Remove the access code?', 'Paid features lock again on this phone unless you have a plan.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void clear() },
        ])} />
      </View>
    );
  }

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: t.accent, fontWeight: '600' }}>Have an access code?</Text>
      </Pressable>
    );
  }

  const submit = async () => {
    setBusy(true);
    try {
      const ok = await redeem(code);
      if (ok) { setCode(''); setOpen(false); Alert.alert('Unlocked', 'Every feature is unlocked on this phone for 90 days.'); }
      else Alert.alert('Code not recognised', 'Check the code and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 6 }}>
      <TextInput value={code} onChangeText={setCode} placeholder="Access code" placeholderTextColor={t.muted} autoCapitalize="characters" autoCorrect={false} secureTextEntry
        accessibilityLabel="Access code" style={{ borderWidth: 1, borderColor: t.border, borderRadius: 8, minHeight: 44, paddingHorizontal: 10, color: t.text, fontSize: 16 }} />
      <Button title={busy ? 'Checking…' : 'Unlock'} disabled={busy || code.trim().length < 6} onPress={() => void submit()} />
      <Text style={{ color: t.muted, fontSize: 12 }}>For app reviewers and the developer. Unlocks every paid feature on this phone for 90 days.</Text>
    </View>
  );
}
