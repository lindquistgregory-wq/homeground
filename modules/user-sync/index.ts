import { requireOptionalNativeModule } from 'expo';

/**
 * JS surface of the native module. Batches are opaque JSON strings; the native side only stores and lists
 * them in the user's private cloud storage. Returns `null` when the native module isn't linked
 * (e.g. running in Expo Go or on web), and the app then runs purely local.
 */
export interface UserSyncNative {
  isAvailable(): Promise<boolean>;
  upload(batchId: string, payload: string): Promise<void>;
  listSince(cursor: string | null): Promise<{ batches: string[]; cursor: string | null }>;
  /** Deletes every Plotwright record in the user's cloud (§11 data delete). */
  deleteAll(): Promise<void>;
}

export const UserSync = requireOptionalNativeModule<UserSyncNative>('UserSync');
