/**
 * Import animals from CSV (prompt §6), like the sensor CSV import: pick a file, preview what will
 * be added and which rows have problems, then import. The template is written by the app itself.
 * Sire and dam names link to animals of the same species in the file or already on the phone.
 */
import { HOUSEHOLD, allAnimals, animalCsvTemplate, parseAnimalCsv, searchAnimals, type AnimalCsvImport, type AnimalRecord } from '@plotwright/core';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { Text } from '../../src/components/Text';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { listAnimals, saveRecord } from '../../src/db/records';
import { refreshHealthReminders } from '../../src/services/healthReminders';
import { shareTemplate } from '../../src/services/recordsExport';
import { useSettings } from '../../src/services/settings';

/** An id, a common name or alias ("goat", "hens"), or dog/cat/pet. Only exact or single matches count. */
function resolveSpecies(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (s in HOUSEHOLD) return s;
  const pet = ({ dog: 'household:dog', cat: 'household:cat', pet: 'household:other', 'other pet': 'household:other' } as Record<string, string>)[s];
  if (pet) return pet;
  const byId = allAnimals().find((a) => a.id === s || a.commonName.toLowerCase() === s);
  if (byId) return byId.id;
  const hits = searchAnimals(s);
  return hits.length === 1 ? hits[0]!.id : undefined;
}

export default function ImportAnimals() {
  const { parcelId } = useLocalSearchParams<{ parcelId?: string }>();
  const t = useTheme();
  const showProcessing = useSettings((s) => s.showProcessing);
  const [parsed, setParsed] = useState<(AnimalCsvImport & { file: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'] });
    if (r.canceled || !r.assets[0]) return;
    try {
      const text = await new File(r.assets[0].uri).text();
      setParsed({ ...parseAnimalCsv(text, resolveSpecies, { showProcessing }), file: r.assets[0].name });
    } catch (e) {
      Alert.alert('Import', `Couldn’t read the file: ${(e as Error).message}`);
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const existing = await listAnimals();
      const created: AnimalRecord[] = [];
      for (const a of parsed.animals) created.push(await saveRecord('animals', { ...a, parcelId: a.speciesId.startsWith('household:') ? undefined : parcelId, createdAt: new Date().toISOString() }));
      // Link parents by name within the same species (new rows first, then existing records).
      for (const p of parsed.parents) {
        const child = created[p.row]!;
        const find = (name?: string) => name && [...created, ...existing].find((x) => x.speciesId === child.speciesId && x.id !== child.id && x.name.toLowerCase() === name.toLowerCase());
        const sire = find(p.sire), dam = find(p.dam);
        await saveRecord('animals', {
          ...child, sireId: sire ? sire.id : undefined, damId: dam ? dam.id : undefined,
          outsideSire: !sire && p.sire ? { name: p.sire } : undefined, outsideDam: !dam && p.dam ? { name: p.dam } : undefined,
        });
      }
      await refreshHealthReminders().catch(() => 0);
      Alert.alert('Import', `Added ${created.length} animal${created.length === 1 ? '' : 's'}.`);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card title="From a spreadsheet" icon="file-table-outline">
        <Body>Columns are matched by name: name and species are required; tag, sex, birth_date, breed, color_markings, sire, dam, registration_no, acquired_on, source, status and notes are optional.</Body>
        <Body muted>Species can be a library name (“Dairy goats”, “goat”) or dog, cat or pet. Dates are YYYY-MM-DD. Nothing is guessed: unclear rows are listed and skipped.</Body>
        <Button title="Save the template" kind="secondary" icon="file-download-outline" onPress={() => void shareTemplate(animalCsvTemplate())} />
        <Button title={parsed ? 'Choose a different file' : 'Choose a CSV file'} icon="file-upload-outline" onPress={() => void pick()} />
      </Card>
      {parsed && (
        <Card title={parsed.file} icon="eye-outline">
          <Text style={{ color: t.text, fontWeight: '600' }}>{parsed.animals.length} animal{parsed.animals.length === 1 ? '' : 's'} ready to add</Text>
          {parsed.animals.slice(0, 8).map((a, i) => <Body key={i} muted>• {a.name} ({a.speciesId.replace('household:', '')})</Body>)}
          {parsed.animals.length > 8 && <Body muted>…and {parsed.animals.length - 8} more</Body>}
          {parsed.errors.map((e) => <Text key={e} style={{ color: t.warn }}>{e}</Text>)}
          <Button title={busy ? 'Importing…' : `Import ${parsed.animals.length}`} disabled={busy || !parsed.animals.length} onPress={() => void doImport()} />
        </Card>
      )}
    </ScrollView>
  );
}
