/**
 * CSV import (§8 fallback): readings exported from any station software (Ecowitt, WeatherLink,
 * Weather Display, Cumulus, spreadsheets). Columns are matched by header name, units read from the
 * header ("Temperature (°F)", "Rain mm", "Wind km/h"), and everything converted to canonical units.
 */
import type { Metric, Reading } from './types';
import { offsetAt, type Offset } from './series';
import { qualityOf } from './types';

export interface CsvColumn {
  index: number;
  header: string;
  metric: Metric;
  /** Converts the raw number to canonical units. */
  unit: string;
}

export interface CsvImport {
  readings: Reading[];
  columns: CsvColumn[];
  timeColumns: string[];
  rows: number;
  skipped: number;
  warnings: string[];
}

export interface CsvOptions {
  sensorId: string;
  /** Minutes east of UTC for timestamps without a zone (the station's local time); a function handles daylight saving. */
  offsetMin: Offset;
  /** Unit system to assume when a header gives none. */
  defaultUnits: 'imperial' | 'metric';
  /** Day-first dates (31/12/2025) instead of month-first (12/31/2025) for slashed dates. */
  dayFirst?: boolean;
}

/** Split CSV text into rows, handling quotes and the delimiter (comma, semicolon or tab, whichever the header uses most). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (q) {
      if (c === '"' && clean[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) (row.push(field), (field = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      (row = []), (field = '');
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

type Rule = { re: RegExp; metric: Metric; units: Array<[RegExp, string]>; imperial: string; metricUnit: string };

const F_RE = /°\s*f\b|℉|\(f\)|\bdeg\s*f\b|fahrenheit|degf|\btemp\s*_?f\b|tempf\b/i;
const C_RE = /°\s*c\b|℃|\(c\)|\bdeg\s*c\b|celsius|degc/i;

// Order matters: more specific patterns first (dew point before temperature, soil before air, gust before wind).
const RULES: Rule[] = [
  { re: /dew\s*point|dewpoint/i, metric: 'dewPoint', units: [[F_RE, 'F'], [C_RE, 'C']], imperial: 'F', metricUnit: 'C' },
  { re: /soil\s*(temp|temperature)/i, metric: 'soilTemperature', units: [[F_RE, 'F'], [C_RE, 'C']], imperial: 'F', metricUnit: 'C' },
  { re: /soil\s*(moist|moisture|vwc|water)/i, metric: 'soilMoisture', units: [[/%/, '%']], imperial: '%', metricUnit: '%' },
  { re: /(^|[^a-z])(indoor|inside)([^a-z]|$)|^in\s*(temp|hum)/i, metric: 'temperature', units: [], imperial: 'skip', metricUnit: 'skip' },
  { re: /feels|heat\s*index|wind\s*chill|thsw|thw|wet\s*bulb/i, metric: 'temperature', units: [], imperial: 'skip', metricUnit: 'skip' },
  // Period highs and lows ("Hi Temp", "Min Temp") aren't the reading itself.
  { re: /(^|[^a-z])(hi|high|max|lo|low|min|avg)([^a-z]|$).*temp|temp.*([^a-z])(hi|high|max|lo|low|min)([^a-z]|$)/i, metric: 'temperature', units: [], imperial: 'skip', metricUnit: 'skip' },
  { re: /(outdoor\s*)?temp(erature)?|^out\s*temp/i, metric: 'temperature', units: [[F_RE, 'F'], [C_RE, 'C']], imperial: 'F', metricUnit: 'C' },
  { re: /hum(idity)?|\brh\b/i, metric: 'humidity', units: [[/%/, '%']], imperial: '%', metricUnit: '%' },
  { re: /rain\s*rate|rate/i, metric: 'rainRate', units: [[/in\/h|in\/hr|in\b/i, 'in/h'], [/mm/i, 'mm/h']], imperial: 'in/h', metricUnit: 'mm/h' },
  { re: /(daily|day|today)\s*rain|rain\s*(daily|day|today)/i, metric: 'rainDaily', units: [[/\bin\b|inch/i, 'in'], [/mm/i, 'mm']], imperial: 'in', metricUnit: 'mm' },
  { re: /(total|accum|year|annual|month|week|event|storm).*(rain|precip)|(rain|precip).*(total|accum|year|annual|month|week|event|storm)/i, metric: 'rainTotal', units: [], imperial: 'skip', metricUnit: 'skip' },
  // Rolling windows ("Hourly Rain", "24h Rain", "Last 1 h") repeat the same rain in every row: summing them would multiply it.
  { re: /(hourly|\b1\s*h|\b24\s*h|last|past|rolling).*(rain|precip)|(rain|precip).*(hourly|\b1\s*h\b|\b24\s*h\b|last|past)/i, metric: 'rainTotal', units: [], imperial: 'skip', metricUnit: 'skip' },
  // A plain "Rain" column in a logger export is the rain in that interval.
  { re: /rain|precip/i, metric: 'rain', units: [[/\bin\b|inch/i, 'in'], [/mm/i, 'mm']], imperial: 'in', metricUnit: 'mm' },
  { re: /gust/i, metric: 'windGust', units: [[/mph/i, 'mph'], [/km\/?h|kph/i, 'km/h'], [/m\/s/i, 'm/s'], [/kn|knot/i, 'kn']], imperial: 'mph', metricUnit: 'm/s' },
  { re: /wind\s*(dir|direction)/i, metric: 'windDirection', units: [[/°|deg/i, 'deg']], imperial: 'deg', metricUnit: 'deg' },
  { re: /wind/i, metric: 'windSpeed', units: [[/mph/i, 'mph'], [/km\/?h|kph/i, 'km/h'], [/m\/s/i, 'm/s'], [/kn|knot/i, 'kn']], imperial: 'mph', metricUnit: 'm/s' },
  { re: /pressure|baro|\bbar\b|rel\.?\s*pres|abs\.?\s*pres/i, metric: 'pressure', units: [[/inhg|in\b/i, 'inHg'], [/hpa|mbar|mb\b/i, 'hPa'], [/kpa/i, 'kPa'], [/mmhg/i, 'mmHg']], imperial: 'inHg', metricUnit: 'hPa' },
  { re: /solar|radiation|irradiance|w\/m/i, metric: 'solarRadiation', units: [[/w\/m/i, 'W/m2']], imperial: 'W/m2', metricUnit: 'W/m2' },
  { re: /\buv\b|uvi/i, metric: 'uvIndex', units: [], imperial: 'idx', metricUnit: 'idx' },
  { re: /lux|illuminance|light/i, metric: 'illuminance', units: [[/klux/i, 'klx'], [/lux|lx/i, 'lx']], imperial: 'lx', metricUnit: 'lx' },
  { re: /leaf\s*wet/i, metric: 'leafWetness', units: [], imperial: 'idx', metricUnit: 'idx' },
  { re: /co2/i, metric: 'co2', units: [], imperial: 'ppm', metricUnit: 'ppm' },
];

const CONVERT: Record<string, (v: number) => number> = {
  F: (v) => ((v - 32) * 5) / 9, C: (v) => v, '%': (v) => v, 'in/h': (v) => v * 25.4, 'mm/h': (v) => v, in: (v) => v * 25.4, mm: (v) => v,
  mph: (v) => v * 0.44704, 'km/h': (v) => v / 3.6, 'm/s': (v) => v, kn: (v) => v * 0.514444, deg: (v) => v, inHg: (v) => v * 33.8639,
  hPa: (v) => v, kPa: (v) => v * 10, mmHg: (v) => v * 1.33322, W2: (v) => v, 'W/m2': (v) => v, idx: (v) => v, klx: (v) => v * 1000, lx: (v) => v, ppm: (v) => v,
};

const TIME_RE = /^(date|time|timestamp|datetime|date\s*\/\s*time|date\s*time|time\s*\(utc\)|utc|local\s*time|epoch|unix)/i;

/** Map headers to metrics and units. Unknown columns are ignored. */
export function mapColumns(headers: string[], defaultUnits: 'imperial' | 'metric'): { columns: CsvColumn[]; timeIdx: number[]; warnings: string[] } {
  const columns: CsvColumn[] = [];
  const timeIdx: number[] = [];
  const warnings: string[] = [];
  const used = new Set<Metric>();
  headers.forEach((raw, index) => {
    const header = raw.trim();
    if (!header) return;
    if (TIME_RE.test(header) || /^(date|time)$/i.test(header)) return void timeIdx.push(index);
    const rule = RULES.find((r) => r.re.test(header));
    if (!rule) return;
    let unit = rule.units.find(([re]) => re.test(header))?.[1];
    if (!unit) {
      unit = defaultUnits === 'imperial' ? rule.imperial : rule.metricUnit;
      if (unit !== 'skip' && rule.units.length > 1) warnings.push(`"${header}": no unit in the header, assumed ${unit}.`);
    }
    if (unit === 'skip' || used.has(rule.metric)) return; // indoor/derived columns, or a second column of the same kind
    used.add(rule.metric);
    columns.push({ index, header, metric: rule.metric, unit });
  });
  return { columns, timeIdx, warnings };
}

/** Parse a timestamp from one or two cells. Returns UTC ms or null. */
export function parseTimestamp(cells: string[], offsetMin: Offset, dayFirst = false): number | null {
  const s = cells.map((c) => c.trim()).filter(Boolean).join(' ');
  if (!s) return null;
  if (/^\d{9,10}(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  if (/^\d{12,13}$/.test(s)) return Number(s);
  // ISO with an explicit zone.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isNaN(t) ? null : t;
  }
  let y: number, mo: number, d: number, rest: string;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T ]?(.*)$/.exec(s);
  if (m) (y = +m[1]!), (mo = +m[2]!), (d = +m[3]!), (rest = m[4]!);
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})[ T,]*(.*)$/.exec(s))) {
    const a = +m[1]!, b = +m[2]!;
    y = +m[3]!;
    if (y < 100) y += 2000;
    [mo, d] = dayFirst || a > 12 ? [b, a] : [a, b];
    rest = m[4]!;
  } else return null;
  let hh = 0, mm = 0, ss = 0;
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(rest.trim());
  if (tm) {
    hh = +tm[1]!; mm = +tm[2]!; ss = tm[3] ? +tm[3] : 0;
    const ap = tm[4]?.toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, hh, mm, ss);
  // Local wall-clock time → UTC; with a daylight-saving-aware offset, refine once at the guessed instant.
  const guess = wall - offsetAt(offsetMin, wall) * 60_000;
  return wall - offsetAt(offsetMin, guess) * 60_000;
}

/** First number in a cell ("21.5", "21,5", "1,013.2", "21.5 C"); null for blanks and "--". */
const num = (s: string): number | null => {
  let t = s.trim();
  if (!t || /^-+$/.test(t)) return null;
  // Both separators: whichever comes last is the decimal point ("1,013.2" / "1.013,2").
  if (t.includes('.') && t.includes(',')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const m = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(t);
  return m ? Number(m[0]) : null;
};

export function importCsv(text: string, opts: CsvOptions): CsvImport {
  return importCsvRows(parseCsv(text), opts);
}

/** Convert already-split rows (lets the app split a big file once and re-convert as options change). */
export function importCsvRows(rows: string[][], opts: CsvOptions): CsvImport {
  const warnings: string[] = [];
  if (rows.length < 2) return { readings: [], columns: [], timeColumns: [], rows: 0, skipped: 0, warnings: ['The file has no data rows.'] };
  // Some exports put a units row under the header ("°F", "%", …): merge it into the header.
  let headers = rows[0]!;
  let start = 1;
  if (rows[1] && rows[1].every((c) => !/\d/.test(c) || /^[°%a-z/\s²³.\d]+$/i.test(c)) && rows[1].some((c) => /°|%|mph|mm|in\b|hpa|w\/m/i.test(c))) {
    headers = headers.map((h, i) => `${h} ${rows[1]![i] ?? ''}`);
    start = 2;
  }
  const map = mapColumns(headers, opts.defaultUnits);
  warnings.push(...map.warnings);
  if (!map.timeIdx.length) return { readings: [], columns: map.columns, timeColumns: [], rows: rows.length - start, skipped: rows.length - start, warnings: [...warnings, 'No date/time column found.'] };
  if (!map.columns.length) warnings.push('No weather columns recognised. Rename the headers (e.g. "Temperature (°F)", "Humidity (%)") and try again.');
  const readings: Reading[] = [];
  let skipped = 0;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r]!;
    const t = parseTimestamp(map.timeIdx.map((i) => row[i] ?? ''), opts.offsetMin, opts.dayFirst);
    if (t === null) { skipped++; continue; }
    for (const c of map.columns) {
      const v = num(row[c.index] ?? '');
      if (v === null) continue;
      const value = CONVERT[c.unit]!(v);
      readings.push({ sensorId: opts.sensorId, t, metric: c.metric, value, quality: qualityOf(c.metric, value) });
    }
  }
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} had no readable date and were skipped.`);
  return { readings, columns: map.columns, timeColumns: map.timeIdx.map((i) => headers[i]!.trim()), rows: rows.length - start, skipped, warnings };
}
