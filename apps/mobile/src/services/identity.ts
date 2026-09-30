import * as Crypto from 'expo-crypto';
import { HybridClock } from '@plotwright/core';
import { kvGet, kvSet, maxStoredHlc } from '../db/database';

let deviceId: string | null = null;
let hlc: HybridClock | null = null;

export const newId = (): string => Crypto.randomUUID();

/** Per-install random id used only to order sync edits. Never sent anywhere but the user's own cloud. */
export async function initIdentity(): Promise<string> {
  if (deviceId) return deviceId;
  deviceId = (await kvGet('deviceId')) ?? newId();
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
