/**
 * Zero-cost compliance gate (§11). Fails when:
 *  1. an npm dependency anywhere in the monorepo is missing from licenses.json, or is not marked
 *     free for commercial use; or an installed package's licence differs from what we recorded;
 *  2. app/provider source code contains an https host that is not a recorded data source
 *     (packages/data/src/sources.ts), so no new network service can slip in unrecorded.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_SOURCES, NON_SERVICE_HOSTS } from '../packages/data/src/sources';

const HERE = fileURLToPath(import.meta.url);
const ROOT = join(dirname(HERE), '..');

interface LicenseEntry {
  license: string;
  commercialUse: boolean;
  note?: string;
}

export function collectDependencies(root: string): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  const manifests = [join(root, 'package.json')];
  for (const dir of ['apps', 'packages', 'modules']) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const p = join(base, d, 'package.json');
      if (existsSync(p)) manifests.push(p);
    }
  }
  for (const m of manifests) {
    const pkg = JSON.parse(readFileSync(m, 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries<string>(pkg[field] ?? {})) {
        if (String(range).startsWith('workspace:')) continue;
        deps.set(name, [...(deps.get(name) ?? []), relative(root, m)]);
      }
    }
  }
  return deps;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === '__fixtures__' || f.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|swift|kt)$/.test(f) && !/\.test\.ts$/.test(f) && f !== 'testing.ts') out.push(p);
  }
  return out;
}

export function findHosts(files: string[]): Map<string, string[]> {
  const hosts = new Map<string, string[]>();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      const h = m[1]!.toLowerCase();
      hosts.set(h, [...new Set([...(hosts.get(h) ?? []), relative(ROOT, f)])]);
    }
  }
  return hosts;
}

export function checkAll(root = ROOT): string[] {
  const problems: string[] = [];
  const recorded: Record<string, LicenseEntry> = JSON.parse(readFileSync(join(root, 'licenses.json'), 'utf8')).packages;

  for (const [name, where] of collectDependencies(root)) {
    const entry = recorded[name];
    if (!entry) problems.push(`Dependency "${name}" (${where.join(', ')}) has no entry in licenses.json`);
    else if (entry.commercialUse !== true) problems.push(`Dependency "${name}" is not marked free for commercial use`);
    const installed = join(root, 'node_modules', name, 'package.json');
    if (entry && existsSync(installed)) {
      const lic = JSON.parse(readFileSync(installed, 'utf8')).license;
      if (typeof lic === 'string' && lic !== entry.license) problems.push(`Installed "${name}" is licensed ${lic}, but licenses.json records ${entry.license}`);
    }
  }

  const allowed = new Set([...DATA_SOURCES.flatMap((s) => s.hosts), ...NON_SERVICE_HOSTS]);
  const files = [
    ...walk(join(root, 'packages')),
    ...walk(join(root, 'apps', 'mobile', 'app')),
    ...walk(join(root, 'apps', 'mobile', 'src')),
    ...walk(join(root, 'modules')),
  ];
  for (const [host, where] of findHosts(files)) {
    if (!allowed.has(host)) problems.push(`Host "${host}" (${where.join(', ')}) is not a recorded data source in packages/data/src/sources.ts`);
  }
  for (const s of DATA_SOURCES) if (s.commercialUse !== true) problems.push(`Data source ${s.id} is not free for commercial use`);
  return problems;
}

if (process.argv[1] && HERE === process.argv[1]) {
  const problems = checkAll();
  if (problems.length) {
    console.error(`Zero-cost check failed:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('Zero-cost check passed: all dependencies and network hosts are recorded as free for commercial use.');
}
