/**
 * estimate_budget (§9.2): startup and yearly costs as sourced ranges. Costs are only scaled when the
 * source's unit allows it (per foot, per square foot, per hive, per doe). Budgets published for a whole
 * flock or system are quoted at their own scale, never stretched to a different size.
 */
import type { InfrastructureItem, KbSource, KnowledgeBase, Range } from './kb';

export type BudgetItem =
  | { kind: 'drip'; areaSqFt: number }
  | { kind: 'deer-fence'; lengthFt: number }
  | { kind: 'livestock-fence'; lengthFt: number; type?: 'woven_wire_plus_barbed' | 'barbed_5_strand' | 'high_tensile_6_wire' | 'electric_polywire_interior' }
  | { kind: 'high-tunnel'; areaSqFt: number }
  | { kind: 'coop' }
  | { kind: 'rain-catchment'; gallons: number }
  | { kind: 'root-cellar' }
  | { kind: 'well' }
  | { kind: 'raised-beds'; count: number }
  | { kind: 'chest-freezer' }
  | { kind: 'livestock'; species: string; count: number };

export interface BudgetLine {
  label: string;
  startup: Range | null;
  annual: Range | null;
  basis: string;
  year?: number | null;
  /** Price data before 2020, or a figure the source itself calls highly variable. */
  caution?: string;
  sources: KbSource[];
}

export interface Budget {
  lines: BudgetLine[];
  startupTotal: Range;
  annualTotal: Range;
  /** Items with no sourced cost (so the totals leave them out). */
  unknown: string[];
}

const scale = (r: Range, k: number): Range => [r[0] * k, r[1] * k];
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const moneyRange = (r: Range) => (Math.round(r[0]) === Math.round(r[1]) ? money(r[0]) : `${money(r[0])}–${money(r[1])}`);

/**
 * Per-species cost basis: how many animals the sourced startup/annual figure covers ('as-published'
 * means a whole-system budget that's quoted as-is).
 */
const LIVESTOCK_COST_SCALE: Record<string, { startup?: number | 'as-published'; annual?: number | 'as-published' }> = {
  laying_hens: { startup: 'as-published', annual: 10 }, // UMD 10-hen flock annual figure
  honeybees: { startup: 1, annual: 1 }, // per hive (Penn State 10-hive budget ÷ 10)
  meat_rabbits: { annual: 1 }, // per doe
  meat_goats: { startup: 'as-published', annual: 1 }, // startup is a 25-doe operation; annual per doe
  meat_chickens: { startup: 'as-published' }, // 100-bird mobile-pen system with processing equipment
};

function infra(kb: KnowledgeBase, id: string): InfrastructureItem | undefined {
  return kb.homestead.infrastructure[id];
}

function caution(it: { year?: number | null; oldPrice?: boolean; highlyVariable?: boolean }): string | undefined {
  if (it.highlyVariable) return 'Highly variable: get local quotes.';
  if (it.oldPrice || (typeof it.year === 'number' && it.year < 2020)) return `Price data from ${it.year ?? 'before 2020'}; expect higher today.`;
  return undefined;
}

export function budgetLine(item: BudgetItem, kb: KnowledgeBase): BudgetLine | { unknown: string } {
  switch (item.kind) {
    case 'drip': {
      const it = infra(kb, 'drip_irrigation');
      const r = it?.costUSDPer1000SqFt as Range | undefined;
      return r && it ? { label: `Drip irrigation, ${item.areaSqFt.toLocaleString('en-US')} sq ft`, startup: scale(r, item.areaSqFt / 1000), annual: null, basis: `${moneyRange(r)} per 1,000 sq ft (DIY)`, year: it.year, caution: caution(it), sources: it.sources } : { unknown: 'drip irrigation' };
    }
    case 'deer-fence': {
      const it = infra(kb, 'deer_fence');
      const r = it?.costUSDPerLinearFt as Range | undefined;
      return r && it ? { label: `Deer fence, ${Math.round(item.lengthFt)} ft`, startup: scale(r, item.lengthFt), annual: null, basis: `${moneyRange(r)} per foot`, year: it.year, caution: caution(it), sources: it.sources } : { unknown: 'deer fence' };
    }
    case 'livestock-fence': {
      const it = infra(kb, 'livestock_fence');
      const types = it?.costUSDPerLinearFt as unknown as Record<string, Range> | undefined;
      const t = item.type ?? 'woven_wire_plus_barbed';
      const r = types?.[t];
      return r && it ? { label: `Livestock fence (${t.replace(/_/g, ' ')}), ${Math.round(item.lengthFt)} ft`, startup: scale(r, item.lengthFt), annual: null, basis: `${moneyRange(r)} per foot`, year: it.year, caution: caution(it), sources: it.sources } : { unknown: 'livestock fence' };
    }
    case 'high-tunnel': {
      const it = infra(kb, 'high_tunnel');
      const r = it?.costUSDPerSqFt as Range | undefined;
      return r && it ? { label: `High tunnel, ${item.areaSqFt.toLocaleString('en-US')} sq ft`, startup: scale(r, item.areaSqFt), annual: null, basis: `${moneyRange(r)} per sq ft. NRCS EQIP cost-share may cover part of it`, year: it.year, caution: caution(it), sources: it.sources } : { unknown: 'high tunnel' };
    }
    case 'rain-catchment': {
      const it = infra(kb, 'rainwater_catchment');
      const r = it?.costUSDPerGallonStorage as Range | undefined;
      return r && it ? { label: `Rainwater catchment, ${item.gallons.toLocaleString('en-US')} gal`, startup: scale(r, item.gallons), annual: null, basis: `${moneyRange(r)} per gallon of storage`, year: it.year, caution: caution(it), sources: it.sources } : { unknown: 'rainwater catchment' };
    }
    case 'coop':
    case 'root-cellar':
    case 'well':
    case 'chest-freezer':
    case 'raised-beds': {
      const id = { coop: 'chicken_coop_small', 'root-cellar': 'root_cellar', well: 'well_and_pump', 'chest-freezer': 'chest_freezer', 'raised-beds': 'raised_bed_4x8' }[item.kind];
      const label = { coop: 'Small chicken coop', 'root-cellar': 'Root cellar', well: 'Well and pump', 'chest-freezer': 'Chest freezer', 'raised-beds': 'Raised beds' }[item.kind];
      const it = infra(kb, id);
      const r = it?.costUSD as Range | null | undefined;
      if (!r || !it) return { unknown: item.kind === 'raised-beds' ? `raised beds (${item.count})` : label.toLowerCase() };
      const n = item.kind === 'raised-beds' ? item.count : 1;
      return { label: n > 1 ? `${label} × ${n}` : label, startup: scale(r, n), annual: null, basis: it.note.split('. ')[0] ?? '', year: it.year, caution: caution(it), sources: it.sources };
    }
    case 'livestock': {
      const lp = kb.homestead.livestock[item.species];
      if (!lp) return { unknown: item.species };
      const basis = LIVESTOCK_COST_SCALE[item.species] ?? {};
      const name = item.species.replace(/_/g, ' ');
      const per = (r: Range | null, b: number | 'as-published' | undefined): Range | null => (!r || b === undefined ? null : b === 'as-published' ? r : scale(r, item.count / b));
      const startup = per(lp.startupCostUSD, basis.startup);
      const annual = per(lp.annualCostUSD, basis.annual);
      if (!startup && !annual) return { unknown: `${name} costs` };
      const notes: string[] = [];
      if (basis.startup === 'as-published' && startup) notes.push(`startup is the published budget for its own scale (${String(lp.startupNote ?? lp.unit).split('.')[0]})`);
      if (typeof basis.annual === 'number' && annual) notes.push(basis.annual === 1 ? `yearly cost ${lp.unit}` : `yearly cost scaled from a ${basis.annual}-animal budget`);
      return {
        label: `${item.count} ${name}`, startup, annual, basis: notes.join('; '),
        year: typeof lp.priceYear === 'number' ? lp.priceYear : null, caution: lp.oldPrice ? 'Price data before 2020; expect higher today.' : undefined, sources: lp.sources,
      };
    }
  }
}

export function estimateBudget(items: BudgetItem[], kb: KnowledgeBase): Budget {
  const lines: BudgetLine[] = [];
  const unknown: string[] = [];
  for (const it of items) {
    const l = budgetLine(it, kb);
    if ('unknown' in l) unknown.push(l.unknown);
    else lines.push(l);
  }
  const sum = (f: (l: BudgetLine) => Range | null): Range => lines.reduce<Range>((acc, l) => { const r = f(l); return r ? [acc[0] + r[0], acc[1] + r[1]] : acc; }, [0, 0]);
  return { lines, startupTotal: sum((l) => l.startup), annualTotal: sum((l) => l.annual), unknown };
}
