/**
 * Herd Book (prompt §7; paid, `livestock.herdBook`): breeding suggestions per female with the
 * reasons, the inbreeding (COI) limit, the herd-level trend, and a season plan as PDF. Records,
 * health and welfare stay free; pets are never included.
 */
import {
  COI_DEFAULT_LIMIT, COI_MAX_LIMIT, Pedigree, animalById, coiLimit, estimateMerit, herdInbreedingTrend, isHousehold, meritTrait, suggestMates,
  type AnimalLog, type AnimalRecord, type BreedingSuggestion, type Excluded,
} from '@plotwright/core';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Text } from '../../src/components/Text';
import { AnimalArt } from '../../src/components/AnimalArt';
import { Chip } from '../../src/components/plants';
import { EmptyState, MoreInfo } from '../../src/components/kit';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { useEntitlements } from '../../src/billing/entitlements';
import { kvGet, kvSet } from '../../src/db/database';
import { allRecords, listAnimals } from '../../src/db/records';
import { askHerdBook } from '../../src/services/herdBookAi';
import { localToday } from '../../src/services/animals';

const LIMIT_KEY = 'herdbook.coiLimit';
const ACK_KEY = 'herdbook.coiAck';
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export default function HerdBook() {
  const params = useLocalSearchParams<{ speciesId?: string }>();
  const t = useTheme();
  const ent = useEntitlements((s) => s.entitlements);
  const [animals, setAnimals] = useState<AnimalRecord[] | null>(null);
  const [logs, setLogs] = useState<AnimalLog[]>([]);
  const [species, setSpecies] = useState<string | undefined>(params.speciesId);
  const [limit, setLimit] = useState(COI_DEFAULT_LIMIT);
  const [ack, setAck] = useState(false);
  const [answer, setAnswer] = useState<{ key: string; text: string; source: string } | null>(null);

  useFocusEffect(useCallback(() => {
    void (async () => {
      const all = (await listAnimals()).filter((a) => !isHousehold(a.speciesId));
      setAnimals(all);
      setLogs(await allRecords('animalLogs'));
      const acked = (await kvGet(ACK_KEY)) === '1';
      setAck(acked);
      setLimit(coiLimit(Number((await kvGet(LIMIT_KEY)) ?? COI_DEFAULT_LIMIT), acked));
    })();
  }, []));

  // Species with at least one female and one male recorded.
  const speciesList = useMemo(() => [...new Set((animals ?? []).map((a) => a.speciesId))].filter((id) => (animals ?? []).some((a) => a.speciesId === id && a.sex === 'female') && (animals ?? []).some((a) => a.speciesId === id && a.sex === 'male')), [animals]);
  const sp = species ?? speciesList[0];
  const spec = sp ? animalById(sp) : undefined;

  const result = useMemo(() => {
    if (!animals || !sp) return null;
    const mine = animals.filter((a) => a.speciesId === sp);
    const p = new Pedigree(mine);
    const trait = meritTrait(spec);
    const merit = trait ? estimateMerit(p, mine, logs, trait.trait, trait.h2) : new Map();
    const live = mine.filter((a) => a.status === 'active');
    const males = live.filter((a) => a.sex === 'male');
    const females = live.filter((a) => a.sex === 'female');
    const plans = females.map((f) => ({ dam: f, ...suggestMates(p, f.id, males, spec, merit, limit) }));
    return { p, trait, merit, plans, trend: herdInbreedingTrend(p, mine), byId: new Map(mine.map((a) => [a.id, a])) };
  }, [animals, logs, sp, spec, limit]);

  if (!ent.has('livestock.herdBook'))
    return (
      <View style={{ padding: 16 }}>
        <EmptyState icon="family-tree" title="Herd Book" text="Pedigrees up to 4 generations and more, inbreeding (COI) for any pairing, breeding merit from your records, and ranked breeding suggestions with the reasons. Part of Grower and Homestead Pro. Animal records, health reminders and alerts stay free."
          action="See plans" onAction={() => router.push({ pathname: '/paywall', params: { feature: 'livestock.herdBook', source: 'herdbook' } })} />
      </View>
    );
  if (!animals) return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading the Herd Book" />;
  if (!sp || !result)
    return (
      <View style={{ padding: 16 }}>
        <EmptyState icon="family-tree" title="Add breeding animals first" text="Record at least one female and one male of a species in My animals (with their parents, where known), and suggestions appear here." action="My animals" onAction={() => router.push('/records')} />
      </View>
    );

  const setLimitTo = async (v: number) => {
    const apply = async (acked: boolean) => { const l = coiLimit(v, acked); setLimit(l); await kvSet(LIMIT_KEY, String(l)); };
    if (v > COI_DEFAULT_LIMIT && !ack)
      return Alert.alert('Raise the inbreeding limit?', 'Under 5% is the most conservative widely cited guidance for avoiding inherited disease. 6.25% (the offspring of first cousins) is a looser rule of thumb and the highest Plotwright allows. No level is entirely safe.', [
        { text: 'Keep under 5%', style: 'cancel' },
        { text: 'I understand, use 6.25%', onPress: async () => { await kvSet(ACK_KEY, '1'); setAck(true); await apply(true); } },
      ]);
    await apply(ack);
  };

  const nameOf = (id: string) => result.byId.get(id)?.name ?? id;
  const explain = async (s: BreedingSuggestion, rank: number) => {
    const key = `${s.damId}|${s.sireId}`;
    setAnswer({ key, text: 'Thinking…', source: '' });
    const facts = [`Dam ${nameOf(s.damId)}, sire ${nameOf(s.sireId)}, ranked #${rank} of the suggestions for her.`, s.why, ...(s.shallow ? [s.shallow] : []), `Suggestions only include pairings below the ${pct(limit)} COI limit; lower COI ranks first when expected merit is similar.`];
    const r = await askHerdBook(`Why is ${nameOf(s.sireId)} ranked #${rank} for ${nameOf(s.damId)}?`, facts, s.why);
    setAnswer({ key, text: r.reply, source: r.source === 'model' ? 'On-device AI, from the figures above' : r.source === 'safety' ? '' : 'Written explanation' });
  };

  const exportPlan = async () => {
    const rows = result.plans.map((pl) => `<tr><td>${esc(pl.dam.name)}</td><td>${pl.suggestions.slice(0, 3).map((s, i) => `${i + 1}. ${esc(nameOf(s.sireId))}: ${esc(s.why)}`).join('<br>') || 'No pairing under the limit'}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,Roboto,sans-serif;font-size:10pt}td,th{border-bottom:1px solid #ccc;padding:4px;vertical-align:top;text-align:left}table{border-collapse:collapse;width:100%}</style></head><body>
      <h1>${esc(spec?.commonName ?? sp)}: breeding plan</h1><p>${localToday()} · COI limit ${pct(limit)} (a precaution, not a guarantee).</p>
      <table><tr><th>Female</th><th>Suggested sires</th></tr>${rows}</table>
      <h2>Herd summary</h2><p>${result.byId.size} recorded, ${result.plans.length} active females. Mean COI by generation: ${result.trend.byGeneration.map((g) => `gen ${g.generation}: ${pct(g.meanCoi)} (${g.animals})`).join('; ') || 'not enough records'}.</p>
      ${result.trend.warning ? `<p><b>Herd trend:</b> ${esc(result.trend.warning)}</p>` : ''}
      <p>Estimated by Plotwright from the owner’s records. Merit figures are rough estimates; COI reads low where pedigrees are shallow.</p></body></html>`;
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Breeding plan' });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {speciesList.length > 1 && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{speciesList.map((id) => <Chip key={id} label={animalById(id)?.commonName ?? id} active={id === sp} onPress={() => setSpecies(id)} />)}</View>}

      <Card title="Inbreeding limit" icon="shield-check-outline">
        <Body>Suggestions only include pairings with an expected COI below {pct(limit)}.</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[0.03, 0.04, COI_DEFAULT_LIMIT, COI_MAX_LIMIT].map((v) => <Chip key={v} label={v === COI_DEFAULT_LIMIT ? 'Under 5% (default)' : v === COI_MAX_LIMIT ? '6.25% (max)' : `Under ${v * 100}%`} active={Math.abs(limit - v) < 1e-9} onPress={() => void setLimitTo(v)} />)}
        </View>
        <Body muted>The limit is a precaution, not a guarantee: no level of inbreeding is entirely safe, and missing ancestors make COI read low.</Body>
        {result.trend.warning && <Text style={{ color: t.warn, marginTop: 6 }}>{result.trend.warning}</Text>}
        {!result.trait && <Body muted>No heritability is sourced for {spec?.commonName.toLowerCase() ?? 'this species'} yet, so pairings are ranked by inbreeding only.</Body>}
      </Card>

      {result.plans.length === 0 && <Body muted>No active females recorded for this species.</Body>}
      {result.plans.map((pl) => (
        <Card key={pl.dam.id} title={pl.dam.name} icon="heart-outline" right={<Chip label="Pedigree" active={false} onPress={() => router.push({ pathname: '/herdbook/[animalId]', params: { animalId: pl.dam.id } })} />}>
          {result.merit.get(pl.dam.id) && <Body muted>Her {result.trait ? result.trait.trait : ''} merit: {result.merit.get(pl.dam.id)!.low}% to {result.merit.get(pl.dam.id)!.high}% vs herd ({result.merit.get(pl.dam.id)!.label})</Body>}
          {pl.suggestions.length === 0 && <Text style={{ color: t.warn }}>No male is below the limit for her. Unrelated breeding stock would help.</Text>}
          {pl.suggestions.slice(0, 3).map((s, i) => (
            <View key={s.sireId} style={{ flexDirection: 'row', gap: 10, marginVertical: 6 }}>
              <AnimalArt animalId={sp} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{i + 1}. {nameOf(s.sireId)} · COI {pct(s.coi)}</Text>
                <Body muted>{s.why}</Body>
                {s.shallow && <Text style={{ color: t.warn, fontSize: 13 }}>{s.shallow}</Text>}
                {answer?.key === `${s.damId}|${s.sireId}` ? (
                  <View style={{ marginTop: 4 }}>
                    <Body>{answer.text}</Body>
                    {answer.source ? <Text style={{ color: t.muted, fontSize: 12 }}>{answer.source}</Text> : null}
                  </View>
                ) : <Chip label="Explain" active={false} onPress={() => void explain(s, i + 1)} />}
              </View>
            </View>
          ))}
          {pl.excluded.length > 0 && <MoreInfo label={`Not suggested (${pl.excluded.length})`}>{pl.excluded.map((e: Excluded) => <Body key={e.sireId} muted>{nameOf(e.sireId)}: {e.reason}</Body>)}</MoreInfo>}
        </Card>
      ))}
      <Button title="Breeding plan (PDF)" kind="secondary" icon="file-pdf-box" onPress={() => void exportPlan().catch((e: Error) => Alert.alert('Export', e.message))} />
      <Body muted>Suggestions come from your records, worked out on this phone. Merit is a rough estimate shown as a range. For health questions, ask your veterinarian.</Body>
    </ScrollView>
  );
}
