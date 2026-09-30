/**
 * Re-records provider fixtures from the live public services for a test parcel near Catskill, NY.
 * Run on a machine with normal internet access:  pnpm tsx scripts/record-fixtures.ts
 * Output goes to packages/providers/src/__fixtures__/live/. Compare with the synthetic fixtures used in
 * tests and update the tests if a service's response shape has changed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Polygon } from '../packages/core/src/index';
import { HttpClient, type FetchLike } from '../packages/providers/src/http';
import { clippedMapunitsQuery, propertiesQuery, toWkt } from '../packages/providers/src/soils';
import { buildSiteProfile } from '../packages/providers/src/siteProfile';
import { findParcel } from '../packages/providers/src/parcel/arcgis';
import { bundledParcelRegistry } from '../packages/data/src/index';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'providers', 'src', '__fixtures__', 'live');
mkdirSync(OUT, { recursive: true });

const recorded: Array<{ url: string; method: string; body?: string; status: number; response: string }> = [];
const recordingFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  recorded.push({ url, method: init.method, body: init.body, status: res.status, response: text.slice(0, 200_000) });
  return { ok: res.ok, status: res.status, headers: { get: (n) => res.headers.get(n) }, text: async () => text };
};
const http = new HttpClient({ fetch: recordingFetch, userAgent: 'Plotwright fixture recorder (+https://github.com/lindquistgregory-wq/homeground)' });

const LOT: Polygon = { type: 'Polygon', coordinates: [[[-73.987, 42.252], [-73.984, 42.252], [-73.984, 42.254], [-73.987, 42.254], [-73.987, 42.252]]] };

const t0 = Date.now();
const profile = await buildSiteProfile({ http }, LOT);
const coldMs = Date.now() - t0;
const parcel = await findParcel(http, bundledParcelRegistry, '36039', { lat: 42.253, lon: -73.9855 });

writeFileSync(join(OUT, 'site-profile.json'), JSON.stringify(profile, null, 2));
writeFileSync(join(OUT, 'parcel-lookup.json'), JSON.stringify({ tried: parcel.tried, count: parcel.candidates.length, first: parcel.candidates[0] }, null, 2));
writeFileSync(join(OUT, 'http-log.json'), JSON.stringify(recorded, null, 2));
writeFileSync(join(OUT, 'sda-queries.sql'), `${clippedMapunitsQuery(toWkt(LOT))}\n\n-- properties\n${propertiesQuery(['0'])}\n`);

const layers = ['elevation', 'hardiness', 'climate', 'soils', 'flood', 'water'] as const;
console.log(`Cold Site Profile in ${coldMs} ms (target < 30 000 ms)`);
for (const l of layers) {
  const v = profile[l];
  console.log(`${l.padEnd(10)} ${v.status === 'ok' ? 'ok' : `UNAVAILABLE: ${v.reason}`}`);
}
console.log(`Parcel lookup: ${parcel.candidates.length} candidate(s); tried ${JSON.stringify(parcel.tried)}`);
console.log(`Hosts contacted: ${[...new Set(recorded.map((r) => new URL(r.url).hostname))].join(', ')}`);
