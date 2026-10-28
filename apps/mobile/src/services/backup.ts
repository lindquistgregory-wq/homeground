/**
 * "Back up to a file" and "Restore from a file": every property, design, planting, animal record,
 * sensor reading and setting on this phone, plus full-size animal photos, in one JSON file the user
 * keeps wherever they like (Drive, email, a computer). No server is involved. Station and AI keys
 * live in the keychain and are never written to the file; they have to be entered again after a
 * restore on a new phone.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getDb } from '../db/database';

export const BACKUP_KIND = 'plotwright-full-backup';
export const BACKUP_VERSION = 1;

/** Tables kept in a backup: everything except the network cache and sync bookkeeping. */
const TABLES = [
  'parcels', 'site_profiles', 'user_parcel_endpoints', 'kv', 'designs', 'design_versions', 'sun_checks', 'plantings',
  'sensors', 'readings', 'sensor_days', 'ble_aliases', 'planner_goals', 'planner_messages', 'planner_drafts', 'tasks',
  'custom_plants', 'herds', 'animals', 'animal_logs', 'breeding_records', 'health_records', 'custom_animals',
  'calendar_events', 'project_progress',
] as const;
/** Per-install values that must not move to another phone. */
const KV_SKIP = new Set(['deviceId']);

type Row = Record<string, string | number | null>;

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: number;
  /** PRAGMA user_version of the database that made it. */
  schema: number;
  createdAt: string;
  tables: Record<string, Row[]>;
  /** Full-size animal photos, base64, by file name. */
  photos: Record<string, string>;
}

const photoDir = () => new Directory(Paths.document, 'animal-photos');

export async function createBackup(): Promise<BackupFile> {
  const db = await getDb();
  const schema = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) {
    const rows = await db.getAllAsync<Row>(`SELECT * FROM ${t}`);
    tables[t] = t === 'kv' ? rows.filter((r) => !KV_SKIP.has(String(r.key))) : rows;
  }
  const photos: Record<string, string> = {};
  const dir = photoDir();
  if (dir.exists) for (const f of dir.list()) if (f instanceof File) photos[f.name] = await f.base64();
  return { kind: BACKUP_KIND, version: BACKUP_VERSION, schema, createdAt: new Date().toISOString(), tables, photos };
}

/** Write a backup and open the share sheet so the user can save it somewhere safe. */
export async function shareBackup(): Promise<void> {
  const b = await createBackup();
  const file = new File(Paths.cache, `plotwright-backup-${b.createdAt.slice(0, 10)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(b));
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your Plotwright backup' });
}

/** Check a parsed file is a backup this version of the app can restore. Returns the problem, or null. */
export function backupProblem(b: unknown, currentSchema: number): string | null {
  const x = b as Partial<BackupFile> | null;
  if (!x || x.kind !== BACKUP_KIND || typeof x.tables !== 'object' || !x.tables) return 'This isn’t a Plotwright backup file.';
  if ((x.version ?? 0) > BACKUP_VERSION || (x.schema ?? 0) > currentSchema) return 'This backup was made by a newer version of Plotwright. Update the app, then restore it.';
  return null;
}

/** Let the user pick a backup file. Null when cancelled. Throws with a plain message when it can't be used. */
export async function pickBackup(): Promise<BackupFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['application/json', '*/*'] });
  if (picked.canceled || !picked.assets[0]) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(await new File(picked.assets[0].uri).text()); } catch { throw new Error('That file couldn’t be read as a Plotwright backup.'); }
  const db = await getDb();
  const schema = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  const problem = backupProblem(parsed, schema);
  if (problem) throw new Error(problem);
  return parsed as BackupFile;
}

/** Replace everything on this phone with the backup's contents (one transaction; photos after). */
export async function restoreBackup(b: BackupFile): Promise<{ rows: number; photos: number }> {
  const db = await getDb();
  let rows = 0;
  await db.withTransactionAsync(async () => {
    for (const t of TABLES) {
      const cols = new Set((await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
      const keep = t === 'kv' ? await db.getAllAsync<Row>('SELECT * FROM kv WHERE key IN (' + [...KV_SKIP].map(() => '?').join(',') + ')', ...KV_SKIP) : [];
      await db.runAsync(`DELETE FROM ${t}`);
      for (const r of [...(b.tables[t] ?? []), ...keep]) {
        // Columns this version knows; an older backup simply leaves newer columns at their defaults.
        const names = Object.keys(r).filter((k) => cols.has(k));
        if (!names.length) continue;
        await db.runAsync(`INSERT OR REPLACE INTO ${t} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, ...names.map((k) => r[k] ?? null));
        rows++;
      }
    }
    await db.runAsync('DELETE FROM sync_pending');
    await db.runAsync('DELETE FROM http_cache');
  });
  const dir = photoDir();
  if (dir.exists) dir.delete();
  dir.create();
  let photos = 0;
  for (const [name, data] of Object.entries(b.photos ?? {})) {
    if (!/^[\w.-]+$/.test(name)) continue; // never write outside the photo folder
    try {
      const f = new File(dir, name);
      f.create();
      f.write(data, { encoding: 'base64' });
      photos++;
    } catch {
      // The records are already restored; a photo that can't be written falls back to its thumbnail.
    }
  }
  return { rows, photos };
}
