import { bundledParcelRegistry, REMOTE_REGISTRY_URL, type ParcelRegistry } from '@plotwright/data';
import { mergeRegistries, TTL } from '@plotwright/providers';
import { http } from './http';

/** Bundled registry, refreshed from the static JSON on the free host when reachable (cached 30 days). */
export async function currentRegistry(): Promise<ParcelRegistry> {
  try {
    const { data } = await http.json<ParcelRegistry>(REMOTE_REGISTRY_URL, { ttlMs: TTL.parcel, maxAttempts: 1, timeoutMs: 5000 });
    return mergeRegistries(bundledParcelRegistry, data);
  } catch {
    return bundledParcelRegistry;
  }
}
