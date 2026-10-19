/**
 * Animal records (prompt §6, phase 5; free): individual animals and household pets, production
 * logs, breeding records with due dates, and health records with next-due reminders. Pure: the
 * app stores them. The app records what people and their vets decide; nothing here chooses a
 * vaccine, schedule or dose.
 */
import { parseCsv } from '../sensors/csv';
import { minimumGroup } from './safetyDefaults';
import type { AnimalSpec } from './types';

// ---------- Types ----------

/** Records-only animals: a profile and health records, no library entry, fit, housing or breeding. */
export const HOUSEHOLD = { 'household:dog': 'Dog', 'household:cat': 'Cat', 'household:other': 'Other pet' } as const;
export type HouseholdId = keyof typeof HOUSEHOLD;
export const isHousehold = (speciesId: string): speciesId is HouseholdId => speciesId in HOUSEHOLD;

export type AnimalSex = 'female' | 'male' | 'castrated' | 'unknown';
export type AnimalStatus = 'active' | 'retired' | 'sold' | 'deceased' | 'processed';

/** A parent that isn't in the user's records. */
export interface OutsideParent { name: string; registrationNo?: string }

export interface AnimalRecord {
  id: string;
  parcelId?: string;
  herdId?: string;
  /** A library species id, or `household:dog|cat|other`. */
  speciesId: string;
  name: string;
  /** Ear tag, leg band, scrapie ID or microchip. */
  tag?: string;
  sex: AnimalSex;
  birthDate?: string;
  breed?: string;
  colorMarkings?: string;
  sireId?: string;
  damId?: string;
  outsideSire?: OutsideParent;
  outsideDam?: OutsideParent;
  registrationNo?: string;
  acquiredOn?: string;
  source?: string;
  status: AnimalStatus;
  notes?: string;
  /** Reserved for a later version (lab parentage or genotype results); nothing reads it yet. */
  dnaTests?: Array<{ lab: string; date: string; result: string }>;
  createdAt: string;
}

export type LogKind = 'eggs' | 'milk' | 'weight' | 'litter-born' | 'litter-weaned' | 'fleece' | 'honey' | 'feed';

export const LOG_KINDS: Record<LogKind, { label: string; unit: string; purpose?: string }> = {
  eggs: { label: 'Eggs', unit: 'eggs', purpose: 'eggs' },
  milk: { label: 'Milk', unit: 'lb', purpose: 'milk' },
  weight: { label: 'Weight', unit: 'lb' },
  'litter-born': { label: 'Born in litter', unit: 'head', purpose: 'breeding' },
  'litter-weaned': { label: 'Weaned from litter', unit: 'head', purpose: 'breeding' },
  fleece: { label: 'Fleece', unit: 'lb', purpose: 'fiber' },
  honey: { label: 'Honey', unit: 'lb', purpose: 'honey' },
  feed: { label: 'Feed bought', unit: 'lb' },
};

export interface AnimalLog {
  id: string;
  parcelId?: string;
  animalId?: string;
  herdId?: string;
  date: string;
  kind: LogKind;
  value: number;
  unit: string;
  note?: string;
}

export type BreedingMethod = 'natural' | 'ai' | 'eggs-set' | 'other';

export interface BreedingRecord {
  id: string;
  parcelId?: string;
  herdId?: string;
  speciesId: string;
  damId?: string;
  sireId?: string;
  /** A sire that isn't in the records. */
  sireName?: string;
  bredOn: string;
  method: BreedingMethod;
  /** Due window, widened to cover the cited gestation or incubation range. */
  dueFrom?: string;
  dueTo?: string;
  born?: number;
  alive?: number;
  notes?: string;
}

export type HealthType = 'vaccination' | 'vet-visit' | 'treatment' | 'test' | 'injury' | 'other';
export const HEALTH_TYPES: Record<HealthType, string> = {
  vaccination: 'Vaccination', 'vet-visit': 'Vet visit', treatment: 'Treatment', test: 'Test', injury: 'Injury', other: 'Other',
};

export interface HealthRecord {
  id: string;
  parcelId?: string;
  animalId?: string;
  herdId?: string;
  date: string;
  type: HealthType;
  /** Product or vaccine name, as the user writes it. */
  product?: string;
  givenBy?: string;
  lot?: string;
  /** Entered by the user or their vet; the app never suggests one. */
  nextDue?: string;
  notes?: string;
}

// ---------- Dates ----------

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isIsoDate = (s: string | undefined): s is string => !!s && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Statuses to offer: `processed` only with "Show harvest and processing details" on. */
export function statusOptions(showProcessing: boolean, speciesId?: string): AnimalStatus[] {
  const base: AnimalStatus[] = ['active', 'retired', 'sold', 'deceased'];
  return showProcessing && !(speciesId && isHousehold(speciesId)) ? [...base, 'processed'] : base;
}

/**
 * Expected due window from the bred (or set) date, covering the whole cited range so nobody is
 * caught early. Eggs set use incubation; mammals use gestation.
 */
export function expectedDue(a: AnimalSpec | undefined, bredOn: string, method?: BreedingMethod): { from: string; to: string; basis: string } | null {
  if (!a || !isIsoDate(bredOn)) return null;
  const r = a.reproduction;
  const range = method === 'eggs-set' || !r.gestationDays ? r.incubationDays : r.gestationDays;
  if (!range) return null;
  const what = range === r.incubationDays ? 'incubation' : 'gestation';
  return { from: addDaysIso(bredOn, range[0]), to: addDaysIso(bredOn, range[1]), basis: `${range[0] === range[1] ? range[0] : `${range[0]}–${range[1]}`} days’ ${what}` };
}

// ---------- Health due ----------

export interface HealthDue { record: HealthRecord; days: number; overdue: boolean }

/**
 * Next-due dates that are still open: a later record for the same animal (or herd), type and
 * product replaces an earlier one's due date. Soonest first; overdue ones have negative `days`.
 */
export function healthDue(records: HealthRecord[], today: string, horizonDays = 30): HealthDue[] {
  const key = (r: HealthRecord) => `${r.animalId ?? ''}|${r.herdId ?? ''}|${r.type}|${(r.product ?? '').trim().toLowerCase()}`;
  const latest = new Map<string, HealthRecord>();
  for (const r of records) {
    const k = key(r), cur = latest.get(k);
    if (!cur || r.date > cur.date || (r.date === cur.date && (r.nextDue ?? '') > (cur.nextDue ?? ''))) latest.set(k, r);
  }
  const out: HealthDue[] = [];
  for (const r of latest.values()) {
    if (!isIsoDate(r.nextDue)) continue;
    const days = daysBetween(today, r.nextDue);
    if (days <= horizonDays) out.push({ record: r, days, overdue: days < 0 });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ---------- Logs ----------

export type LogPeriod = 'week' | 'month' | 'season';

/** Totals for the last 8 weeks, 6 months or 4 seasons (3 months each), oldest first. */
export function logSeries(logs: AnimalLog[], kind: LogKind, period: LogPeriod, today: string): Array<{ label: string; from: string; total: number }> {
  const buckets: Array<{ label: string; from: string; to: string; total: number }> = [];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (period === 'week') {
    for (let i = 7; i >= 0; i--) {
      const to = addDaysIso(today, -7 * i), from = addDaysIso(to, -6);
      buckets.push({ label: `${MONTHS[+from.slice(5, 7) - 1]} ${+from.slice(8, 10)}`, from, to, total: 0 });
    }
  } else {
    const n = period === 'month' ? 6 : 4, step = period === 'month' ? 1 : 3;
    const y = +today.slice(0, 4), m = +today.slice(5, 7) - 1;
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(Date.UTC(y, m - (i + 1) * step + 1, 1)), end = new Date(Date.UTC(y, m - i * step + 1, 0));
      const from = start.toISOString().slice(0, 10), to = end.toISOString().slice(0, 10);
      buckets.push({ label: period === 'month' ? MONTHS[start.getUTCMonth()]! : `${MONTHS[start.getUTCMonth()]}–${MONTHS[end.getUTCMonth()]}`, from, to, total: 0 });
    }
  }
  for (const l of logs) {
    if (l.kind !== kind) continue;
    const b = buckets.find((x) => l.date >= x.from && l.date <= x.to);
    if (b) b.total += l.value;
  }
  return buckets.map(({ label, from, total }) => ({ label, from, total: Math.round(total * 10) / 10 }));
}

/** Eggs per hen per week over the last `days` days (default 28), or null without layers or logs. */
export function eggsPerHenPerWeek(logs: AnimalLog[], hens: number, today: string, days = 28): number | null {
  if (hens <= 0) return null;
  const from = addDaysIso(today, -(days - 1));
  const eggs = logs.filter((l) => l.kind === 'eggs' && l.date >= from && l.date <= today);
  if (!eggs.length) return null;
  const total = eggs.reduce((n, l) => n + l.value, 0);
  return Math.round(((total / hens) * 7 * 10) / days) / 10;
}

/** Total of one kind of log since a date (lactation total, honey this season). */
export function logTotal(logs: AnimalLog[], kind: LogKind, since?: string): number {
  return Math.round(logs.filter((l) => l.kind === kind && (!since || l.date >= since)).reduce((n, l) => n + l.value, 0) * 10) / 10;
}

/** Average weaned per litter from breeding outcomes, or null when none are recorded. */
export function weanedPerLitter(logs: AnimalLog[]): number | null {
  const w = logs.filter((l) => l.kind === 'litter-weaned');
  return w.length ? Math.round((w.reduce((n, l) => n + l.value, 0) / w.length) * 10) / 10 : null;
}

// ---------- Welfare ----------

/** A gentle note when a social species is kept below its group minimum (owner decision; free). */
export function welfareNote(a: AnimalSpec, activeCount: number): string | null {
  const min = minimumGroup(a);
  if (activeCount <= 0 || activeCount >= min) return null;
  return `${a.commonName} are social and do best in groups of ${min} or more${a.socialNote ? `: ${a.socialNote}` : '.'}`;
}

// ---------- CSV ----------

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export const ANIMAL_CSV_HEADERS = ['name', 'species', 'tag', 'sex', 'birth_date', 'breed', 'color_markings', 'sire', 'dam', 'registration_no', 'acquired_on', 'source', 'status', 'notes'];

/** A template people fill in a spreadsheet; written by the app, no download. */
export function animalCsvTemplate(): string {
  return toCsv(ANIMAL_CSV_HEADERS, [
    ['Daisy', 'dairy_goats', 'US-123', 'female', '2024-03-02', 'Nubian', 'brown, white blaze', '', '', '', '2024-06-01', 'Neighbor', 'active', ''],
    ['Rex', 'household:dog', 'chip 985112000000000', 'castrated', '2021-05-10', 'Mixed', '', '', '', '', '', '', 'active', 'Rabies tag 2341'],
  ]);
}

const SEXES: AnimalSex[] = ['female', 'male', 'castrated', 'unknown'];
const SEX_ALIASES: Record<string, AnimalSex> = { f: 'female', doe: 'female', hen: 'female', ewe: 'female', cow: 'female', sow: 'female', m: 'male', buck: 'male', ram: 'male', rooster: 'male', boar: 'male', bull: 'male', wether: 'castrated', steer: 'castrated', barrow: 'castrated', neutered: 'castrated', spayed: 'castrated' };

export interface AnimalCsvImport {
  animals: Array<Omit<AnimalRecord, 'id' | 'createdAt' | 'parcelId' | 'herdId'>>;
  errors: string[];
  /** Sire or dam names to link to other rows (or existing records) after import. */
  parents: Array<{ row: number; sire?: string; dam?: string }>;
}

/**
 * Parse an animals CSV (the template's columns, matched by header name). `resolveSpecies` turns a
 * species column (an id, a common name or "dog") into an id, or undefined. Bad rows are reported
 * and skipped; nothing is guessed.
 */
export function parseAnimalCsv(text: string, resolveSpecies: (s: string) => string | undefined, opts: { showProcessing?: boolean } = {}): AnimalCsvImport {
  const rows = parseCsv(text);
  const out: AnimalCsvImport = { animals: [], errors: [], parents: [] };
  if (rows.length < 2) return { ...out, errors: ['The file has no rows under the header.'] };
  const head = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = (name: string) => head.indexOf(name);
  if (col('name') < 0 || col('species') < 0) return { ...out, errors: ['The header needs at least “name” and “species” columns. Save the template to see them all.'] };
  const statuses = statusOptions(!!opts.showProcessing);
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (name: string) => { const c = col(name); return c >= 0 ? (r[c] ?? '').trim() : ''; };
    const name = get('name'), speciesRaw = get('species');
    if (!name) return out.errors.push(`Row ${line}: no name.`);
    const speciesId = resolveSpecies(speciesRaw);
    if (!speciesId) return out.errors.push(`Row ${line} (${name}): unknown species “${speciesRaw}”.`);
    const sexRaw = get('sex').toLowerCase();
    const sex = (SEXES as string[]).includes(sexRaw) ? (sexRaw as AnimalSex) : SEX_ALIASES[sexRaw] ?? (sexRaw ? null : 'unknown');
    if (!sex) return out.errors.push(`Row ${line} (${name}): sex “${get('sex')}” isn’t one of ${SEXES.join(', ')}.`);
    const dates: Record<string, string> = {};
    for (const d of ['birth_date', 'acquired_on']) {
      const v = get(d);
      if (v && !isIsoDate(v)) return out.errors.push(`Row ${line} (${name}): ${d.replace('_', ' ')} “${v}” should be YYYY-MM-DD.`);
      if (v) dates[d] = v;
    }
    const statusRaw = get('status').toLowerCase() || 'active';
    if (!(statuses as string[]).includes(statusRaw)) return out.errors.push(`Row ${line} (${name}): status “${statusRaw}” isn’t one of ${statuses.join(', ')}.`);
    const opt = (v: string) => v || undefined;
    out.animals.push({
      speciesId, name, sex, status: statusRaw as AnimalStatus, tag: opt(get('tag')), birthDate: dates.birth_date, breed: opt(get('breed')),
      colorMarkings: opt(get('color_markings')), registrationNo: opt(get('registration_no')), acquiredOn: dates.acquired_on, source: opt(get('source')), notes: opt(get('notes')),
    });
    if (get('sire') || get('dam')) out.parents.push({ row: out.animals.length - 1, sire: opt(get('sire')), dam: opt(get('dam')) });
    return undefined;
  });
  return out;
}

export function animalsCsv(animals: AnimalRecord[], nameOf: (id?: string) => string | undefined): string {
  return toCsv(ANIMAL_CSV_HEADERS, animals.map((a) => [
    a.name, a.speciesId, a.tag, a.sex, a.birthDate, a.breed, a.colorMarkings, nameOf(a.sireId) ?? a.outsideSire?.name, nameOf(a.damId) ?? a.outsideDam?.name,
    a.registrationNo, a.acquiredOn, a.source, a.status, a.notes,
  ]));
}

export function logsCsv(logs: AnimalLog[], nameOf: (l: AnimalLog) => string): string {
  return toCsv(['date', 'animal_or_group', 'kind', 'value', 'unit', 'note'], [...logs].sort((a, b) => a.date.localeCompare(b.date)).map((l) => [l.date, nameOf(l), l.kind, l.value, l.unit, l.note]));
}

export function healthCsv(records: HealthRecord[], nameOf: (r: HealthRecord) => string): string {
  return toCsv(['date', 'animal_or_group', 'type', 'product', 'given_by', 'lot', 'next_due', 'notes'],
    [...records].sort((a, b) => a.date.localeCompare(b.date)).map((r) => [r.date, nameOf(r), r.type, r.product, r.givenBy, r.lot, r.nextDue, r.notes]));
}

export function breedingCsv(records: BreedingRecord[], nameOf: (id?: string) => string | undefined): string {
  return toCsv(['bred_on', 'species', 'dam', 'sire', 'method', 'due_from', 'due_to', 'born', 'alive', 'notes'],
    [...records].sort((a, b) => a.bredOn.localeCompare(b.bredOn)).map((r) => [r.bredOn, r.speciesId, nameOf(r.damId), nameOf(r.sireId) ?? r.sireName, r.method, r.dueFrom, r.dueTo, r.born, r.alive, r.notes]));
}

// ---------- Vet export ----------

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "Share with my vet": one animal's health history as printable HTML (the app makes a PDF from it). */
export function vetHistoryHtml(a: AnimalRecord, speciesName: string, records: HealthRecord[], generatedOn: string): string {
  const rows = [...records].sort((x, y) => y.date.localeCompare(x.date)).map((r) =>
    `<tr><td>${esc(r.date)}</td><td>${esc(HEALTH_TYPES[r.type])}</td><td>${esc(r.product)}</td><td>${esc(r.givenBy)}</td><td>${esc(r.lot)}</td><td>${esc(r.nextDue)}</td><td>${esc(r.notes)}</td></tr>`).join('');
  const facts = [['Species', speciesName], ['Breed', a.breed], ['Sex', a.sex], ['Born', a.birthDate], ['ID / tag', a.tag], ['Registration', a.registrationNo], ['Markings', a.colorMarkings]]
    .filter(([, v]) => v).map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 14mm; } body { font-family: -apple-system, Roboto, sans-serif; font-size: 10pt; color: #222; }
    h1 { font-size: 16pt; margin: 0 0 4px; } table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border-bottom: 1px solid #ccc; padding: 4px; text-align: left; vertical-align: top; } th { background: #eef2ea; } p { color: #555; }
  </style></head><body>
  <h1>${esc(a.name)}: health history</h1><div>${facts}</div>
  <table><tr><th>Date</th><th>Type</th><th>Product or vaccine</th><th>Given by</th><th>Lot</th><th>Next due</th><th>Notes</th></tr>${rows || '<tr><td colspan="7">No health records yet.</td></tr>'}</table>
  <p>Recorded by the owner in Plotwright on ${esc(generatedOn)}. These are the owner’s own records, not veterinary advice.</p>
  </body></html>`;
}
