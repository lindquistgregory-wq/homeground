/**
 * Local-first sync through the *user's own* cloud storage (§0 Zero-Cost Rule 3): iCloud CloudKit
 * private database on iOS, Google Drive appDataFolder on Android. There is no developer server.
 *
 * Model: every record carries a Hybrid Logical Clock stamp; merges are last-writer-wins per record,
 * deletes are tombstones. The platform transport only needs to store and list opaque change batches,
 * so both CloudKit and Drive implement the same tiny `CloudTransport` interface.
 */

export interface HlcStamp {
  /** Wall-clock milliseconds. */
  ms: number;
  /** Logical counter for events within the same millisecond. */
  counter: number;
  /** Stable per-install id; breaks exact ties deterministically. */
  node: string;
}

export function encodeHlc(s: HlcStamp): string {
  return `${s.ms.toString().padStart(15, '0')}:${s.counter.toString(36).padStart(5, '0')}:${s.node}`;
}

export function decodeHlc(s: string): HlcStamp {
  const [ms, counter, ...node] = s.split(':');
  return { ms: Number(ms), counter: parseInt(counter ?? '0', 36), node: node.join(':') };
}

/** Encoded stamps sort lexicographically in causal order. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HybridClock {
  private last: HlcStamp;
  constructor(
    private readonly node: string,
    private readonly now: () => number = Date.now,
  ) {
    this.last = { ms: 0, counter: 0, node };
  }

  /** Stamp a local event. */
  tick(): string {
    const wall = this.now();
    if (wall > this.last.ms) this.last = { ms: wall, counter: 0, node: this.node };
    else this.last = { ms: this.last.ms, counter: this.last.counter + 1, node: this.node };
    return encodeHlc(this.last);
  }

  /** Advance past a stamp received from another device so later local edits win over it. */
  receive(remote: string): void {
    const r = decodeHlc(remote);
    const wall = this.now();
    const ms = Math.max(wall, this.last.ms, r.ms);
    let counter = 0;
    if (ms === this.last.ms && ms === r.ms) counter = Math.max(this.last.counter, r.counter) + 1;
    else if (ms === this.last.ms) counter = this.last.counter + 1;
    else if (ms === r.ms) counter = r.counter + 1;
    this.last = { ms, counter, node: this.node };
  }
}

export type SyncCollection = 'parcels' | 'siteProfiles' | 'designs' | 'plantings' | 'sensors' | 'sensorReadings' | 'plannerGoals' | 'tasks' | 'settings';
const COLLECTION_ORDER: SyncCollection[] = ['settings', 'parcels', 'siteProfiles', 'designs', 'plantings', 'sensors', 'sensorReadings', 'plannerGoals', 'tasks'];

export interface SyncRecord<T = unknown> {
  collection: SyncCollection;
  id: string;
  hlc: string;
  deleted: boolean;
  data: T | null;
}

export interface ChangeBatch {
  /** Unique id so a transport can dedupe re-uploads. */
  batchId: string;
  deviceId: string;
  createdHlc: string;
  records: SyncRecord[];
}

export interface CloudTransport {
  /** Whether the user is signed in to their cloud account and it is reachable. */
  isAvailable(): Promise<boolean>;
  upload(batch: ChangeBatch): Promise<void>;
  /** Batches created after `cursor` (opaque), plus the new cursor. */
  listSince(cursor: string | null): Promise<{ batches: ChangeBatch[]; cursor: string | null }>;
}

export interface LocalStore {
  get(collection: SyncCollection, id: string): Promise<SyncRecord | undefined>;
  /**
   * Store a record that arrived from another device. Must NOT mark it as a pending local change, and
   * must persist tombstones even for rows this device has never seen (so an older create can't
   * resurrect them).
   */
  applyRemote(record: SyncRecord): Promise<void>;
  /** Records changed locally since the last successful upload. */
  pendingChanges(): Promise<SyncRecord[]>;
  /** Clear pending markers only for records whose stamp still equals the uploaded one (edits made during the upload stay pending). */
  markUploaded(records: SyncRecord[]): Promise<void>;
  getCursor(): Promise<string | null>;
  setCursor(cursor: string | null): Promise<void>;
}

/** Last-writer-wins merge. Returns the record to keep. */
export function mergeRecord(local: SyncRecord | undefined, incoming: SyncRecord): SyncRecord {
  if (!local) return incoming;
  return compareHlc(incoming.hlc, local.hlc) > 0 ? incoming : local;
}

export interface SyncResult {
  uploaded: number;
  applied: number;
  skipped: number;
}

export async function syncOnce(
  deviceId: string,
  clock: HybridClock,
  store: LocalStore,
  transport: CloudTransport,
  newId: () => string,
): Promise<SyncResult | { unavailable: true }> {
  if (!(await transport.isAvailable())) return { unavailable: true };

  // 1. Pull first so our upload's stamps are ordered after anything we've seen.
  let applied = 0, skipped = 0;
  const { batches, cursor } = await transport.listSince(await store.getCursor());
  // Cloud stores may list batches in any order (CloudKit does). Apply them in causal order, and within
  // a batch apply parents (parcels) before children (site profiles).
  const ordered = [...batches].sort((a, b) => compareHlc(a.createdHlc, b.createdHlc));
  for (const batch of ordered) {
    if (batch.deviceId === deviceId) continue;
    const records = [...batch.records].sort((a, b) => COLLECTION_ORDER.indexOf(a.collection) - COLLECTION_ORDER.indexOf(b.collection));
    for (const rec of records) {
      clock.receive(rec.hlc);
      const local = await store.get(rec.collection, rec.id);
      const winner = mergeRecord(local, rec);
      if (winner === rec) {
        await store.applyRemote(rec);
        applied++;
      } else skipped++;
    }
  }
  await store.setCursor(cursor);

  // 2. Push local changes.
  const pending = await store.pendingChanges();
  if (pending.length > 0) {
    await transport.upload({ batchId: newId(), deviceId, createdHlc: clock.tick(), records: pending });
    await store.markUploaded(pending);
  }
  return { uploaded: pending.length, applied, skipped };
}
