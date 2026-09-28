/**
 * Query-string builder. React Native's URL/URLSearchParams polyfills are incomplete on some versions,
 * so providers never depend on them.
 */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function hostname(url: string): string {
  return (/^https?:\/\/([^/:?#]+)/i.exec(url)?.[1] ?? '').toLowerCase();
}
