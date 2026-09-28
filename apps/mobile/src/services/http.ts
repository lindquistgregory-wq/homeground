import { HttpClient, type FetchLike } from '@homeground/providers';
import { SqliteHttpCache } from '../db/database';
import { USER_AGENT } from '../config';

// React Native's global fetch matches FetchLike closely enough; adapt the header accessor explicitly.
const rnFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, headers: { get: (n) => res.headers.get(n) }, text: () => res.text() };
};

export const http = new HttpClient({ fetch: rnFetch, userAgent: USER_AGENT, cache: new SqliteHttpCache() });
