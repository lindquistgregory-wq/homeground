/**
 * Disclosures (prompt §10; FTC Endorsement Guides): which shopping programs pay Plotwright a
 * commission, what the links carry, and the Amazon statement when Amazon links are active.
 */
import { activePrograms } from '@plotwright/core';
import { affiliateRegistry } from '@plotwright/data';
import { ScrollView } from 'react-native';
import { Body, Card } from '../src/components/ui';

export default function Disclosures() {
  const active = activePrograms(affiliateRegistry());
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card title="Paid links" icon="storefront-outline">
        {active.length ? (
          <>
            <Body>Plotwright earns a commission on purchases from links labelled “Paid link”. They appear only as “Shop supplies” on plant and animal pages, never on health records, alerts, the vet export or safety notes, and never next to anything about medication or disease.</Body>
            {active.map((p) => <Body key={p.id}>• {p.name}{p.termsCheckedOn ? ` (terms checked ${p.termsCheckedOn})` : ''}</Body>)}
            {active.some((p) => p.id === 'amazon') && <Body>As an Amazon Associate I earn from qualifying purchases.</Body>}
          </>
        ) : <Body>Plotwright doesn’t show any paid links at the moment.</Body>}
        <Body muted>Links carry only a product search term such as “chicken feeder”: never your property, location, animals or records. They open in your phone’s browser. You can turn them off in More.</Body>
      </Card>
      <Card title="Ads" icon="bullhorn-outline">
        <Body muted>The free plan shows a few ads on browse screens. Ads are never chosen using your animal or pet health records, and never appear with alerts, health records or the vet export.</Body>
      </Card>
    </ScrollView>
  );
}
