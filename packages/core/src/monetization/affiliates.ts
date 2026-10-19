/**
 * Affiliate links (prompt §10; owner decision 8), built only for programs the owner has joined and
 * marked active. Every link is HTTPS to the merchant's own host or its named tracking host, carries
 * only a topic search term from the bundled library (never a parcel, location, animal name or
 * record), and opens in the phone's browser. Nothing near medication, dosing or disease.
 */

export type AffiliatePlacement = 'animal-detail' | 'plant-detail';

export interface AffiliateProgram {
  id: string;
  name: string;
  category: 'seeds' | 'garden-tools' | 'homestead' | 'livestock-supplies' | 'pet-supplies' | 'general';
  network: string;
  signupUrl: string | null;
  merchantHost: string;
  trackingHosts: string[];
  status: 'needs-signup' | 'active' | 'paused';
  /** Public in every link once the owner joins, so not a secret. */
  affiliateId: string | null;
  /** The program's deep-link format with `{q}` (search term) and `{id}` (affiliate id). */
  linkTemplate: string | null;
  termsCheckedOn: string | null;
  disclosure: string;
  allowedPlacements: AffiliatePlacement[];
}

export interface AffiliateLink { programId: string; name: string; url: string; disclosure: string }

const FORBIDDEN = /medic|vaccin|antibiot|deworm|wormer|dose|dosage|ivermectin|penicillin|drug|treatment|disease|cure|live (chicks?|animals?|birds?)/i;

/** Lower-case host of an https URL, or null (no URL class in shared code). */
export function httpsHost(url: string): string | null {
  const m = /^https:\/\/([^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/** A topic term is a few plain words ("chicken feeder"); anything else is refused. */
export function safeTopic(term: string): string | null {
  const t = term.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 40 || !/^[a-z][a-z '-]*$/i.test(t) || FORBIDDEN.test(t)) return null;
  return t.toLowerCase();
}

/** Links for one placement and topic. Empty unless a program is active, configured and allowed there. */
export function affiliateLinks(programs: AffiliateProgram[], placement: AffiliatePlacement, topic: string): AffiliateLink[] {
  const q = safeTopic(topic);
  if (!q) return [];
  const out: AffiliateLink[] = [];
  for (const p of programs) {
    if (p.status !== 'active' || !p.affiliateId || !p.linkTemplate || !p.allowedPlacements.includes(placement)) continue;
    const url = p.linkTemplate.replace('{q}', encodeURIComponent(q)).replace('{id}', encodeURIComponent(p.affiliateId));
    const host = httpsHost(url);
    if (!host || (host !== p.merchantHost.toLowerCase() && !p.trackingHosts.map((h) => h.toLowerCase()).includes(host))) continue;
    out.push({ programId: p.id, name: p.name, url, disclosure: p.disclosure });
  }
  return out;
}

/** Programs that could show links at all (drives the "Show shopping links" switch and Disclosures). */
export const activePrograms = (programs: AffiliateProgram[]) => programs.filter((p) => p.status === 'active' && p.affiliateId && p.linkTemplate);
