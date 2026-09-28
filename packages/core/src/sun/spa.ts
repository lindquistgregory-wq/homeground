/**
 * NREL Solar Position Algorithm (Reda & Andreas, NREL/TP-560-34302, rev. 2008), on-device (§5.1).
 * Uncertainty ±0.0003° for years −2000..6000. Validated against the report's worked example in spa.test.ts.
 *
 * Azimuth convention: degrees clockwise from true north (navigational), as used everywhere in the app.
 */
import { B0, B1, L0, L1, L2, L3, L4, L5, NUT_ABCD, NUT_Y, R0, R1, R2, R3, R4 } from './spaTables';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const mod360 = (x: number) => ((x % 360) + 360) % 360;

export interface SolarPosition {
  /** Topocentric zenith angle including refraction, degrees. */
  zenith: number;
  /** Apparent elevation (90 − zenith), degrees. */
  elevation: number;
  /** Elevation without atmospheric refraction, degrees. */
  elevationGeometric: number;
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Equation of time, minutes. */
  equationOfTimeMin: number;
  /** Topocentric declination, degrees. */
  declination: number;
}

export interface SpaOptions {
  /** Observer elevation, metres. */
  elevationM?: number;
  /** Annual average local pressure, millibars. Default derived from elevation. */
  pressureMb?: number;
  /** Annual average local temperature, °C. */
  temperatureC?: number;
  /** TT − UT1, seconds. Default from the Espenak–Meeus polynomial for the date. */
  deltaT?: number;
  /** Atmospheric refraction at sunrise/sunset, degrees. */
  refraction?: number;
}

/** ΔT estimate (Espenak & Meeus 2006, as used by NASA eclipse predictions). Seconds. */
export function estimateDeltaT(year: number): number {
  if (year >= 2005 && year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (year >= 2050 && year < 2150) return -20 + 32 * ((year - 1820) / 100) ** 2 - 0.5628 * (2150 - year);
  if (year >= 1986 && year < 2005) {
    const t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u;
}

/** Standard-atmosphere pressure at an elevation, millibars. */
export function pressureAtElevation(m: number): number {
  return 1013.25 * (1 - 2.25577e-5 * m) ** 5.25588;
}

function termSum(table: ReadonlyArray<readonly number[]>, x: number): number {
  let s = 0;
  for (const r of table) s += r[0]! * Math.cos(r[1]! + r[2]! * x);
  return s;
}

export function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2440587.5;
}

/** Everything that depends only on time (not on the observer) — reusable across grid cells. */
export interface SunEphemeris {
  jd: number;
  /** Apparent sidereal time at Greenwich, degrees. */
  nu: number;
  /** Geocentric right ascension, degrees. */
  alpha: number;
  /** Geocentric declination, degrees. */
  delta: number;
  /** Earth radius vector, AU. */
  R: number;
  eotMin: number;
}

export function sunEphemeris(date: Date, deltaT = estimateDeltaT(date.getUTCFullYear() + date.getUTCMonth() / 12)): SunEphemeris {
  const jd = julianDay(date);
  const jde = jd + deltaT / 86400;
  const jc = (jd - 2451545) / 36525;
  const jce = (jde - 2451545) / 36525;
  const jme = jce / 10;

  const Lrad =
    (termSum(L0, jme) + termSum(L1, jme) * jme + termSum(L2, jme) * jme ** 2 + termSum(L3, jme) * jme ** 3 +
      termSum(L4, jme) * jme ** 4 + termSum(L5, jme) * jme ** 5) / 1e8;
  const L = mod360(Lrad * R2D);
  const B = ((termSum(B0, jme) + termSum(B1, jme) * jme) / 1e8) * R2D;
  const R =
    (termSum(R0, jme) + termSum(R1, jme) * jme + termSum(R2, jme) * jme ** 2 + termSum(R3, jme) * jme ** 3 +
      termSum(R4, jme) * jme ** 4) / 1e8;

  const theta = mod360(L + 180);
  const beta = -B;

  const x0 = 297.85036 + 445267.11148 * jce - 0.0019142 * jce ** 2 + jce ** 3 / 189474;
  const x1 = 357.52772 + 35999.05034 * jce - 0.0001603 * jce ** 2 - jce ** 3 / 300000;
  const x2 = 134.96298 + 477198.867398 * jce + 0.0086972 * jce ** 2 + jce ** 3 / 56250;
  const x3 = 93.27191 + 483202.017538 * jce - 0.0036825 * jce ** 2 + jce ** 3 / 327270;
  const x4 = 125.04452 - 1934.136261 * jce + 0.0020708 * jce ** 2 + jce ** 3 / 450000;
  let dPsi = 0, dEps = 0;
  for (let i = 0; i < NUT_Y.length; i++) {
    const y = NUT_Y[i]!, c = NUT_ABCD[i]!;
    const arg = (y[0]! * x0 + y[1]! * x1 + y[2]! * x2 + y[3]! * x3 + y[4]! * x4) * D2R;
    dPsi += (c[0]! + c[1]! * jce) * Math.sin(arg);
    dEps += (c[2]! + c[3]! * jce) * Math.cos(arg);
  }
  dPsi /= 36_000_000;
  dEps /= 36_000_000;

  const U = jme / 10;
  const e0 =
    84381.448 - 4680.93 * U - 1.55 * U ** 2 + 1999.25 * U ** 3 - 51.38 * U ** 4 - 249.67 * U ** 5 - 39.05 * U ** 6 +
    7.12 * U ** 7 + 27.87 * U ** 8 + 5.79 * U ** 9 + 2.45 * U ** 10;
  const eps = e0 / 3600 + dEps;
  const dTau = -20.4898 / (3600 * R);
  const lambda = theta + dPsi + dTau;

  const nu0 = mod360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * jc ** 2 - jc ** 3 / 38710000);
  const nu = nu0 + dPsi * Math.cos(eps * D2R);

  const lr = lambda * D2R, er = eps * D2R, br = beta * D2R;
  const alpha = mod360(Math.atan2(Math.sin(lr) * Math.cos(er) - Math.tan(br) * Math.sin(er), Math.cos(lr)) * R2D);
  const delta = Math.asin(Math.sin(br) * Math.cos(er) + Math.cos(br) * Math.sin(er) * Math.sin(lr)) * R2D;

  // Equation of time (SPA A.1)
  const M = 280.4664567 + 360007.6982779 * jme + 0.03032028 * jme ** 2 + jme ** 3 / 49931 - jme ** 4 / 15300 - jme ** 5 / 2000000;
  let E = 4 * (M - 0.0057183 - alpha + dPsi * Math.cos(er));
  E = ((E % 1440) + 1440) % 1440;
  if (E > 720) E -= 1440; // minutes, within ±20 in practice
  if (E < -720) E += 1440;

  return { jd, nu, alpha, delta, R, eotMin: E };
}

/** Observer-dependent part. Cheap enough to call per grid cell with a shared ephemeris. */
export function topocentric(eph: SunEphemeris, lat: number, lon: number, opts: SpaOptions = {}): SolarPosition {
  const elev = opts.elevationM ?? 0;
  const P = opts.pressureMb ?? pressureAtElevation(elev);
  const T = opts.temperatureC ?? 12;
  const refraction = opts.refraction ?? 0.5667;

  const H = mod360(eph.nu + lon - eph.alpha);
  const xi = 8.794 / (3600 * eph.R);
  const u = Math.atan(0.99664719 * Math.tan(lat * D2R));
  const x = Math.cos(u) + (elev / 6378140) * Math.cos(lat * D2R);
  const y = 0.99664719 * Math.sin(u) + (elev / 6378140) * Math.sin(lat * D2R);
  const xir = xi * D2R, Hr = H * D2R, dr = eph.delta * D2R;
  const dAlpha = Math.atan2(-x * Math.sin(xir) * Math.sin(Hr), Math.cos(dr) - x * Math.sin(xir) * Math.cos(Hr)) * R2D;
  const deltaP =
    Math.atan2((Math.sin(dr) - y * Math.sin(xir)) * Math.cos(dAlpha * D2R), Math.cos(dr) - x * Math.sin(xir) * Math.cos(Hr)) * R2D;
  const Hp = H - dAlpha;

  const latr = lat * D2R, dpr = deltaP * D2R, hpr = Hp * D2R;
  const e0 = Math.asin(Math.sin(latr) * Math.sin(dpr) + Math.cos(latr) * Math.cos(dpr) * Math.cos(hpr)) * R2D;
  const dE =
    e0 >= -1 * (0.26667 + refraction)
      ? (P / 1010) * (283 / (273 + T)) * (1.02 / (60 * Math.tan((e0 + 10.3 / (e0 + 5.11)) * D2R)))
      : 0;
  const e = e0 + dE;
  const gamma = mod360(Math.atan2(Math.sin(hpr), Math.cos(hpr) * Math.sin(latr) - Math.tan(dpr) * Math.cos(latr)) * R2D);
  return {
    zenith: 90 - e,
    elevation: e,
    elevationGeometric: e0,
    azimuth: mod360(gamma + 180),
    equationOfTimeMin: eph.eotMin,
    declination: deltaP,
  };
}

export function solarPosition(date: Date, lat: number, lon: number, opts: SpaOptions = {}): SolarPosition {
  return topocentric(sunEphemeris(date, opts.deltaT), lat, lon, opts);
}

// ---------------- Day-level helpers ----------------

export interface SunSample extends SolarPosition {
  time: Date;
}

/**
 * The solar day that contains the instant `when` at longitude `lon`, as the UTC-noon Date that the
 * day functions below expect. Use this for "today" and "now": the UTC calendar date is already
 * tomorrow on a US evening.
 */
export function solarDayOf(when: Date, lon: number): Date {
  const local = new Date(when.getTime() + (lon / 15) * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 12));
}

/** UTC instant of local *solar* noon for the calendar day containing `day` (approximate, ±1 min). */
export function approxSolarNoon(dayUtc: Date, lon: number): Date {
  const base = Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate(), 12);
  const eot = sunEphemeris(new Date(base)).eotMin;
  return new Date(base - (lon / 15) * 3_600_000 - eot * 60_000);
}

export interface SunTimes {
  sunrise: Date | null;
  solarNoon: Date;
  sunset: Date | null;
  /** 'polarDay' or 'polarNight' when the sun doesn't cross the horizon. */
  kind: 'normal' | 'polarDay' | 'polarNight';
  noonElevation: number;
}

/**
 * Sunrise/transit/sunset for the solar day around `day` at the given observer, found by bisection
 * on the apparent elevation of the sun's upper limb (−0.8333° incl. standard refraction) to ~1 s.
 */
export function sunTimes(day: Date, lat: number, lon: number, opts: SpaOptions = {}): SunTimes {
  const noonGuess = approxSolarNoon(day, lon);
  // Refine transit: minimise |hour angle| by golden-section on elevation.
  let a = noonGuess.getTime() - 3_600_000, b = noonGuess.getTime() + 3_600_000;
  const el = (t: number) => solarPosition(new Date(t), lat, lon, opts).elevationGeometric;
  for (let i = 0; i < 40; i++) {
    const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
    if (el(m1) > el(m2)) b = m2;
    else a = m1;
  }
  const noon = (a + b) / 2;
  const noonElevation = el(noon);
  const threshold = -0.8333;
  const f = (t: number) => el(t) - threshold;
  const root = (lo: number, hi: number) => {
    let flo = f(lo);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Math.sign(fm) === Math.sign(flo)) (lo = mid), (flo = fm);
      else hi = mid;
    }
    return new Date(Math.round((lo + hi) / 2));
  };
  const half = 12 * 3_600_000;
  if (f(noon) < 0) return { sunrise: null, sunset: null, solarNoon: new Date(noon), kind: 'polarNight', noonElevation };
  const upBefore = f(noon - half) > 0, upAfter = f(noon + half) > 0;
  if (upBefore && upAfter) return { sunrise: null, sunset: null, solarNoon: new Date(noon), kind: 'polarDay', noonElevation };
  // Near the polar circles one crossing can be missing on a given solar day; report it as null.
  return { sunrise: upBefore ? null : root(noon - half, noon), solarNoon: new Date(noon), sunset: upAfter ? null : root(noon, noon + half), kind: 'normal', noonElevation };
}

/**
 * Sun positions across the daylight of one solar day, every `stepMin` minutes, centred on each step.
 * Samples below the horizon are omitted. Used by the shade engine and the sun-path diagram.
 */
export function daySunSamples(day: Date, lat: number, lon: number, stepMin = 15, opts: SpaOptions = {}): SunSample[] {
  const noon = approxSolarNoon(day, lon).getTime();
  const out: SunSample[] = [];
  const step = stepMin * 60_000;
  for (let t = noon - 12 * 3_600_000 + step / 2; t < noon + 12 * 3_600_000; t += step) {
    const time = new Date(t);
    const p = solarPosition(time, lat, lon, opts);
    if (p.elevation > 0) out.push({ ...p, time });
  }
  return out;
}

/** Key dates for sun-path arcs (§5.1): solstices and equinoxes of the given year (approximate, ±1 day). */
export function keySunDates(year: number): Array<{ label: string; date: Date }> {
  return [
    { label: 'Winter solstice', date: new Date(Date.UTC(year, 11, 21, 12)) },
    { label: 'Spring equinox', date: new Date(Date.UTC(year, 2, 20, 12)) },
    { label: 'Summer solstice', date: new Date(Date.UTC(year, 5, 21, 12)) },
    { label: 'Fall equinox', date: new Date(Date.UTC(year, 8, 22, 12)) },
  ];
}
