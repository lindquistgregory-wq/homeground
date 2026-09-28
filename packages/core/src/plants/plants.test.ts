import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNormalsRow, mmddToDoy, formatDoy } from '../climate/normals';
import { estimateFrostDates } from '../climate/frost';
import { makeGrid, rasterizePolygon } from '../raster/grid';
import { Material, burnObstacle, emptySurface, prepareSamples, sunHours } from '../sun/shade';
import { daySunSamples } from '../sun/spa';
import {
  PLANTS, annualGdd, chillHours, climateCurves, dailyMean, dayGddReached, evalHarmonic, estimateYieldLb, firstDayAtLeast, fitHarmonic,
  hourlyTemp, layoutBed, modeledSoilF, peakSummerMax, plantById, plantCalendar, rankPlants, rotationAdvice, scorePlant, searchPlants,
  shadeHeightM, weatherAlerts, zoneNumber,
} from './index';

// Real NOAA 1991–2020 normals for Albany Intl AP (USW00014735), retrieved 2026-09-28.
const ALBANY = parseNormalsRow({
  STATION: 'USW00014735', NAME: 'ALBANY INTERNATIONAL AIRPORT, NY US', LATITUDE: '42.7431', LONGITUDE: '-73.8092', ELEVATION: '85.6',
  'ANN-TMIN-PRBLST-T32FP10': '05/11', 'ANN-TMIN-PRBLST-T32FP50': '04/27', 'ANN-TMIN-PRBLST-T32FP90': '04/16',
  'ANN-TMIN-PRBFST-T32FP10': '10/03', 'ANN-TMIN-PRBFST-T32FP50': '10/15', 'ANN-TMIN-PRBFST-T32FP90': '11/01',
  'ANN-TMIN-PRBLST-T28FP10': '04/28', 'ANN-TMIN-PRBLST-T28FP50': '04/16', 'ANN-TMIN-PRBLST-T28FP90': '04/03',
  'ANN-TMIN-PRBFST-T28FP10': '10/11', 'ANN-TMIN-PRBFST-T28FP50': '10/28', 'ANN-TMIN-PRBFST-T28FP90': '11/10',
  'DJF-TMIN-NORMAL': '18.7', 'MAM-TMIN-NORMAL': '37.0', 'JJA-TMIN-NORMAL': '60.1', 'SON-TMIN-NORMAL': '41.8', 'ANN-TMIN-NORMAL': '39.4',
  'DJF-TMAX-NORMAL': '35.7', 'MAM-TMAX-NORMAL': '58.6', 'JJA-TMAX-NORMAL': '81.8', 'SON-TMAX-NORMAL': '61.8', 'ANN-TMAX-NORMAL': '59.4',
  'ANN-GRDD-BASE50': '2886.3',
})!;
const FROST = estimateFrostDates({ lat: 42.75, lon: -73.8, elevationM: 85.6 }, [ALBANY])!.dates;
const CURVES = climateCurves(ALBANY, 85.6)!;
const p = (id: string) => plantById(id)!;

test('plant database integrity', () => {
  const ids = new Set<string>();
  for (const pl of PLANTS) {
    assert.ok(!ids.has(pl.id), `duplicate id ${pl.id}`);
    ids.add(pl.id);
  }
  assert.ok(PLANTS.length >= 70, `only ${PLANTS.length} plants`);
  for (const pl of PLANTS) {
    const where = pl.id;
    assert.ok(pl.sunHours.min <= pl.sunHours.ideal, `${where} sun`);
    assert.ok(pl.soil.pH[0] < pl.soil.pH[1] && pl.soil.pH[0] >= 4 && pl.soil.pH[1] <= 8.5, `${where} pH`);
    if (pl.daysToMaturity) assert.ok(pl.daysToMaturity[0] <= pl.daysToMaturity[1], `${where} DTM order`);
    if (pl.sowing.indoorStartWeeks) assert.ok(pl.sowing.indoorStartWeeks[0] >= pl.sowing.indoorStartWeeks[1], `${where} indoor weeks are [earliest, latest]`);
    if (pl.germination) assert.ok(pl.germination.minSoilF <= pl.germination.optimalF[0], `${where} germination`);
    if (pl.lifecycle === 'perennial' && pl.kind !== 'vegetable' && pl.kind !== 'herb') assert.ok(pl.zones, `${where} perennial needs zones`);
    if (pl.kind === 'fruit-tree' && pl.id !== 'fig') assert.ok(pl.chillHours, `${where} fruit tree needs chill hours`);
    for (const c of [...(pl.companions ?? []), ...(pl.avoidNear ?? [])]) assert.ok(PLANTS.some((q) => q.id === c), `${where} references unknown ${c}`);
    assert.ok(pl.spacingIn.inRow > 0 && pl.spacingIn.betweenRows >= pl.spacingIn.inRow * 0.5, `${where} spacing`);
  }
  assert.equal(searchPlants('brassica').length > 5, true);
  assert.equal(searchPlants('TOMATO')[0]!.id, 'tomato');
});

test('annual temperature curve reproduces Albany seasonal normals', () => {
  // Seasonal means are averages over each 3-month season, so a sinusoid through the centres is close but not exact.
  assert.ok(Math.abs(evalHarmonic(CURVES.tmax, 196) - 81.8) < 3, 'midsummer max');
  assert.ok(Math.abs(evalHarmonic(CURVES.tmin, 15) - 18.7) < 3, 'midwinter min');
  const h = fitHarmonic([[0, 10], [91.25, 20], [182.5, 10], [273.75, 0]]);
  assert.ok(Math.abs(h.mean - 10) < 1e-9 && Math.abs(h.b - 10) < 1e-6);
  assert.ok(dailyMean(CURVES, 196) > dailyMean(CURVES, 15) + 40);
});

test('GDD is calibrated to the station and soil warms in late spring', () => {
  assert.ok(Math.abs(annualGdd(CURVES, 50) - 2886.3) / 2886.3 < 0.01, `annual GDD ${annualGdd(CURVES, 50)}`);
  const soil60 = firstDayAtLeast((d) => modeledSoilF(CURVES, d), 60)!;
  assert.ok(soil60 > mmddToDoy('05/10')! && soil60 < mmddToDoy('06/10')!, `soil 60 °F on ${formatDoy(soil60)}`);
  const corn = dayGddReached(CURVES, mmddToDoy('05/20')!, 1500)!;
  assert.ok(corn > mmddToDoy('07/25')! && corn < mmddToDoy('08/31')!, `corn 1500 GDD on ${formatDoy(corn)}`);
  assert.ok(peakSummerMax(CURVES) > 78 && peakSummerMax(CURVES) < 86);
});

test('diurnal cycle and chill hours', () => {
  assert.equal(hourlyTemp(30, 50, 6), 30);
  assert.equal(hourlyTemp(30, 50, 15), 50);
  assert.ok(Math.abs(hourlyTemp(30, 50, 5) - 30) < 1 && hourlyTemp(30, 50, 0) > 30);
  const albany = chillHours(CURVES);
  assert.ok(albany > 400 && albany < 2000, `Albany chill ${albany}`);
  const tropical = climateCurves({ ...ALBANY, tminF: { DJF: 55, MAM: 65, JJA: 75, SON: 68 }, tmaxF: { DJF: 75, MAM: 84, JJA: 91, SON: 85 }, gddBase50F: undefined }, 85.6)!;
  assert.ok(chillHours(tropical) < 50, `tropical chill ${chillHours(tropical)}`);
});

test('elevation lowers the parcel curves by the lapse rate', () => {
  const high = climateCurves(ALBANY, 85.6 + 500)!;
  assert.ok(Math.abs(high.elevationOffsetF - -5.85) < 0.01);
  assert.ok(dailyMean(high, 196) < dailyMean(CURVES, 196) - 5);
});

test('tomato calendar in Albany (cautious): starts indoors in March, out after soil warms', () => {
  const cal = plantCalendar(p('tomato'), { frost: FROST, curves: CURVES });
  const ev = (k: string) => cal.events.find((e) => e.kind === k)!;
  // Seeds start 8–6 weeks before the transplant window opens, whatever delayed it.
  assert.equal(ev('start-indoors').start, ev('transplant').start - 56);
  assert.equal(ev('start-indoors').end, ev('transplant').start - 42);
  assert.ok(ev('start-indoors').start >= mmddToDoy('03/15')! && ev('start-indoors').start <= mmddToDoy('04/15')!, formatDoy(ev('start-indoors').start));
  assert.ok(ev('transplant').start >= mmddToDoy('05/11')!, 'never before the 1-in-10 late frost');
  assert.match(ev('transplant').basis, /median last frost/);
  assert.match(ev('transplant').basis, /soil 60 °F/);
  assert.ok(ev('transplant').end - ev('transplant').start >= 14, 'a soil delay shifts the window instead of squeezing it');
  assert.ok(ev('harden-off').end < ev('transplant').start);
  assert.ok(ev('harvest').start > ev('transplant').start + 50);
  assert.ok(ev('harvest').end <= FROST.firstFall[32][50]!, 'tender harvest ends at the first frost');
  assert.equal(cal.fits, true);
});

test('cool-season, fall and perennial timing', () => {
  const pea = plantCalendar(p('pea'), { frost: FROST, curves: CURVES });
  const sowPea = pea.events.find((e) => e.kind === 'direct-sow')!;
  assert.ok(sowPea.start < FROST.lastSpring[32][50]!, 'peas go in before the last frost');
  assert.ok(pea.events.some((e) => e.kind === 'fall-sow'));
  const garlic = plantCalendar(p('garlic'), { frost: FROST });
  const g = garlic.events.find((e) => e.label === 'Plant cloves')!;
  assert.ok(g.start >= FROST.firstFall[32][50]! && g.end <= FROST.firstFall[32][50]! + 28, 'garlic: first frost to 4 weeks after');
  const lettuce = plantCalendar(p('lettuce'), { frost: FROST, curves: CURVES });
  const succ = lettuce.events.find((e) => e.kind === 'succession')!;
  assert.ok(succ.end <= FROST.firstFall[32][50]! + 14 - 30, 'last succession still matures before hard frost');
  for (const cal of PLANTS.map((pl) => plantCalendar(pl, { frost: FROST, curves: CURVES }))) {
    const planted = cal.events.find((e) => e.kind === 'transplant' || e.kind === 'direct-sow' || e.kind === 'plant');
    const harvest = cal.events.find((e) => e.kind === 'harvest');
    if (planted && harvest) assert.ok(harvest.start >= planted.start + 14, `${cal.plantId}: harvest before planting`);
  }
});

test('short seasons flag crops that cannot mature', () => {
  const short = { ...FROST, lastSpring: { ...FROST.lastSpring, 32: { 10: 160, 50: 155, 90: 150 } }, firstFall: { ...FROST.firstFall, 32: { 10: 210, 50: 215, 90: 220 } }, freezeFreeDays: 60 };
  const cal = plantCalendar(p('watermelon'), { frost: short });
  assert.equal(cal.fits, false);
  assert.ok(cal.warnings.some((w) => /frost-free days/.test(w)));
  const s = scorePlant(p('watermelon'), { frost: short }, { sunHours: 10 });
  assert.equal(s.verdict, 'not-suitable');
});

test('suitability: explainable factors, hard fails and sun', () => {
  const site = { zone: '6a', frost: FROST, curves: CURVES, chillHours: chillHours(CURVES), peakSummerMaxF: peakSummerMax(CURVES), summerRhPct: 72 };
  const good = scorePlant(p('tomato'), site, { sunHours: 8.5, soil: { pH: 6.5, drainageClass: 'Well drained', texture: 'Silt loam' } }, undefined, 'Bed 1');
  assert.ok(good.verdict === 'great' || good.verdict === 'good', `${good.verdict} ${good.score}`);
  const shady = scorePlant(p('tomato'), site, { sunHours: 5.2, soil: { pH: 6.5 } }, undefined, 'Bed 3');
  assert.ok(shady.score < good.score);
  assert.match(shady.summary, /5\.2 sun-hours in Bed 3 vs 6–8/);
  const peach = scorePlant(p('peach'), { ...site, zone: '4b' }, { sunHours: 9 });
  assert.equal(peach.verdict, 'not-suitable');
  assert.match(peach.hardFails[0]!, /colder than/);
  const blue = scorePlant(p('blueberry'), site, { sunHours: 8, soil: { pH: 7.2 } });
  assert.match(blue.factors.find((f) => f.key === 'soilPh')!.detail, /sulfur/);
  const wet = scorePlant(p('carrot'), site, { sunHours: 7, soil: { drainageClass: 'Poorly drained' } });
  assert.equal(wet.factors.find((f) => f.key === 'drainage')!.status, 'warn');
  const raised = scorePlant(p('carrot'), site, { sunHours: 7, raised: true, soil: { drainageClass: 'Poorly drained' } });
  assert.equal(raised.factors.find((f) => f.key === 'drainage')!.score, 1);
  const lowChill = scorePlant(p('apple'), { ...site, chillHours: 150 }, { sunHours: 9 });
  assert.equal(lowChill.verdict, 'not-suitable');
  assert.equal(zoneNumber('6b'), 6.5);
  const ranked = rankPlants([p('lettuce'), p('watermelon'), p('tomato')], site, { sunHours: 4.5 });
  assert.equal(ranked[0]!.plantId, 'lettuce', 'lettuce wins a part-shade bed');
});

test('§14 acceptance: a 10 ft shed south of a bed lowers its December sun and the full-sun score, with a reason', () => {
  const g = makeGrid({ width: 40, height: 40, cell: 0.5, x0: 580000, y0: 4680000, zone: { zone: 18, hemisphere: 'N' } }, 100);
  const bed = rasterizePolygon(g, [[[580008, 4679990], [580012, 4679990], [580012, 4679988.8], [580008, 4679988.8], [580008, 4679990]]]);
  const samples = prepareSamples(daySunSamples(new Date(Date.UTC(2026, 11, 21, 12)), 42.75, -73.8, 15), { sampleHours: 0.25 });
  const avg = (s: ReturnType<typeof emptySurface>) => {
    const out = sunHours(s, samples, { sampleHours: 0.25 });
    let sum = 0, n = 0;
    for (let k = 0; k < bed.data.length; k++) if (bed.data[k]) (sum += out.data[k]!), n++;
    return sum / n;
  };
  const open = avg(emptySurface(g));
  const withShed = emptySurface(g);
  burnObstacle(withShed, rasterizePolygon(g, [[[580007, 4679987], [580013, 4679987], [580013, 4679984], [580007, 4679984], [580007, 4679987]]]), 3.048, Material.opaque);
  const shaded = avg(withShed);
  assert.ok(shaded < open - 1, `December sun ${open.toFixed(1)} h → ${shaded.toFixed(1)} h`);
  const before = scorePlant(p('tomato'), {}, { sunHours: open });
  const after = scorePlant(p('tomato'), {}, { sunHours: shaded }, undefined, 'Bed 1');
  assert.ok(after.score < before.score);
  assert.match(after.factors.find((f) => f.key === 'sun')!.detail, /sun-hours in Bed 1/);
});

test('rotation, layout, yield, tall crops', () => {
  const hist = [{ plantId: 'potato', family: 'Solanaceae', year: 2026 }];
  assert.equal(rotationAdvice(p('tomato'), hist, 2027).ok, false);
  assert.match(rotationAdvice(p('tomato'), hist, 2027).message, /last year/);
  assert.equal(rotationAdvice(p('tomato'), hist, 2030).ok, true);
  assert.match(rotationAdvice(p('corn'), [{ plantId: 'pea', family: 'Fabaceae', year: 2026 }], 2027).message, /nitrogen/);
  const tom = layoutBed(p('tomato'), 1.2, 2.4);
  assert.equal(tom.method, 'rows');
  assert.equal(tom.plantCount, 3);
  const lettuce = layoutBed(p('lettuce'), 1.2, 2.4);
  assert.equal(lettuce.method, 'square-foot');
  assert.equal(lettuce.plantCount, 3 * 7 * 4);
  assert.equal(lettuce.positions.length, lettuce.plantCount);
  const peas = layoutBed(p('pea'), 1.2, 2.4);
  assert.equal(peas.positions.length, peas.plantCount);
  const y = estimateYieldLb(p('tomato'), tom)!;
  assert.ok(y[0] > 0 && y[1] > y[0]);
  assert.ok(shadeHeightM(p('corn'))! > 2);
  assert.equal(shadeHeightM(p('lettuce')), null);
});

test('weather alerts name only the crops at risk', () => {
  const crops = [
    { plantingId: 't', plant: p('tomato'), bedName: 'Bed 1' },
    { plantingId: 'k', plant: p('kale'), bedName: 'Bed 2' },
    { plantingId: 'c', plant: p('corn'), bedName: 'Bed 3' },
  ];
  const alerts = weatherAlerts([
    { start: '2027-05-10T20:00:00-04:00', end: '2027-05-11T06:00:00-04:00', isNight: true, temperatureF: 34 },
    { start: '2027-07-20T06:00:00-04:00', end: '2027-07-20T18:00:00-04:00', isNight: false, temperatureF: 97, windMph: 35 },
  ], crops);
  const frost = alerts.find((a) => a.kind === 'frost')!;
  assert.deepEqual(frost.plantingIds.sort(), ['c', 't']);
  assert.ok(!frost.body.includes('Kale'));
  assert.ok(alerts.some((a) => a.kind === 'heat' && a.plantingIds.includes('t')));
  assert.ok(alerts.some((a) => a.kind === 'wind' && a.plantingIds.includes('c')));
});

test('transplanted seed-counted crops get credit for their indoor weeks; typical mode uses the median', () => {
  const cuke = plantCalendar(p('cucumber'), { frost: FROST, curves: CURVES });
  const t = cuke.events.find((e) => e.kind === 'transplant')!;
  const h = cuke.events.find((e) => e.kind === 'harvest')!;
  // 50–70 days from seed, 2–4 weeks of that indoors → first harvest ~29 days after transplanting.
  assert.equal(h.start - t.start, 50 - 21);
  assert.match(h.basis, /already indoors/);
  const typical = plantCalendar(p('tomato'), { frost: FROST, risk: 'typical' });
  assert.equal(typical.events.find((e) => e.kind === 'transplant')!.start, FROST.lastSpring[32][50]! + 7);
});
