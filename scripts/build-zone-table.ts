/**
 * Builds packages/data/zones/phzm-zip.json, a compact ZIP → zone table (2023 USDA PHZM via the
 * frostline dataset, MIT), so hardiness zones work offline. Run with normal internet access:
 *   pnpm build:zones
 * Source: https://phzmapi.org/all.json (the frostline project's bulk export).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'data', 'zones', 'phzm-zip.json');

const res = await fetch('https://phzmapi.org/all.json', { headers: { 'User-Agent': 'Plotwright build script (+https://github.com/lindquistgregory-wq/homeground)' } });
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const all = (await res.json()) as Record<string, { zone?: string }>;
const table: Record<string, string> = {};
for (const [zip, v] of Object.entries(all)) if (/^\d{5}$/.test(zip) && v?.zone && /^\d{1,2}[ab]$/.test(v.zone)) table[zip] = v.zone;
const keys = Object.keys(table).sort();
writeFileSync(OUT, JSON.stringify(Object.fromEntries(keys.map((k) => [k, table[k]]))) + '\n');
console.log(`Wrote ${keys.length} ZIP codes to ${OUT}`);
