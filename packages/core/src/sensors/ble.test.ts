/**
 * BLE decoder tests. Vectors are real advertisement payloads from the reference projects' test suites
 * and specs (see docs/SENSORS.md for sources and licences); expected values are the ones those sources
 * assert, except the pvvx samples marked "derived".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeAdvertisement, decodeAtc, decodeBthomeV1, decodeBthomeV2, decodeGovee, decodeInkbird, decodeMiBeacon, decodeQingping, decodeRuuvi, decodeSwitchbot,
  shortUuid, type DecodedAdvert,
} from './ble';
import { hexToBytes as h } from './crypto';

const near = (a: number | undefined, b: number, tol = 0.006) => assert.ok(a !== undefined && Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
function vals(d: DecodedAdvert | null, expected: Record<string, number>) {
  assert.ok(d, 'decoded');
  for (const [k, v] of Object.entries(expected)) near((d.values as Record<string, number>)[k], v);
}

// ---------------- BTHome ----------------

test('BTHome v2 plain objects', () => {
  vals(decodeBthomeV2(h('4002ca0903bf13')), { temperature: 25.06, humidity: 50.55 });
  const d = decodeBthomeV2(h('400009015d025d0903b718'))!;
  vals(d, { battery: 93, temperature: 23.97, humidity: 63.27 });
  assert.equal(d.counter, 9);
  vals(decodeBthomeV2(h('4004138a01')), { pressure: 1008.83 });
  vals(decodeBthomeV2(h('4005138a14')), { illuminance: 13460.67 });
  vals(decodeBthomeV2(h('4008ca06')), { dewPoint: 17.38 });
  vals(decodeBthomeV2(h('4014020c')), { soilMoisture: 30.74 });
  vals(decodeBthomeV2(h('40451101')), { temperature: 27.3 });
  vals(decodeBthomeV2(h('404632')), { uvIndex: 5.0 });
  vals(decodeBthomeV2(h('4056e803')), { conductivity: 1000 });
  vals(decodeBthomeV2(h('4057ea')), { temperature: -22 });
  vals(decodeBthomeV2(h('405e3f755f11d5')), { windDirection: 300.15, rainTotal: 5454.5 });
  vals(decodeBthomeV2(h('40002e01641e012e34451601')), { battery: 100, humidity: 52, temperature: 27.8 });
});

test('BTHome v2 repeated objects become channels; unknown ids stop parsing; text is skipped', () => {
  const d = decodeBthomeV2(h('4002ca0902cf0902cf0803b71803b717015d'))!;
  vals(d, { temperature: 25.06, humidity: 63.27, battery: 93 });
  near(d.channels?.['2']?.temperature, 25.11);
  near(d.channels?.['3']?.temperature, 22.55);
  near(d.channels?.['2']?.humidity, 60.71);
  assert.deepEqual(decodeBthomeV2(h('40feca09'))!.values, {});
  assert.deepEqual(decodeBthomeV2(h('40015dfe5d0903b718'))!.values, { battery: 93 });
  assert.deepEqual(decodeBthomeV2(h('44530c48656c6c6f20576f726c6421'))!.values, {});
  const withMac = decodeBthomeV2(h('42b2188d38c1a404138a01'))!;
  assert.equal(withMac.mac, 'A4:C1:38:8D:18:B2');
  vals(withMac, { pressure: 1008.83 });
  assert.equal(decodeBthomeV2(h('2002ca09')), null, 'wrong version');
});

test('BTHome v2 encryption with the bindkey (bthome.io and bthome-ble vectors)', () => {
  const key = h('231d39c1d7cc1ab1aee224cd096db932'), mac = '54:48:E6:8F:80:A5';
  const spec = decodeBthomeV2(h('41e445f3c9962b332211006c7c4519'), { key, mac })!;
  assert.equal(spec.encrypted, true);
  assert.equal(spec.counter, 1122867);
  vals(spec, { temperature: 25.06, humidity: 50.55 });
  vals(decodeBthomeV2(h('41a47266c95f730011223378237214'), { key, mac }), { temperature: 25.06, humidity: 50.55 });
  // MAC carried in the payload: no MAC option needed.
  vals(decodeBthomeV2(h('43a5808fe64854f196c06ffb4900112233f08ecbde'), { key }), { temperature: 25.06, humidity: 50.55 });
  // Wrong key or no key: flagged, no values.
  const wrong = decodeBthomeV2(h('41a47266c95f730011223378237214'), { key: h('00'.repeat(16)), mac })!;
  assert.equal(wrong.needsKey, true);
  assert.deepEqual(wrong.values, {});
  assert.equal(decodeBthomeV2(h('41a47266c95f730011223378237214'))!.needsKey, true);
  // pvvx firmware sample [derived], through the dispatcher with a 128-bit UUID key.
  const adv = { id: 'x', serviceData: { '0000fcd2-0000-1000-8000-00805f9b34fb': h('4195b0efda789dd953b02600009341626f') } };
  vals(decodeAdvertisement(adv, { key: h('aa'.repeat(16)), mac: 'A4:C1:38:AA:BB:CC' }), { battery: 80, temperature: 19.2, humidity: 62.22 });
});

test('BTHome v1 plain and encrypted', () => {
  vals(decodeBthomeV1(h('2302ca090303bf13'), false), { temperature: 25.06, humidity: 50.55 });
  vals(decodeBthomeV1(h('0314020c'), false), { soilMoisture: 30.74 });
  vals(decodeBthomeV1(h('fba435e4d3c312fb0011223357d90a99'), true, { key: h('231d39c1d7cc1ab1aee224cd096db932'), mac: '54:48:E6:8F:80:A5' }), { temperature: 25.06, humidity: 50.55 });
});

// ---------------- Govee ----------------

test('Govee packed format (H5075 family, H5100 family), int16 formats, iBeacon merge, errors', () => {
  vals(decodeGovee(0xec88, h('000341c264004c000215494e54454c4c495f524f434b535f48575075f2ff0c'), 'GVH5075_2762'), { temperature: 21.3, humidity: 44.2, battery: 100 });
  vals(decodeGovee(0xec88, h('00034db26400'), 'GVH5075_DBF8'), { temperature: 21.6, humidity: 49.8, battery: 100 });
  vals(decodeGovee(0xec88, h('00030fc93500'), 'GVH5075_2762'), { temperature: 20.0, humidity: 64.9, battery: 53 });
  const err = decodeGovee(0xec88, h('00bc00043e27'), '')!;
  assert.ok(err.error);
  assert.equal(err.values.temperature, undefined);
  assert.equal(err.values.battery, 62);
  vals(decodeGovee(0xec88, h('00e609bc126402'), 'Govee_H5074_5FF4'), { temperature: 25.34, humidity: 47.96, battery: 100 });
  const h5051 = decodeGovee(0xec88, h('00ba0af90f63020101'), '')!;
  assert.equal(h5051.model, 'H5051');
  vals(h5051, { temperature: 27.46, humidity: 40.89, battery: 99 });
  vals(decodeGovee(0xec88, h('001c01a7143b000002'), 'Govee_H5052_E81B'), { temperature: 2.84, humidity: 52.87, battery: 59 });
  vals(decodeGovee(0x8801, h('ec0001010a0aa40664'), 'Govee_H5179_3CD5'), { temperature: 25.7, humidity: 17.0, battery: 100 });
  vals(decodeGovee(0x0001, h('010103465464'), 'GVH5100_7738'), { temperature: 21.4, humidity: 61.2, battery: 100 });
  vals(decodeGovee(0x0001, h('010103513e644c000215494e54454c4c495f524f434b535f48575075f2ff0c'), 'GVH5103_5A4E'), { temperature: 21.7, humidity: 40.6 });
  vals(decodeGovee(0x0001, h('010103c730640000'), 'GV51085242'), { temperature: 24.7, humidity: 60.0, battery: 100 });
  assert.ok(decodeGovee(0x0001, h('010103c730e40000'), 'GV51085242')!.error);
  vals(decodeGovee(0x0001, h('0101038efe64'), 'GVH5110_2EC8'), { temperature: 23.3, humidity: 21.4 });
  const remote = decodeGovee(0x0001, h('010101002af7640003'), 'B51782BC8')!;
  near(remote.channels?.remote?.temperature, 1.0);
  near(remote.channels?.remote?.humidity, 99.9);
  vals(decodeGovee(0x0001, h('010100002af7640003'), 'B51782BC8'), { temperature: 1.0, humidity: 99.9, battery: 100 });
  vals(decodeGovee(0x0001, h('0101033dee023e00'), 'GV5140303A'), { temperature: 21.2, humidity: 46.2, co2: 574 });
  vals(decodeGovee(0x0001, h('0101033d70640041'), 'GV5112AC3D'), { temperature: 21.2, humidity: 33.6, battery: 100 });
  // 0x0001 is Nokia's id: without a Govee name it's ignored.
  assert.equal(decodeGovee(0x0001, h('010103465464'), 'SomethingElse'), null);
  // Through the dispatcher (company id included in the raw bytes).
  vals(decodeAdvertisement({ id: 'x', name: 'GVH5075_DBF8', manufacturerData: h('88ec00034db26400') }), { temperature: 21.6 });
});

// ---------------- SwitchBot ----------------

test('SwitchBot meters (service data + manufacturer data)', () => {
  vals(decodeSwitchbot(h('5400e4069835'), undefined), { battery: 100, temperature: 24.6, humidity: 53 });
  const both = decodeSwitchbot(h('5400e4069835'), h('d7c17d5deb43de03069835'))!;
  vals(both, { battery: 100, temperature: 24.6, humidity: 53 });
  assert.equal(both.mac, 'D7:C1:7D:5D:EB:43');
  vals(decodeSwitchbot(undefined, h('d7c17d5deb43de03069835'), { modelHint: 'Meter' }), { temperature: 24.6, humidity: 53 });
  assert.equal(decodeSwitchbot(undefined, h('d7c17d5deb43de03069835')), null, 'no model: could be a bot or curtain');
  const outdoor = decodeSwitchbot(h('7700e4'), h('aabbccddeeffe00f06983500'))!;
  assert.equal(outdoor.model, 'Indoor/Outdoor Meter');
  vals(outdoor, { battery: 100, temperature: 24.6, humidity: 53 });
  vals(decodeSwitchbot(h('340064'), h('b0e9fe52dd84066408972c0005')), { battery: 100, temperature: 23.8, humidity: 44 });
  vals(decodeSwitchbot(h('350064'), h('b0e9fe543215b7e4079ba4003702d500')), { temperature: 27.7, humidity: 36, co2: 725 });
  const hub = decodeSwitchbot(h('7600'), h('aabbccddeeff00ff66541af182079a3200'))!;
  vals(hub, { temperature: 26.7, humidity: 50, illuminance: 10 });
  assert.equal(decodeSwitchbot(h('540000000000'), undefined), null);
  const viaDispatch = decodeAdvertisement({ id: 'x', serviceData: { fd3d: h('5400e4069835') }, manufacturerData: h('6909d7c17d5deb43de03069835') });
  vals(viaDispatch, { temperature: 24.6, battery: 100 });
});

// ---------------- Xiaomi ----------------

test('Xiaomi MiBeacon plain frames, including MiFlora one-object-per-packet', () => {
  vals(decodeMiBeacon(h('5020aa01a3bf2e3b342d580d1004b40095020a10013b')), { temperature: 18.0, humidity: 66.1, battery: 59 });
  const lyw = decodeMiBeacon(h('50305b05034c94b438c1a40d10041001ea01'))!;
  assert.equal(lyw.model, 'LYWSD03MMC');
  assert.equal(lyw.mac, 'A4:C1:38:B4:94:4C');
  vals(lyw, { temperature: 27.2, humidity: 49.0 });
  vals(decodeMiBeacon(h('7120980012f34f6b8d7cc40d041002c400')), { temperature: 19.6 });
  vals(decodeMiBeacon(h('71209800667a3e6a8d7cc40d071003000000')), { illuminance: 0 });
  vals(decodeMiBeacon(h('71209800687a3e6a8d7cc40d0910025702')), { conductivity: 599 });
  vals(decodeMiBeacon(h('71209800477a3e6a8d7cc40d08100140')), { soilMoisture: 64 });
  vals(decodeMiBeacon(h('71205d01015d01008d7cc40d081001400910025702')), { soilMoisture: 64, conductivity: 599 });
  vals(decodeMiBeacon(h('7120bc03cd3e596d8d7cc40d0410023c01')), { temperature: 31.6 });
});

test('Xiaomi MiBeacon v4/v5 and v3-legacy encryption', () => {
  vals(decodeMiBeacon(h('5858480b685f12342d585a0b1841e2aa000e00a4964fb5'), { key: h('814aac74c4f17b6c1581e1ab87816b99') }), { humidity: 59.6 });
  vals(decodeMiBeacon(h('58586f0607892012342d585f176dd54f0200002fa453fa'), { key: h('a3bfe9853dd85a620debe3620caaa351') }), { temperature: 22.6 });
  vals(decodeMiBeacon(h('58585b0550f4830238c1a495ef58763c26000097e2abb5'), { key: h('e9ea895fac7cca6d30532432a516f3a8') }), { humidity: 46.7 });
  // No MAC in the frame: needs the MAC the user entered (iOS hides it).
  const noMac = h('4859b5553a8699bda053448f1200005b046d6a'), k6 = h('4d8f1373fb4d3bab557d0ebd1c78f8c4');
  assert.equal(decodeMiBeacon(noMac, { key: k6 })!.needsKey, true);
  vals(decodeMiBeacon(noMac, { key: k6, mac: 'A4:C1:38:80:15:07' }), { temperature: 25.2 });
  vals(decodeMiBeacon(h('4858422529202d8c7a76b756a82a0078b8224e'), { key: h('19b1c678ab0a8bc3dc77765f059188d4'), mac: 'A4:C1:38:0E:FD:78' }), { temperature: 26.1 });
  // Wrong key fails the MIC.
  assert.equal(decodeMiBeacon(h('58586f0607892012342d585f176dd54f0200002fa453fa'), { key: h('00'.repeat(16)) })!.needsKey, true);
  // v3 legacy (12-byte key, no MIC): YLKG07YL dimmer; decrypts to a button event we don't store, so values are empty but well-formed.
  const legacy = decodeMiBeacon(h('5830b603d28b98c54124f8c3491476757e00000099'), { key: h('b853075158487ca39a5b5ea9') })!;
  assert.equal(legacy.encrypted, true);
  assert.equal(legacy.needsKey, undefined);
  assert.deepEqual(legacy.values, {});
  // pvvx "Mi-like" encrypted sample [derived].
  vals(decodeMiBeacon(h('58585b05f4ccbbaa38c1a413df92a81cb30000acc46fda'), { key: h('aa'.repeat(16)) }), { temperature: 19.0 });
});

test('ATC1441 and pvvx custom firmware (0x181A) [derived vectors]', () => {
  const atc = decodeAtc(h('a4c138aabbcc00ce33430a6ec3'))!;
  assert.equal(atc.mac, 'A4:C1:38:AA:BB:CC');
  vals(atc, { temperature: 20.6, humidity: 51, battery: 67, voltage: 2.67 });
  vals(decodeAtc(h('ccbbaa38c1a46c07fa13d60a52090f')), { temperature: 19.0, humidity: 51.14, voltage: 2.774, battery: 82 });
  const opts = { key: h('aa'.repeat(16)), mac: 'A4:C1:38:AA:BB:CC' };
  vals(decodeAtc(h('bd86c53ffab900c1515859'), opts), { temperature: 19.0, humidity: 51.13, battery: 81 });
  vals(decodeAtc(h('bde9b75db856f303'), opts), { temperature: 19.0, humidity: 25.0, battery: 86 });
});

// ---------------- Qingping, Inkbird, Ruuvi ----------------

test('Qingping (0xFDCD)', () => {
  const d = decodeQingping(h('0816a72514342d580104d800bb01020164'))!;
  assert.equal(d.model, 'CGG1');
  assert.equal(d.mac, '58:2D:34:14:25:A7');
  vals(d, { temperature: 21.6, humidity: 44.3, battery: 100 });
  vals(decodeQingping(h('8818072240342d5801041801cd0002016107027327')), { temperature: 28.0, humidity: 20.5, battery: 97, pressure: 1009.9 });
  vals(decodeQingping(h('0a5d931d86342d5801041701ce010201641302b302')), { temperature: 27.9, co2: 691 });
});

test('Inkbird (pseudo company id is the temperature)', () => {
  vals(decodeInkbird(h('fc07c71200c83d5606'), 'sps'), { temperature: 20.44, humidity: 48.07, battery: 86 });
  vals(decodeInkbird(h('c80884140088996406'), 'sps'), { temperature: 22.48, humidity: 52.52, battery: 100 });
  const tps = decodeInkbird(h('4808000000c66e0d06'), 'tps')!;
  vals(tps, { temperature: 21.2, battery: 13 });
  assert.equal(tps.values.humidity, undefined);
  vals(decodeInkbird(h('49240812005efeff48036400640800000000'), 'ITH-11-B'), { temperature: -0.2, humidity: 84.0, battery: 100 });
  vals(decodeAdvertisement({ id: 'x', name: 'sps', manufacturerData: h('3b09d01300ce906406') }), { temperature: 23.63, humidity: 50.72 });
});

test('RuuviTag data format 5 (official vectors)', () => {
  const d = decodeRuuvi(h('0512FC5394C37C0004FFFC040CAC364200CDCBB8334C884F'))!;
  vals(d, { temperature: 24.3, humidity: 53.49, pressure: 1000.44, voltage: 2.977 });
  assert.equal(d.mac, 'CB:B8:33:4C:88:4F');
  assert.equal(d.counter, 205);
  vals(decodeRuuvi(h('058001000000008001800180010000000000CBB8334C884F')), { temperature: -163.835, humidity: 0, pressure: 500, voltage: 1.6 });
  assert.deepEqual(decodeRuuvi(h('058000FFFFFFFF800080008000FFFFFFFFFFFFFFFFFFFFFF'))!.values, {});
  vals(decodeAdvertisement({ id: 'x', manufacturerData: h('99040505a060a0c89afd34028cff006376726976dead7b3fefaf') }), { temperature: 7.2, humidity: 61.84, pressure: 1013.54 });
});

test('dispatcher ignores unrelated advertisements', () => {
  assert.equal(decodeAdvertisement({ id: 'x', name: 'iPhone', manufacturerData: h('4c0010050b1c') }), null);
  assert.equal(decodeAdvertisement({ id: 'x' }), null);
  assert.equal(shortUuid('0000FE95-0000-1000-8000-00805F9B34FB'), 'fe95');
});
