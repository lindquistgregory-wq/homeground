import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../packages/core/src/plants/index';
import { cropGuide, stateExtensionHub } from '../packages/data/src/index';

test('every bundled plant links to a verified extension growing guide', () => {
  for (const p of PLANTS) {
    const g = cropGuide(p.id);
    assert.ok(g, `${p.id} has no guide`);
    assert.match(g!.url, /^https:\/\//, `${p.id} guide must be https`);
    assert.ok(g!.publisher && g!.checked, `${p.id} guide metadata`);
  }
});

test('every state and territory has an extension gardening hub', () => {
  const fips = ['01','02','04','05','06','08','09','10','11','12','13','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','44','45','46','47','48','49','50','51','53','54','55','56','72'];
  for (const f of fips) assert.ok(stateExtensionHub(f), `state ${f}`);
  assert.equal(stateExtensionHub('99'), null);
});
