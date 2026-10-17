/**
 * Weather alerts for animals (prompt §4), the counterpart of weatherAlerts for crops: heat stress
 * from temperature or THI (humidity from the forecast, or a muggy fallback), freezing water, cold
 * below a sourced safe minimum, and storms for hives and shelters. Bodies say what to do; they never
 * give medical advice. Safety alerts are free on every plan.
 */
import type { ForecastPeriod } from '../plants/garden';
import { FREEZE_F, heatStress } from './safetyDefaults';
import type { AnimalSpec } from './types';

export interface ActiveHerd {
  herdId: string;
  animal: AnimalSpec;
  count: number;
  housingName: string;
}

export interface AnimalAlert {
  kind: 'heat' | 'freeze-water' | 'cold' | 'wind';
  at: string;
  title: string;
  body: string;
  herdIds: string[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? DAYS[new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).getUTCDay()]! : '';
};
const names = (hs: ActiveHerd[]) => {
  const n = [...new Set(hs.map((h) => `${h.animal.commonName.toLowerCase()} (${h.housingName})`))];
  return `${n.slice(0, 3).join(', ')}${n.length > 3 ? ` and ${n.length - 3} more` : ''}`;
};

export function livestockAlerts(periods: ForecastPeriod[], herds: ActiveHerd[], opts: { summerRhPct?: number } = {}): AnimalAlert[] {
  const out: AnimalAlert[] = [];
  if (!herds.length) return out;
  for (const p of periods) {
    const day = dayLabel(p.start);
    if (!p.isNight) {
      const hot = herds.filter((h) => heatStress(h.animal, p.temperatureF, p.relativeHumidityPct, opts.summerRhPct).stressed);
      if (hot.length)
        out.push({
          kind: 'heat', at: p.start, herdIds: hot.map((h) => h.herdId),
          title: `Heat stress risk ${day}: high ${Math.round(p.temperatureF)} °F${p.relativeHumidityPct !== undefined ? `, ${Math.round(p.relativeHumidityPct)}% humidity` : ''}`,
          body: `Check ${names(hot)}: shade, plenty of cool fresh water, and air flow. Do chores early, avoid moving or handling animals in the heat, and check on them through the afternoon.`,
        });
    } else {
      if (p.temperatureF <= FREEZE_F)
        out.push({
          kind: 'freeze-water', at: p.start, herdIds: herds.filter((h) => h.animal.kind !== 'pollinator').map((h) => h.herdId),
          title: `Freezing ${day} night: low ${Math.round(p.temperatureF)} °F`,
          body: 'Water troughs, bowls and lines may freeze: check them first thing and keep water available. Close up poultry and give dry bedding.',
        });
      const cold = herds.filter((h) => h.animal.cold.safeMinF !== undefined && p.temperatureF <= h.animal.cold.safeMinF);
      if (cold.length)
        out.push({ kind: 'cold', at: p.start, herdIds: cold.map((h) => h.herdId), title: `Hard cold ${day} night: low ${Math.round(p.temperatureF)} °F`, body: `Bring ${names(cold)} into shelter out of the wind, with dry bedding and unfrozen water.` });
    }
    if ((p.windMph ?? 0) >= 30) {
      const exposed = herds.filter((h) => h.animal.kind === 'pollinator' || h.animal.housingObjects.some((k) => k !== 'barn'));
      if (exposed.length)
        out.push({ kind: 'wind', at: p.start, herdIds: exposed.map((h) => h.herdId), title: `Wind to ${Math.round(p.windMph!)} mph ${day}`, body: 'Strap or weight hive lids, secure shelters and runs, and check fences after the wind drops.' });
    }
  }
  return out;
}
