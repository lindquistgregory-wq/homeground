/**
 * "Find a vet" (prompt §10): a free public locator for pets (AAHA's accredited-hospital search),
 * and for farm animals, where there's no national locator, the extension office or the state
 * veterinary medical association. Opens in the phone's browser; no referral or tracking.
 */
import { Linking } from 'react-native';
import { Text } from './Text';
import { useTheme } from './ui';

export const AAHA_LOCATOR_URL = 'https://www.aaha.org/your-pet/hospital-locator/';

export function FindAVet({ pet }: { pet: boolean }) {
  const t = useTheme();
  return pet ? (
    <Text accessibilityRole="link" onPress={() => void Linking.openURL(AAHA_LOCATOR_URL)} style={{ color: t.accent, paddingVertical: 4 }}>
      Find an accredited animal hospital near you (AAHA) ↗
    </Text>
  ) : (
    <Text style={{ color: t.muted, fontSize: 13, paddingVertical: 4 }}>
      Need a farm-animal vet? Your county extension office or state veterinary medical association can point you to one.
    </Text>
  );
}
