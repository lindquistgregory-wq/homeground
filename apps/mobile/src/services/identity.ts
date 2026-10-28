import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { HybridClock } from '@plotwright/core';
import { kvSet, maxStoredHlc } from '../db/database';

let deviceId: string | null = null;
let hlc: HybridClock | null = null;

export const newId = (): string => Crypto.randomUUID();

const DEVICE_KEY = 'plotwright.deviceId';

/**
 * Per-install random id used only to order sync edits. Never sent anywhere but the user's own cloud.
 * Kept in secure storage, which Android backup and device transfer leave out: a phone restored from a
 * backup of the database gets its own id, so it doesn't skip the old phone's changes as its own.
 */
export async function initIdentity(): Promise<string> {
  if (deviceId) return deviceId;
  let id: string | null = null;
  try { id = await SecureStore.getItemAsync(DEVICE_KEY); } catch { id = null; }
  deviceId = id ?? newId();
  if (!id) {
    try { await SecureStore.setItemAsync(DEVICE_KEY, deviceId, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }); } catch { /* keep the id for this run */ }
  }
  await kvSet('deviceId', deviceId);
  hlc = new HybridClock(deviceId);
  // The clock restarts at zero on every launch; move it past every stamp already stored so a slow or
  // reset wall clock can't make new local edits lose to older ones.
  const seen = await maxStoredHlc();
  if (seen) hlc.receive(seen);
  return deviceId;
}

export function clock(): HybridClock {
  if (!hlc) throw new Error('initIdentity() must run before writes');
  return hlc;
}

export function getDeviceId(): string {
  if (!deviceId) throw new Error('initIdentity() must run first');
  return deviceId;
}
