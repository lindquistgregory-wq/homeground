/**
 * Monthly solar resource and PV estimates on-device (§5.4 insolation, §5.6 solar-array estimate),
 * from NASA POWER monthly mean daily horizontal irradiation. No PV API.
 *
 * Method: Klein's average day per month; Erbs monthly diffuse fraction; beam on the tilted plane from
 * numerically integrated incidence (any azimuth); isotropic sky; ground albedo 0.2; PVWatts-style
 * performance ratio 0.86 (14 % system losses).
 */
const D2R = Math.PI / 180;
const GSC = 1367; // W/m²
export const AVERAGE_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function declinationDeg(n: number): number {
  return 23.45 * Math.sin(((360 * (284 + n)) / 365) * D2R);
}

/** Extraterrestrial daily irradiation on a horizontal surface, kWh/m²/day. */
export function extraterrestrialDaily(latDeg: number, n: number): number {
  const phi = latDeg * D2R, d = declinationDeg(n) * D2R;
  const x = -Math.tan(phi) * Math.tan(d);
  const ws = x <= -1 ? Math.PI : x >= 1 ? 0 : Math.acos(x);
  const e = 1 + 0.033 * Math.cos(((360 * n) / 365) * D2R);
  return ((24 / Math.PI) * GSC * e * (Math.cos(phi) * Math.cos(d) * Math.sin(ws) + ws * Math.sin(phi) * Math.sin(d))) / 1000;
}

/** Erbs et al. monthly-average diffuse fraction from the clearness index KT. */
export function diffuseFraction(kt: number, sunsetHourAngleDeg: number): number {
  const k = Math.min(0.8, Math.max(0.3, kt));
  return sunsetHourAngleDeg <= 81.4
    ? 1.391 - 3.56 * k + 4.189 * k * k - 2.137 * k ** 3
    : 1.311 - 3.022 * k + 3.427 * k * k - 1.821 * k ** 3;
}

/** Ratio of daily beam on a tilted plane to beam on the horizontal, by numerical integration. */
export function beamRatio(latDeg: number, n: number, tiltDeg: number, azimuthDeg: number): number {
  const phi = latDeg * D2R, d = declinationDeg(n) * D2R, b = tiltDeg * D2R;
  const g = (azimuthDeg - 180) * D2R; // surface azimuth measured from south, west positive
  let tilt = 0, horiz = 0;
  for (let w = -Math.PI; w <= Math.PI; w += Math.PI / 288) {
    const cz = Math.cos(phi) * Math.cos(d) * Math.cos(w) + Math.sin(phi) * Math.sin(d);
    if (cz <= 0) continue;
    const ct =
      Math.sin(d) * Math.sin(phi) * Math.cos(b) - Math.sin(d) * Math.cos(phi) * Math.sin(b) * Math.cos(g) +
      Math.cos(d) * Math.cos(phi) * Math.cos(b) * Math.cos(w) + Math.cos(d) * Math.sin(phi) * Math.sin(b) * Math.cos(g) * Math.cos(w) +
      Math.cos(d) * Math.sin(b) * Math.sin(g) * Math.sin(w);
    tilt += Math.max(0, ct);
    horiz += cz;
  }
  return horiz > 0 ? tilt / horiz : 0;
}

export interface MonthlyResource {
  /** Mean daily global horizontal irradiation, kWh/m²/day (NASA POWER ALLSKY_SFC_SW_DWN). */
  ghi: number[];
}

export interface PlaneOfArray {
  /** Mean daily irradiation on the tilted plane per month, kWh/m²/day. */
  monthly: number[];
  annualKWhPerM2: number;
}

export function planeOfArray(latDeg: number, res: MonthlyResource, tiltDeg: number, azimuthDeg: number, albedo = 0.2): PlaneOfArray {
  const monthly = res.ghi.map((H, m) => {
    const n = AVERAGE_DAY[m]!;
    const H0 = extraterrestrialDaily(latDeg, n);
    const kt = H0 > 0 ? H / H0 : 0;
    const x = -Math.tan(latDeg * D2R) * Math.tan(declinationDeg(n) * D2R);
    const ws = (Math.acos(Math.max(-1, Math.min(1, x))) * 180) / Math.PI;
    const Hd = H * diffuseFraction(kt, ws);
    const Hb = H - Hd;
    const c = Math.cos(tiltDeg * D2R);
    return Hb * beamRatio(latDeg, n, tiltDeg, azimuthDeg) + Hd * ((1 + c) / 2) + H * albedo * ((1 - c) / 2);
  });
  return { monthly, annualKWhPerM2: monthly.reduce((s, v, m) => s + v * DAYS_IN_MONTH[m]!, 0) };
}

export interface PvEstimate {
  monthlyKWh: number[];
  annualKWh: number;
  /** Assumptions shown to the user. */
  notes: string[];
}

export function estimatePv(latDeg: number, res: MonthlyResource, systemKw: number, tiltDeg: number, azimuthDeg: number, performanceRatio = 0.86, shadeLossFraction = 0): PvEstimate {
  const poa = planeOfArray(latDeg, res, tiltDeg, azimuthDeg);
  const monthlyKWh = poa.monthly.map((h, m) => h * DAYS_IN_MONTH[m]! * systemKw * performanceRatio * (1 - shadeLossFraction));
  return {
    monthlyKWh,
    annualKWh: monthlyKWh.reduce((a, b) => a + b, 0),
    notes: [
      `${systemKw} kW DC at ${tiltDeg}° tilt facing ${azimuthDeg}° (clockwise from north).`,
      `${Math.round((1 - performanceRatio) * 100)} % system losses (wiring, inverter, soiling, temperature)${shadeLossFraction ? ` plus ${Math.round(shadeLossFraction * 100)} % shading from your site model` : ''}.`,
      'Long-term monthly averages from NASA POWER; any single year can differ by ±10 %.',
    ],
  };
}

/**
 * Daily insolation at a cell (kWh/m²): the beam share scaled by the cell's fraction of possible
 * direct sun, plus the diffuse share (assumes an open sky; canopy reduces this further).
 */
export function cellInsolation(ghiDaily: number, diffuseFrac: number, sunHours: number, possibleSunHours: number): number {
  const beam = ghiDaily * (1 - diffuseFrac);
  return beam * (possibleSunHours > 0 ? Math.min(1, sunHours / possibleSunHours) : 0) + ghiDaily * diffuseFrac;
}
