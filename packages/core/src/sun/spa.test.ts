import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySunSamples, julianDay, solarPosition, sunEphemeris, sunTimes } from './spa';

const close = (a: number, b: number, tol: number, what: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: expected ${b} ± ${tol}, got ${a}`);

// NREL/TP-560-34302 worked example (Table A5.1): 17 Oct 2003 12:30:30 local (UTC−7), Golden CO.
const T = new Date(Date.UTC(2003, 9, 17, 19, 30, 30));
const EX = { lat: 39.742476, lon: -105.1786, elevationM: 1830.14, pressureMb: 820, temperatureC: 11, deltaT: 67, refraction: 0.5667 };

test('SPA reproduces the NREL report worked example', () => {
  close(julianDay(T), 2452930.312847, 1e-6, 'JD');
  const eph = sunEphemeris(T, EX.deltaT);
  close(eph.R, 0.9965422974, 1e-9, 'R');
  close(eph.alpha, 202.22741, 1e-4, 'geocentric right ascension');
  close(eph.delta, -9.31434, 1e-4, 'geocentric declination');
  const p = solarPosition(T, EX.lat, EX.lon, EX);
  close(p.zenith, 50.11162, 1e-4, 'topocentric zenith');
  close(p.azimuth, 194.34024, 1e-4, 'topocentric azimuth');
  close(p.declination, -9.316179, 1e-5, 'topocentric declination');
});

test('equation of time and sun times for the NREL example day', () => {
  // Report values for 2003-10-17: sunrise 06:12:43, transit 11:46:04, sunset 17:20:19 local (UTC−7).
  const t = sunTimes(T, EX.lat, EX.lon, EX);
  assert.equal(t.kind, 'normal');
  const local = (d: Date) => (d.getTime() - Date.UTC(2003, 9, 17, 7)) / 1000; // seconds after local midnight
  close(local(t.solarNoon), 11 * 3600 + 46 * 60 + 4, 20, 'transit');
  close(local(t.sunrise!), 6 * 3600 + 12 * 60 + 43, 90, 'sunrise');
  close(local(t.sunset!), 17 * 3600 + 20 * 60 + 19, 90, 'sunset');
  close(sunEphemeris(T, 67).eotMin, 14.64, 0.1, 'equation of time (minutes)');
});

test('noon altitude equals 90 − |lat − declination| at the equinox and solstice', () => {
  for (const [date, lat] of [[new Date(Date.UTC(2026, 5, 21, 17)), 42.25], [new Date(Date.UTC(2026, 11, 21, 17)), 42.25]] as const) {
    const t = sunTimes(date, lat, -73.98);
    const decl = solarPosition(t.solarNoon, lat, -73.98).declination;
    close(t.noonElevation, 90 - Math.abs(lat - decl), 0.02, 'noon elevation');
  }
});

test('polar night and midnight sun are detected', () => {
  assert.equal(sunTimes(new Date(Date.UTC(2026, 11, 21)), 78.2, 15.6).kind, 'polarNight');
  assert.equal(sunTimes(new Date(Date.UTC(2026, 5, 21)), 78.2, 15.6).kind, 'polarDay');
});

test('day samples cover daylight only, rising in the east and setting in the west', () => {
  const s = daySunSamples(new Date(Date.UTC(2026, 2, 20)), 42.25, -73.98, 15);
  assert.ok(s.length > 44 && s.length < 52, `${s.length} samples`);
  assert.ok(s.every((p) => p.elevation > 0));
  assert.ok(s[0]!.azimuth > 80 && s[0]!.azimuth < 100);
  assert.ok(s[s.length - 1]!.azimuth > 260 && s[s.length - 1]!.azimuth < 280);
});

test('solarDayOf: a US evening is still "today", not the next UTC day', async () => {
  const { solarDayOf, approxSolarNoon } = await import('./spa');
  // 18:30 PDT on 15 June = 01:30 UTC on 16 June; Sacramento, sun still ~21° up.
  const when = new Date(Date.UTC(2026, 5, 16, 1, 30));
  const day = solarDayOf(when, -121.49);
  assert.equal(day.getUTCDate(), 15);
  const noon = approxSolarNoon(day, -121.49);
  assert.ok(Math.abs(+noon - +when) < 8 * 3_600_000, 'solar noon is the same afternoon');
  const p = solarPosition(when, 38.58, -121.49);
  assert.ok(p.elevation > 15);
});

test('near the polar circle a missing crossing is null, never reported as noon', () => {
  for (let doy = 170; doy <= 200; doy++) {
    const d = new Date(Date.UTC(2026, 0, doy, 12));
    const st = sunTimes(d, 66.8, -162.6);
    if (st.sunrise) assert.ok(Math.abs(+st.sunrise - +st.solarNoon) > 3_600_000, `day ${doy}: sunrise equals noon`);
    if (st.sunset) assert.ok(Math.abs(+st.sunset - +st.solarNoon) > 3_600_000, `day ${doy}: sunset equals noon`);
  }
});
