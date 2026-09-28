import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAll, collectDependencies, findHosts } from './check-licenses';

test('the repository passes the zero-cost check', () => {
  assert.deepEqual(checkAll(), []);
});

test('an unrecorded paid API host is caught', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hg-'));
  const f = join(dir, 'x.ts');
  writeFileSync(f, "const u = 'https://api.open-meteo.com/v1/forecast'; const ok = 'https://epqs.nationalmap.gov/v1/json';");
  const hosts = findHosts([f]);
  assert.ok(hosts.has('api.open-meteo.com'));
  assert.ok(hosts.has('epqs.nationalmap.gov'));
});

test('dependencies across the monorepo are collected, workspace links skipped', () => {
  const deps = collectDependencies(join(import.meta.dirname ?? '.', '..'));
  assert.ok(deps.has('@maplibre/maplibre-react-native'));
  assert.ok(!deps.has('@plotwright/core'));
});
