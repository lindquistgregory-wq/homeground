/**
 * Bed-level planning helpers: crop rotation (§6 "crop-rotation history per bed"), to-scale planting
 * layout and yield estimates, tall crops that shade their neighbours, and weather alerts tied to
 * what's actually planted (§7.3).
 */
import type { PlantSpec } from './types';

// ---------------- Rotation ----------------

export interface PlantingRecord {
  plantId: string;
  family: string;
  year: number;
}

/** Families that build soil-borne disease and pests when replanted in the same place. */
const ROTATION_YEARS: Record<string, number> = {
  Solanaceae: 3, Brassicaceae: 3, Cucurbitaceae: 3, Amaryllidaceae: 3, Apiaceae: 2, Fabaceae: 2, Amaranthaceae: 2, Poaceae: 2, Asteraceae: 2,
};

export interface RotationAdvice {
  ok: boolean;
  message: string;
}

export function rotationAdvice(plant: PlantSpec, history: PlantingRecord[], year: number): RotationAdvice {
  if (plant.lifecycle === 'perennial' || plant.kind === 'cover-crop') return { ok: true, message: 'Rotation does not apply.' };
  const gap = ROTATION_YEARS[plant.family] ?? 2;
  const recent = history.filter((h) => h.family === plant.family && year - h.year > 0 && year - h.year < gap).sort((a, b) => b.year - a.year)[0];
  if (recent) {
    const ago = year - recent.year;
    return {
      ok: false,
      message: `${plant.family.replace('aceae', '')} family crops grew here ${ago === 1 ? 'last year' : `${ago} years ago`}. Waiting ${gap} years between them reduces soil-borne disease and pests.`,
    };
  }
  const legumeLastYear = history.some((h) => h.family === 'Fabaceae' && h.year === year - 1);
  const heavyFeeder = ['Solanaceae', 'Brassicaceae', 'Cucurbitaceae', 'Poaceae'].includes(plant.family);
  return { ok: true, message: legumeLastYear && heavyFeeder ? 'Good rotation: last year’s legumes left extra nitrogen for this heavy feeder.' : 'Good rotation.' };
}

// ---------------- Layout ----------------

export interface BedLayout {
  plantCount: number;
  rows: number;
  perRow: number;
  /** Plant centres in bed-local metres, origin at the bed's corner, x along the length. */
  positions: Array<[number, number]>;
  method: 'rows' | 'square-foot';
  rowLengthM: number;
}

const IN = 0.0254;

/**
 * Fill a rectangular bed with a crop at its recommended spacing. Uses square-foot density for small
 * crops in beds up to 1.25 m wide, rows otherwise.
 */
export function layoutBed(plant: PlantSpec, widthM: number, lengthM: number, share = 1): BedLayout {
  const len = lengthM * Math.max(0, Math.min(1, share));
  if (plant.perSquareFoot && widthM <= 1.25) {
    const sqFt = 0.3048;
    const cols = Math.max(1, Math.floor(len / sqFt)), rowsSq = Math.max(1, Math.floor(widthM / sqFt));
    // n plants per square arranged a × b (e.g. 8 → 3 × 3 minus one, 2 → 2 × 1).
    const n = plant.perSquareFoot;
    const a = Math.ceil(Math.sqrt(n)), b = Math.ceil(n / a);
    const positions: Array<[number, number]> = [];
    for (let ci = 0; ci < cols; ci++)
      for (let rj = 0; rj < rowsSq; rj++)
        for (let k = 0; k < n; k++) {
          const u = k % a, v = Math.floor(k / a);
          positions.push([ci * sqFt + ((u + 0.5) * sqFt) / a, rj * sqFt + ((v + 0.5) * sqFt) / b]);
        }
    return { plantCount: cols * rowsSq * n, rows: rowsSq * b, perRow: cols * a, positions, method: 'square-foot', rowLengthM: len * rowsSq * b };
  }
  const inRow = plant.spacingIn.inRow * IN;
  // In beds, crops can be planted closer than field row spacing: use the larger of in-row and 60 % of row spacing.
  const between = Math.max(inRow, plant.spacingIn.betweenRows * IN * 0.6);
  const rows = Math.max(1, Math.floor(widthM / between + 1e-9));
  const perRow = Math.max(1, Math.floor(len / inRow + 1e-9));
  const positions: Array<[number, number]> = [];
  const y0 = (widthM - (rows - 1) * between) / 2, x0 = (len - (perRow - 1) * inRow) / 2;
  for (let r = 0; r < rows; r++) for (let i = 0; i < perRow; i++) positions.push([x0 + i * inRow, y0 + r * between]);
  return { plantCount: rows * perRow, rows, perRow, positions, method: 'rows', rowLengthM: rows * len };
}

/** Rough yield (lb) for a layout or a number of perennial plants. */
export function estimateYieldLb(plant: PlantSpec, layout: BedLayout): [number, number] | null {
  if (!plant.yieldLb) return null;
  if (plant.yieldLb.per === 'plant') return [plant.yieldLb.range[0] * layout.plantCount, plant.yieldLb.range[1] * layout.plantCount];
  const tenFt = layout.rowLengthM / 3.048;
  return [plant.yieldLb.range[0] * tenFt, plant.yieldLb.range[1] * tenFt];
}

/** Mature height (m) if the crop is tall enough to shade neighbours (> 1 m), else null. */
export function shadeHeightM(plant: PlantSpec): number | null {
  const h = plant.heightIn * IN;
  return h > 1 ? h : null;
}

// ---------------- Weather alerts ----------------

export interface ForecastPeriod {
  start: string; // ISO
  end: string;
  isNight: boolean;
  temperatureF: number;
  windMph?: number;
  summary?: string;
}

export interface PlantedCrop {
  plantingId: string;
  plant: PlantSpec;
  bedName: string;
}

export interface WeatherAlert {
  kind: 'frost' | 'freeze' | 'heat' | 'wind';
  at: string;
  title: string;
  body: string;
  plantingIds: string[];
}

/** Forecast low at or below which each tolerance class needs protection (°F). Air temps are measured
 * ~5 ft up; plants at ground level on clear, still nights can be a few degrees colder. */
export const PROTECT_BELOW_F: Record<PlantSpec['frost'], number> = { tender: 36, 'half-hardy': 32, hardy: 28, 'very-hardy': 20 };

export function weatherAlerts(periods: ForecastPeriod[], crops: PlantedCrop[]): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  for (const p of periods) {
    if (p.isNight) {
      const hit = crops.filter((c) => p.temperatureF <= PROTECT_BELOW_F[c.plant.frost]);
      if (hit.length) {
        const hard = p.temperatureF <= 28;
        const names = unique(hit.map((c) => `${c.plant.commonName} (${c.bedName})`));
        alerts.push({
          kind: hard ? 'freeze' : 'frost',
          at: p.start,
          title: `${hard ? 'Freeze' : 'Frost'} risk tonight: low ${Math.round(p.temperatureF)} °F`,
          body: `Protect ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}: cover with row cover or sheets before dusk, water dry soil, and bring in containers.`,
          plantingIds: hit.map((c) => c.plantingId),
        });
      }
    } else {
      if (p.temperatureF >= 95) {
        const hit = crops.filter((c) => c.plant.season === 'cool' || c.plant.heat === 'low' || c.plant.id === 'tomato' || c.plant.id.startsWith('pepper'));
        if (hit.length)
          alerts.push({
            kind: 'heat', at: p.start, title: `Heat: high ${Math.round(p.temperatureF)} °F`,
            body: `Water deeply in the morning and shade ${unique(hit.map((c) => c.plant.commonName)).slice(0, 4).join(', ')}. Tomatoes and peppers drop blossoms above ~90 °F.`,
            plantingIds: hit.map((c) => c.plantingId),
          });
      }
    }
    if ((p.windMph ?? 0) >= 30) {
      const tall = crops.filter((c) => c.plant.heightIn >= 48);
      if (tall.length)
        alerts.push({ kind: 'wind', at: p.start, title: `Wind gusts to ${Math.round(p.windMph!)} mph`, body: `Check stakes and trellises for ${unique(tall.map((c) => c.plant.commonName)).slice(0, 4).join(', ')}.`, plantingIds: tall.map((c) => c.plantingId) });
    }
  }
  return alerts;
}

const unique = <T>(xs: T[]) => [...new Set(xs)];
