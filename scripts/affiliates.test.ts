import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activePrograms, affiliateLinks, httpsHost, safeTopic, type AffiliateProgram } from '../packages/core/src/monetization/affiliates';
import { affiliateRegistry } from '../packages/data/src/index';

test('shipped registry: every program needs sign-up, so no link is built yet', () => {
  const programs = affiliateRegistry();
  assert.ok(programs.length >= 9);
  assert.deepEqual(activePrograms(programs), []);
  assert.deepEqual(affiliateLinks(programs, 'animal-detail', 'chicken feeder'), []);
  for (const p of programs) {
    assert.equal(p.status, 'needs-signup', p.id);
    assert.ok(p.disclosure, p.id);
    assert.ok(!/baker ?creek/i.test(p.name), 'Baker Creek does not do affiliate marketing');
    if (p.signupUrl) assert.ok(httpsHost(p.signupUrl), p.id);
  }
  assert.match(programs.find((p) => p.id === 'amazon')!.disclosure, /As an Amazon Associate I earn from qualifying purchases/);
});

const active = (over: Partial<AffiliateProgram> = {}): AffiliateProgram => ({
  id: 'x', name: 'Example Farm Supply', category: 'livestock-supplies', network: 'Impact', signupUrl: null,
  merchantHost: 'www.example-farm.com', trackingHosts: ['example.sjv.io'], status: 'active', affiliateId: 'ABC 123',
  linkTemplate: 'https://example.sjv.io/c/{id}?u=https%3A%2F%2Fwww.example-farm.com%2Fsearch%3Fq%3D{q}', termsCheckedOn: '2026-10-19',
  disclosure: 'Plotwright earns a commission on purchases from these links.', allowedPlacements: ['animal-detail'], ...over,
});

test('built links stay on the merchant or tracking host, over HTTPS, in allowed places only', () => {
  const [l] = affiliateLinks([active()], 'animal-detail', 'Chicken feeder');
  assert.ok(l);
  assert.equal(httpsHost(l!.url), 'example.sjv.io');
  assert.match(l!.url, /chicken%20feeder/);
  assert.match(l!.url, /ABC%20123/);
  assert.deepEqual(affiliateLinks([active()], 'plant-detail', 'tomato seeds'), [], 'placement not allowed');
  assert.deepEqual(affiliateLinks([active({ linkTemplate: 'https://evil.example.net/?q={q}' })], 'animal-detail', 'feeder'), [], 'foreign host');
  assert.deepEqual(affiliateLinks([active({ linkTemplate: 'http://www.example-farm.com/?q={q}' })], 'animal-detail', 'feeder'), [], 'not https');
  assert.deepEqual(affiliateLinks([active({ status: 'paused' })], 'animal-detail', 'feeder'), []);
});

test('links never carry user data or anything about medicine', () => {
  for (const bad of ['Daisy (my goat) 35.7,-79.8', 'parcel 1234 Main St', 'goat dewormer', 'ivermectin', 'chick vaccine', 'live chicks', 'x'.repeat(41)]) {
    assert.equal(safeTopic(bad), null, bad);
    assert.deepEqual(affiliateLinks([active()], 'animal-detail', bad), [], bad);
  }
  assert.equal(safeTopic('goat feeder'), 'goat feeder');
});
