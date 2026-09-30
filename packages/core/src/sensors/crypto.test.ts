import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { aesEncryptBlock, aesExpandKey, bytesToHex, ccmDecrypt, ccmEncrypt, hexToBytes } from './crypto';

test('AES-128 matches FIPS-197 Appendix C.1', () => {
  const out = aesEncryptBlock(aesExpandKey(hexToBytes('000102030405060708090a0b0c0d0e0f')), hexToBytes('00112233445566778899aabbccddeeff'));
  assert.equal(bytesToHex(out), '69c4e0d86a7b0430d8cdb78070b4c55a');
});

test('AES-128 matches FIPS-197 Appendix B', () => {
  const out = aesEncryptBlock(aesExpandKey(hexToBytes('2b7e151628aed2a6abf7158809cf4f3c')), hexToBytes('3243f6a8885a308d313198a2e0370734'));
  assert.equal(bytesToHex(out), '3925841d02dc09fbdc118597196a0b32');
});

test('AES-CCM matches RFC 3610 packet vector #1', () => {
  const key = hexToBytes('c0c1c2c3c4c5c6c7c8c9cacbcccdcecf');
  const nonce = hexToBytes('00000003020100a0a1a2a3a4a5');
  const aad = hexToBytes('0001020304050607');
  const pt = hexToBytes('08090a0b0c0d0e0f101112131415161718191a1b1c1d1e');
  const ct = ccmEncrypt(key, nonce, pt, 8, aad);
  assert.equal(bytesToHex(ct), '588c979a61c663d2f066d0c2c0f989806d5f6b61dac38417e8d12cfdf926e0');
  assert.equal(bytesToHex(ccmDecrypt(key, nonce, ct.subarray(0, pt.length), ct.subarray(pt.length), aad)!), bytesToHex(pt));
  const bad = new Uint8Array(ct); bad[0] = bad[0]! ^ 1;
  assert.equal(ccmDecrypt(key, nonce, bad.subarray(0, pt.length), bad.subarray(pt.length), aad), null);
});

test('AES-CCM agrees with Node crypto on random inputs (BLE-sized: 4-byte tags, 11–13-byte nonces)', () => {
  for (let i = 0; i < 200; i++) {
    const key = randomBytes(16), nonce = randomBytes(11 + (i % 3)), pt = randomBytes(1 + (i % 40)), aad = i % 2 ? Buffer.from([0x11]) : Buffer.alloc(0);
    const c = createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 4 });
    c.setAAD(aad, { plaintextLength: pt.length });
    const ref = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
    assert.equal(bytesToHex(ccmEncrypt(key, nonce, pt, 4, aad)), ref.toString('hex'), `case ${i}`);
  }
  // Also check the raw block cipher against ECB.
  const key = randomBytes(16), blk = randomBytes(16);
  const e = createCipheriv('aes-128-ecb', key, null).setAutoPadding(false);
  assert.equal(bytesToHex(aesEncryptBlock(aesExpandKey(key), blk)), Buffer.concat([e.update(blk), e.final()]).toString('hex'));
});
