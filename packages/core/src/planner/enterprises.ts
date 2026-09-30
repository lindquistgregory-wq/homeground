/**
 * lookup_enterprise_profile and the income module (§9.2): small enterprises compared on land, weekly
 * labour, startup cost and market access, from sourced profiles. Rough ranges, never advice.
 */
import type { HomesteadGoals } from './goals';
import type { EnterpriseProfile, KnowledgeBase, Range } from './kb';

export const INCOME_DISCLAIMER =
  'Rough ranges from published extension budgets and benchmark studies, not financial, tax or legal advice. Prices, costs and rules vary by state and market; check your state’s cottage-food, licensing, processing and insurance rules before selling.';

const ALIASES: Record<string, string[]> = {
  eggs_small_flock: ['egg', 'eggs', 'hens', 'layer'],
  market_garden_per_acre: ['market garden', 'vegetables', 'csa', 'produce', 'farmers market'],
  market_garden_quarter_acre: ['small market garden', 'quarter acre'],
  microgreens: ['microgreen', 'micro greens', 'sprouts'],
  cut_flowers: ['flowers', 'cut flower', 'bouquet'],
  nursery_plants: ['nursery', 'plant starts', 'seedlings', 'transplants'],
  honey: ['bees', 'honey', 'apiary'],
  mushrooms_shiitake_logs: ['shiitake', 'mushroom logs'],
  mushrooms_oyster_indoor: ['oyster', 'mushroom'],
  value_added_cottage_food: ['jam', 'baked', 'cottage', 'value added', 'preserves', 'value-added'],
  agritourism: ['agritourism', 'u-pick', 'farm stay', 'events', 'tours'],
  meat_birds_pastured_broilers: ['broilers', 'meat birds', 'pastured chicken', 'meat chickens'],
};

export function enterpriseIds(kb: KnowledgeBase): string[] {
  return Object.keys(kb.homestead.enterprises);
}

/** Find an enterprise by id or by plain words ("eggs", "u-pick"). */
export function lookupEnterprise(query: string, kb: KnowledgeBase): { id: string; profile: EnterpriseProfile } | null {
  const q = query.trim().toLowerCase().replace(/[-\s]+/g, '_');
  const ents = kb.homestead.enterprises;
  if (ents[q]) return { id: q, profile: ents[q]! };
  const words = query.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const id of Object.keys(ents)) {
    const terms = [id.replace(/_/g, ' '), ...(ALIASES[id] ?? [])];
    const score = Math.max(...terms.map((t) => (words.includes(t) ? t.length : t.split(' ').some((w) => w.length > 3 && words.includes(w)) ? 1 : 0)));
    if (score > 0 && (!best || score > best.score)) best = { id, score };
  }
  return best ? { id: best.id, profile: ents[best.id]! } : null;
}

export interface EnterpriseFit {
  id: string;
  name: string;
  fit: 'good' | 'possible' | 'poor';
  reasons: string[];
  startupCostUSD: Range | null;
  weeklyLaborHours: Range | null;
  revenue: string;
  regulatory: string[];
  sources: EnterpriseProfile['sources'];
}

const NEEDS_STRONG_MARKET = new Set(['agritourism', 'market_garden_per_acre', 'cut_flowers', 'microgreens']);

function revenueText(p: EnterpriseProfile): string {
  const bits: string[] = [];
  const f = (k: string, label: string) => {
    const v = p[k];
    if (Array.isArray(v) && v.length === 2) bits.push(`${label} $${Math.round(v[0] as number).toLocaleString('en-US')}–$${Math.round(v[1] as number).toLocaleString('en-US')}`);
  };
  f('grossRevenueUSD', 'gross'); f('grossRevenueUSDPerAcre', 'gross per acre'); f('grossRevenueUSDPerYear', 'gross a year'); f('grossRevenueUSDPerTray', 'gross per tray');
  f('grossRevenueUSDPerBird', 'gross per bird'); f('grossRevenueUSDPerFarm', 'gross per farm');
  f('netIncomeUSD', 'net'); f('netIncomeUSDPerYear', 'net a year'); f('netIncomeUSDPerTray', 'net per tray'); f('netIncomeUSDPerBird', 'net per bird');
  const m = p.netMarginPct;
  if (Array.isArray(m)) bits.push(`net margin ${m[0]}% to ${m[1]}%`);
  return bits.join('; ') || 'No sourced revenue figure.';
}

/** Compare every enterprise against the household's land, time, money and market. */
export function compareEnterprises(g: HomesteadGoals, parcelAcres: number | undefined, kb: KnowledgeBase): EnterpriseFit[] {
  const out: EnterpriseFit[] = [];
  for (const [id, p] of Object.entries(kb.homestead.enterprises)) {
    const reasons: string[] = [];
    let score = 2; // 2 good, 1 possible, 0 poor
    const land = p.landNeededAcres;
    if (land && parcelAcres !== undefined && land[0] > parcelAcres) {
      score = 0;
      reasons.push(`Needs about ${land[0]} acre${land[0] === 1 ? '' : 's'}; the parcel is ${parcelAcres.toFixed(2)}.`);
    }
    const labor = p.weeklyLaborHours;
    if (labor && g.hoursPerWeek !== undefined) {
      if (labor[0] > g.hoursPerWeek) { score = Math.min(score, 0); reasons.push(`Takes ${labor[0]}–${labor[1]} h/week in season; you have about ${g.hoursPerWeek}.`); }
      else if (labor[1] > g.hoursPerWeek) { score = Math.min(score, 1); reasons.push(`Takes up to ${labor[1]} h/week in season.`); }
    } else if (!labor) reasons.push('Weekly labour isn’t in the sources: ask local growers.');
    const start = p.startupCostUSD as Range | null | undefined;
    if (start && g.budgetStartupUsd !== undefined && start[0] > g.budgetStartupUsd) {
      score = Math.min(score, 0);
      reasons.push(`Startup about $${Math.round(start[0]).toLocaleString('en-US')}+ vs your $${g.budgetStartupUsd.toLocaleString('en-US')}.`);
    }
    if (NEEDS_STRONG_MARKET.has(id) && g.marketAccess === 'none') { score = Math.min(score, 0); reasons.push('Depends on nearby buyers.'); }
    else if (NEEDS_STRONG_MARKET.has(id) && g.marketAccess === 'some') { score = Math.min(score, 1); reasons.push('Depends on steady nearby buyers.'); }
    if ((id === 'eggs_small_flock' || id === 'meat_birds_pastured_broilers') && g.animals === 'no') { score = 0; reasons.push('Animals aren’t allowed here.'); }
    if (id === 'honey' && g.animals === 'no') { score = Math.min(score, 1); reasons.push('Check whether bees count as animals under your rules.'); }
    out.push({
      id, name: id.replace(/_/g, ' '), fit: score === 2 ? 'good' : score === 1 ? 'possible' : 'poor', reasons,
      startupCostUSD: start ?? null, weeklyLaborHours: labor ?? null, revenue: revenueText(p), regulatory: p.regulatory, sources: p.sources,
    });
  }
  const rank = { good: 0, possible: 1, poor: 2 };
  return out.sort((a, b) => rank[a.fit] - rank[b.fit] || (a.startupCostUSD?.[0] ?? 1e9) - (b.startupCostUSD?.[0] ?? 1e9));
}
