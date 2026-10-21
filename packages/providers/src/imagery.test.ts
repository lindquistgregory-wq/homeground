import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STATE_IMAGERY, USGS_IMAGERY, USGS_NAIP_PLUS, imageryFor, maxUsefulZoom } from './basemaps';

test('the sharpest free imagery: the state program where there is one, NAIP Plus elsewhere', () => {
  assert.equal(imageryFor('best', '37').id, 'nc-onemap-ortho', 'North Carolina: 6-inch statewide imagery');
  assert.equal(imageryFor('best', '51').id, USGS_NAIP_PLUS.id, 'no state source registered yet');
  assert.equal(imageryFor('best', undefined).id, USGS_NAIP_PLUS.id);
  assert.equal(imageryFor('standard', '37').id, USGS_IMAGERY.id);
  assert.equal(imageryFor('naip-plus', '37').id, USGS_NAIP_PLUS.id);
  for (const s of [USGS_NAIP_PLUS, ...Object.values(STATE_IMAGERY)]) {
    assert.match(s.tiles[0]!, /^https:\/\/[^/]+\/.*exportImage\?bbox=\{bbox-epsg-3857\}&bboxSR=3857&imageSR=3857&size=512,512/);
    assert.equal(s.tileSize, 512);
  }
});

test('zoom stops half a level past where pixels match the ground resolution', () => {
  // 6-inch imagery at 35.7° N: z ≈ log2(156543 × cos 35.7° / 0.1524) ≈ 19.74, + 0.5.
  assert.equal(maxUsefulZoom(0.1524, 35.7), 20.2);
  // NAIP 0.6 m → about 17.7 + 0.5.
  assert.equal(maxUsefulZoom(0.6, 35.7), 18.2);
  assert.equal(maxUsefulZoom(100, 35.7), 15, 'never below 15');
});
