/**
 * The user's own station keys and sensor bindkeys, kept in the platform keychain/keystore
 * (expo-secure-store), never in SQLite, never synced, never sent anywhere but the station's own API.
 */
import * as SecureStore from 'expo-secure-store';

export interface SensorSecret {
  /** Ecowitt / Ambient application key. */
  applicationKey?: string;
  /** Ecowitt / Ambient / WeatherLink API key. */
  apiKey?: string;
  /** WeatherLink API secret. */
  apiSecret?: string;
  /** BLE bindkey, hex. */
  bindkey?: string;
}

const keyFor = (sensorId: string) => `sensor.${sensorId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export async function getSecret(sensorId: string): Promise<SensorSecret | undefined> {
  const v = await SecureStore.getItemAsync(keyFor(sensorId));
  if (!v) return undefined;
  try {
    return JSON.parse(v) as SensorSecret;
  } catch {
    return undefined;
  }
}

export async function setSecret(sensorId: string, s: SensorSecret): Promise<void> {
  await SecureStore.setItemAsync(keyFor(sensorId), JSON.stringify(s), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

export async function deleteSecret(sensorId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(sensorId));
}

export async function deleteSecrets(sensorIds: string[]): Promise<void> {
  for (const id of sensorIds) await deleteSecret(id).catch(() => undefined);
}
