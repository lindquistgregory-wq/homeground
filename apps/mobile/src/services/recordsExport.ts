/**
 * Records export (prompt §12, phase 5): CSV per record type, everything as JSON, and the "share
 * with my vet" PDF or CSV for one animal. All on the phone, through the system share sheet.
 */
import {
  animalsCsv, breedingCsv, healthCsv, logsCsv, vetHistoryHtml, type AnimalRecord, type HealthRecord,
} from '@plotwright/core';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { listParcels } from '../db/parcels';
import { herdsForParcel } from '../db/herds';
import { allRecords, listAnimals } from '../db/records';
import { herdLabel } from './animals';
import { speciesName } from './healthReminders';
import { photoBase64 } from './photos';

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'records';
const today = () => new Date().toISOString().slice(0, 10);

async function share(name: string, text: string, mime: string): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: `Share ${name}` });
}

export type RecordsExport = 'animals' | 'logs' | 'health' | 'breeding' | 'json';

/** Names for animals and herds, so exports read without ids. */
async function namers() {
  const animals = await listAnimals();
  const byId = new Map(animals.map((a) => [a.id, a.name]));
  const herdNames = new Map<string, string>();
  for (const p of await listParcels()) for (const h of await herdsForParcel(p.id)) herdNames.set(h.id, herdLabel(h));
  const owner = (r: { animalId?: string; herdId?: string }) => (r.animalId ? byId.get(r.animalId) : r.herdId ? herdNames.get(r.herdId) : undefined) ?? '';
  return { animals, name: (id?: string) => (id ? byId.get(id) : undefined), owner };
}

export async function exportRecords(kind: RecordsExport): Promise<void> {
  const n = await namers();
  const stamp = today();
  if (kind === 'animals') return share(`animals-${stamp}.csv`, animalsCsv(n.animals, n.name), 'text/csv');
  if (kind === 'logs') return share(`production-${stamp}.csv`, logsCsv(await allRecords('animalLogs'), n.owner), 'text/csv');
  if (kind === 'health') return share(`health-${stamp}.csv`, healthCsv(await allRecords('healthRecords'), n.owner), 'text/csv');
  if (kind === 'breeding') return share(`breeding-${stamp}.csv`, breedingCsv(await allRecords('breedingRecords'), n.name), 'text/csv');
  const all = {
    exportedAt: new Date().toISOString(), app: 'Plotwright',
    animals: n.animals,
    // Full-size photos from this phone (WebP, base64), keyed by photo id; other devices hold only thumbnails.
    photos: Object.fromEntries((await Promise.all(n.animals.flatMap((a) => a.photos ?? []).map(async (p) => [p.id, await photoBase64(p)] as const))).filter(([, v]) => v)),
    productionLogs: await allRecords('animalLogs'), breedingRecords: await allRecords('breedingRecords'), healthRecords: await allRecords('healthRecords'),
  };
  return share(`plotwright-animal-records-${stamp}.json`, JSON.stringify(all, null, 2), 'application/json');
}

/** "Share with my vet": one animal's health history. */
export async function exportVetHistory(a: AnimalRecord, records: HealthRecord[], fmt: 'pdf' | 'csv'): Promise<void> {
  if (fmt === 'csv') return share(`${safe(a.name)}-health-${today()}.csv`, healthCsv(records, () => a.name), 'text/csv');
  const { uri } = await Print.printToFileAsync({ html: vetHistoryHtml(a, speciesName(a.speciesId), records, today()) });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Health history for ${a.name}` });
}

/** The CSV template, written by the app (no download). */
export async function shareTemplate(text: string): Promise<void> {
  return share('plotwright-animals-template.csv', text, 'text/csv');
}
