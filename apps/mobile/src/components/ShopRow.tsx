/**
 * "Shop supplies" (prompt §10): plain rows with a "Paid link" label and a one-line disclosure,
 * only for programs the owner activated, only on plant and animal detail, and only while
 * "Show shopping links" is on. Opens in the phone's browser. Renders nothing otherwise.
 */
import { affiliateLinks, type AffiliatePlacement } from '@plotwright/core';
import { affiliateRegistry } from '@plotwright/data';
import { Linking, Pressable, View } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { Card, useTheme } from './ui';
import { useSettings } from '../services/settings';

export function ShopRow({ placement, topic }: { placement: AffiliatePlacement; topic: string }) {
  const t = useTheme();
  const on = useSettings((s) => s.showShopping);
  const links = on ? affiliateLinks(affiliateRegistry(), placement, topic) : [];
  if (!links.length) return null;
  return (
    <Card title="Shop supplies" icon="storefront-outline">
      <Text style={{ color: t.muted, fontSize: 13, marginBottom: 4 }}>Plotwright earns a commission on purchases from these links.</Text>
      {links.map((l) => (
        <Pressable key={l.programId} accessibilityRole="link" accessibilityLabel={`${l.name}, paid link, opens your browser`} onPress={() => void Linking.openURL(l.url)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
          <Icon name="open-in-new" size={16} color={t.accent} />
          <Text style={{ color: t.accent, flex: 1 }}>{l.name}: {topic}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>Paid link</Text>
        </Pressable>
      ))}
      {links.some((l) => /Amazon Associate/.test(l.disclosure)) && <View><Text style={{ color: t.muted, fontSize: 12 }}>As an Amazon Associate I earn from qualifying purchases.</Text></View>}
    </Card>
  );
}
