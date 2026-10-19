/**
 * Pedigree (prompt §7; Herd Book): ancestors to 4 generations (more on request), the animal's own
 * COI and how complete its pedigree is, offspring, a relatedness check against any other animal of
 * the species, and a PDF of the tree.
 */
import { Pedigree, animalById, shallowPedigreeWarning, type AnimalRecord, type PedigreeNode } from '@plotwright/core';
import { router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Text } from '../../src/components/Text';
import { Chip } from '../../src/components/plants';
import { EmptyState } from '../../src/components/kit';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { useEntitlements } from '../../src/billing/entitlements';
import { listAnimals } from '../../src/db/records';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export default function PedigreeScreen() {
  const { animalId } = useLocalSearchParams<{ animalId: string }>();
  const t = useTheme();
  const ent = useEntitlements((s) => s.entitlements);
  const [animals, setAnimals] = useState<AnimalRecord[] | null>(null);
  const [gens, setGens] = useState(4);
  const [other, setOther] = useState<string | null>(null);
  useEffect(() => { void listAnimals().then(setAnimals); }, []);

  const me = animals?.find((a) => a.id === animalId);
  const p = useMemo(() => (animals && me ? new Pedigree(animals.filter((a) => a.speciesId === me.speciesId)) : null), [animals, me]);

  if (!ent.has('livestock.herdBook'))
    return <View style={{ padding: 16 }}><EmptyState icon="family-tree" title="Herd Book" text="Pedigrees and relatedness are part of the Herd Book (Grower and Homestead Pro)." action="See plans" onAction={() => router.push({ pathname: '/paywall', params: { feature: 'livestock.herdBook', source: 'pedigree' } })} /></View>;
  if (!animals) return <Body>Loading…</Body>;
  if (!me || !p) return <Body>This animal is no longer on this phone.</Body>;

  const tree = p.tree(me.id, gens);
  const depth = p.pedigreeDepth(me.id);
  const shallow = shallowPedigreeWarning(depth);
  const kids = p.offspring(me.id);
  const peers = animals.filter((a) => a.speciesId === me.speciesId && a.id !== me.id);

  const exportPdf = async () => {
    const rows: string[] = [];
    const walk = (n: PedigreeNode | undefined, g: number, role: string) => {
      if (!n || g > gens) return;
      rows.push(`<div style="margin-left:${g * 14}px">${esc(role)}: <b>${esc(n.name)}</b>${n.coi ? ` (COI ${pct(n.coi)})` : ''}${n.unknown ? ' — unknown' : n.outside ? ' — outside animal' : ''}</div>`);
      walk(n.sire, g + 1, 'Sire'); walk(n.dam, g + 1, 'Dam');
    };
    walk(tree, 0, 'Animal');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,Roboto,sans-serif;font-size:10pt;line-height:1.5}</style></head><body>
      <h1>${esc(me.name)}: pedigree</h1><p>${esc(animalById(me.speciesId)?.commonName ?? me.speciesId)}${me.registrationNo ? ` · Reg. ${esc(me.registrationNo)}` : ''} · COI ${pct(p.coi(me.id))}</p>
      ${rows.join('')}${shallow ? `<p>${esc(shallow)}</p>` : ''}<p>From the owner’s records in Plotwright.</p></body></html>`;
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Pedigree of ${me.name}` });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: t.text, fontSize: 24, fontWeight: '700' }} accessibilityRole="header">{me.name}</Text>
      <Body>Inbreeding (COI): {pct(p.coi(me.id))} · pedigree {Math.round(depth.completeness * 100)}% complete over 4 generations</Body>
      {shallow && <Text style={{ color: t.warn, marginTop: 4 }}>{shallow}</Text>}

      <Card title="Ancestors" icon="family-tree">
        <Node n={tree} g={0} role="" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[4, 6, 8].map((g) => <Chip key={g} label={`${g} generations`} active={gens === g} onPress={() => setGens(g)} />)}
        </View>
      </Card>

      <Card title={`Offspring (${kids.length})`} icon="account-child-outline">
        {kids.length ? kids.map((k) => <Text key={k.id} accessibilityRole="link" onPress={() => router.push({ pathname: '/herdbook/[animalId]', params: { animalId: k.id } })} style={{ color: t.accent, paddingVertical: 3 }}>{k.name}{k.birthDate ? ` (${k.birthDate})` : ''}</Text>) : <Body muted>None recorded.</Body>}
      </Card>

      <Card title="How related is…" icon="vector-link">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{peers.slice(0, 30).map((a) => <Chip key={a.id} label={a.name} active={other === a.id} onPress={() => setOther(a.id)} />)}</View>
        {other && (() => {
          const o = peers.find((a) => a.id === other)!;
          const r = p.relatedness(me.id, o.id);
          const pair = me.sex !== o.sex && (me.sex === 'male' || o.sex === 'male') ? p.pairingCoi(me.id, o.id) : null;
          return (
            <View style={{ marginTop: 6 }}>
              <Body>{me.name} and {o.name}: relationship {pct(r)}{r === 0 ? ' (no shared ancestors recorded)' : ''}.</Body>
              {pair !== null && <Body>Offspring of these two would have an expected COI of {pct(pair)}.</Body>}
            </View>
          );
        })()}
      </Card>
      <Button title="Pedigree (PDF)" kind="secondary" icon="file-pdf-box" onPress={() => void exportPdf().catch((e: Error) => Alert.alert('Export', e.message))} />
    </ScrollView>
  );
}

function Node({ n, g, role }: { n?: PedigreeNode; g: number; role: string }) {
  const t = useTheme();
  if (!n) return null;
  return (
    <View style={{ marginLeft: g ? 14 : 0, borderLeftWidth: g ? 1 : 0, borderColor: t.border, paddingLeft: g ? 8 : 0, marginVertical: 2 }}>
      <Text style={{ color: n.unknown ? t.muted : t.text, fontWeight: g === 0 ? '700' : '400' }}>
        {role ? `${role}: ` : ''}{n.name}{n.coi ? ` · COI ${pct(n.coi)}` : ''}{n.outside ? ' (outside)' : ''}
      </Text>
      {(n.sire || n.dam) && <><Node n={n.sire} g={g + 1} role="Sire" /><Node n={n.dam} g={g + 1} role="Dam" /></>}
    </View>
  );
}
