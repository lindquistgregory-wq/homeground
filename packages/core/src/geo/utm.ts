/**
 * WGS84 ⇄ UTM using the Krüger n-series to sixth order (Karney 2011), accurate to well under a
 * millimetre inside a zone. Dependency-free so it runs identically in tests, React Native and workers.
 *
 * Norway/Svalbard zone exceptions are not applied — the app is US-first. Pass an explicit zone to
 * force all of a parcel's points into one zone (always do this for measurement).
 */

const A_AXIS = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING_SOUTH = 10000000;

const n = F / (2 - F);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const E = Math.sqrt(F * (2 - F));
const A = (A_AXIS / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

const ALPHA = [
  0,
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
  (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
  (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
  (212378941 / 319334400) * n6,
];

const BETA = [
  0,
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5 + (96199 / 604800) * n6,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
  (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
  (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
  (4583 / 161280) * n5 - (108847 / 3991680) * n6,
  (20648693 / 638668800) * n6,
];

const RAD = Math.PI / 180;

export interface UtmZone {
  zone: number; // 1..60
  hemisphere: 'N' | 'S';
}

export interface UtmPoint extends UtmZone {
  easting: number;
  northing: number;
  /** Point scale factor k at this location (grid distance / true distance). */
  scale: number;
}

export function utmZoneFor(lat: number, lon: number): UtmZone {
  const normLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const zone = Math.min(60, Math.floor((normLon + 180) / 6) + 1);
  return { zone, hemisphere: lat >= 0 ? 'N' : 'S' };
}

export function centralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/** EPSG code for a UTM zone on WGS84 (326xx north, 327xx south). */
export function utmEpsg(z: UtmZone): number {
  return (z.hemisphere === 'N' ? 32600 : 32700) + z.zone;
}

export function toUtm(lat: number, lon: number, force?: UtmZone): UtmPoint {
  if (!(Math.abs(lat) <= 84.5)) throw new RangeError(`Latitude ${lat} is outside the UTM range`);
  const z = force ?? utmZoneFor(lat, lon);
  const phi = lat * RAD;
  const lam = (lon - centralMeridian(z.zone)) * RAD;

  const cosLam = Math.cos(lam), sinLam = Math.sin(lam);
  const tau = Math.tan(phi);
  const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
  const tauP = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);

  const xiP = Math.atan2(tauP, cosLam);
  const etaP = Math.asinh(sinLam / Math.sqrt(tauP * tauP + cosLam * cosLam));

  let xi = xiP, eta = etaP;
  let pP = 1, qP = 0; // for scale factor
  for (let j = 1; j <= 6; j++) {
    const a = ALPHA[j]!;
    xi += a * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += a * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
    pP += 2 * j * a * Math.cos(2 * j * xiP) * Math.cosh(2 * j * etaP);
    qP += 2 * j * a * Math.sin(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }

  const easting = K0 * A * eta + FALSE_EASTING;
  let northing = K0 * A * xi;
  if (z.hemisphere === 'S') northing += FALSE_NORTHING_SOUTH;

  const sinPhi = Math.sin(phi);
  const kPrime =
    Math.sqrt(1 - E * E * sinPhi * sinPhi) * Math.sqrt(1 + tau * tau) / Math.sqrt(tauP * tauP + cosLam * cosLam);
  const kDoublePrime = (A / A_AXIS) * Math.sqrt(pP * pP + qP * qP);
  const scale = K0 * kPrime * kDoublePrime;

  return { ...z, easting, northing, scale };
}

export function fromUtm(easting: number, northing: number, z: UtmZone): { lat: number; lon: number } {
  const x = easting - FALSE_EASTING;
  const y = z.hemisphere === 'S' ? northing - FALSE_NORTHING_SOUTH : northing;
  const eta = x / (K0 * A);
  const xi = y / (K0 * A);

  let xiP = xi, etaP = eta;
  for (let j = 1; j <= 6; j++) {
    const b = BETA[j]!;
    xiP -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }

  const sinhEtaP = Math.sinh(etaP);
  const sinXiP = Math.sin(xiP), cosXiP = Math.cos(xiP);
  const tauP = sinXiP / Math.sqrt(sinhEtaP * sinhEtaP + cosXiP * cosXiP);

  let tau = tauP;
  for (let i = 0; i < 20; i++) {
    const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
    const tauI = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
    const dTau =
      ((tauP - tauI) / Math.sqrt(1 + tauI * tauI)) *
      ((1 + (1 - E * E) * tau * tau) / ((1 - E * E) * Math.sqrt(1 + tau * tau)));
    tau += dTau;
    if (Math.abs(dTau) < 1e-12) break;
  }

  const lat = Math.atan(tau) / RAD;
  const lon = Math.atan2(sinhEtaP, cosXiP) / RAD + centralMeridian(z.zone);
  return { lat, lon };
}
