/**
 * AES-128 (FIPS-197) and AES-CCM (NIST SP 800-38C / RFC 3610), just enough to read encrypted BLE
 * advertisements (BTHome, Xiaomi MiBeacon, pvvx firmware) with the owner's bindkey. React Native has
 * no WebCrypto CCM, and this is small enough to own. Encryption direction only (CCM uses AES forward).
 * Not constant-time: fine for decoding sensor readings, not for protecting secrets.
 */

const SBOX = new Uint8Array(256);
(() => {
  // Build the S-box from the multiplicative inverse in GF(2^8) plus the affine transform.
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0); // p *= 3
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; // q /= 3
    if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
})();

const xtime = (b: number) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;

/** Expand a 16-byte key into 11 round keys (176 bytes). */
export function aesExpandKey(key: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new Error('AES-128 key must be 16 bytes');
  const w = new Uint8Array(176);
  w.set(key);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4]!, t1 = w[i - 3]!, t2 = w[i - 2]!, t3 = w[i - 1]!;
    if (i % 16 === 0) {
      const tmp = t0;
      t0 = SBOX[t1]! ^ rcon; t1 = SBOX[t2]!; t2 = SBOX[t3]!; t3 = SBOX[tmp]!;
      rcon = xtime(rcon);
    }
    w[i] = w[i - 16]! ^ t0; w[i + 1] = w[i - 15]! ^ t1; w[i + 2] = w[i - 14]! ^ t2; w[i + 3] = w[i - 13]! ^ t3;
  }
  return w;
}

/** Encrypt one 16-byte block. */
export function aesEncryptBlock(roundKeys: Uint8Array, input: Uint8Array): Uint8Array {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = input[i]! ^ roundKeys[i]!;
  const t = new Uint8Array(16);
  for (let round = 1; round <= 10; round++) {
    // SubBytes + ShiftRows (state is column-major: s[r + 4c]).
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[r + 4 * c] = SBOX[s[r + 4 * ((c + r) % 4)]!]!;
    if (round < 10) {
      // MixColumns
      for (let c = 0; c < 4; c++) {
        const a0 = t[4 * c]!, a1 = t[4 * c + 1]!, a2 = t[4 * c + 2]!, a3 = t[4 * c + 3]!;
        const all = a0 ^ a1 ^ a2 ^ a3;
        s[4 * c] = a0 ^ all ^ xtime(a0 ^ a1);
        s[4 * c + 1] = a1 ^ all ^ xtime(a1 ^ a2);
        s[4 * c + 2] = a2 ^ all ^ xtime(a2 ^ a3);
        s[4 * c + 3] = a3 ^ all ^ xtime(a3 ^ a0);
      }
    } else s.set(t);
    const rk = round * 16;
    for (let i = 0; i < 16; i++) s[i] = s[i]! ^ roundKeys[rk + i]!;
  }
  return s;
}

function ctrBlock(flagsL: number, nonce: Uint8Array, counter: number): Uint8Array {
  const a = new Uint8Array(16);
  a[0] = flagsL;
  a.set(nonce, 1);
  // Counter in the last L bytes, big-endian.
  for (let i = 15, c = counter; i > nonce.length; i--, c = Math.floor(c / 256)) a[i] = c & 0xff;
  return a;
}

/** CTR keystream XOR starting at counter `start` (CCM's A_i blocks). */
function ctrXor(rk: Uint8Array, nonce: Uint8Array, data: Uint8Array, start: number): Uint8Array {
  const L = 15 - nonce.length;
  const out = new Uint8Array(data.length);
  for (let off = 0, i = start; off < data.length; off += 16, i++) {
    const s = aesEncryptBlock(rk, ctrBlock(L - 1, nonce, i));
    for (let k = 0; k < 16 && off + k < data.length; k++) out[off + k] = data[off + k]! ^ s[k]!;
  }
  return out;
}

function cbcMac(rk: Uint8Array, nonce: Uint8Array, aad: Uint8Array, msg: Uint8Array, tagLen: number): Uint8Array {
  const L = 15 - nonce.length;
  const b0 = new Uint8Array(16);
  b0[0] = (aad.length ? 0x40 : 0) | (((tagLen - 2) / 2) << 3) | (L - 1);
  b0.set(nonce, 1);
  for (let i = 15, n = msg.length; i > nonce.length; i--, n = Math.floor(n / 256)) b0[i] = n & 0xff;
  let x = aesEncryptBlock(rk, b0);
  const absorb = (bytes: Uint8Array) => {
    for (let off = 0; off < bytes.length; off += 16) {
      const blk = new Uint8Array(16);
      blk.set(bytes.subarray(off, off + 16));
      for (let k = 0; k < 16; k++) blk[k] = blk[k]! ^ x[k]!;
      x = aesEncryptBlock(rk, blk);
    }
  };
  if (aad.length) {
    if (aad.length >= 0xff00) throw new Error('AAD too long');
    const a = new Uint8Array(2 + aad.length);
    a[0] = aad.length >> 8; a[1] = aad.length & 0xff;
    a.set(aad, 2);
    absorb(a);
  }
  absorb(msg);
  return x.subarray(0, tagLen);
}

/** AES-CCM decrypt and verify. Returns the plaintext, or null if the tag doesn't match (wrong key or corrupt packet). */
export function ccmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array, aad: Uint8Array = new Uint8Array(0)): Uint8Array | null {
  if (nonce.length < 7 || nonce.length > 13) throw new Error('CCM nonce must be 7–13 bytes');
  const rk = aesExpandKey(key);
  const plain = ctrXor(rk, nonce, ciphertext, 1);
  const t = cbcMac(rk, nonce, aad, plain, tag.length);
  const s0 = aesEncryptBlock(rk, ctrBlock(14 - nonce.length, nonce, 0));
  let diff = 0;
  for (let i = 0; i < tag.length; i++) diff |= (t[i]! ^ s0[i]!) ^ tag[i]!;
  return diff === 0 ? plain : null;
}

/** AES-CCM encrypt (used by tests and to round-trip vectors). Returns ciphertext ‖ tag. */
export function ccmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, tagLen: number, aad: Uint8Array = new Uint8Array(0)): Uint8Array {
  const rk = aesExpandKey(key);
  const t = cbcMac(rk, nonce, aad, plaintext, tagLen);
  const s0 = aesEncryptBlock(rk, ctrBlock(14 - nonce.length, nonce, 0));
  const out = new Uint8Array(plaintext.length + tagLen);
  out.set(ctrXor(rk, nonce, plaintext, 1));
  for (let i = 0; i < tagLen; i++) out[plaintext.length + i] = t[i]! ^ s0[i]!;
  return out;
}

/** CCM's CTR mode without tag verification (Xiaomi MiBeacon v2/v3 legacy frames carry no usable MIC). */
export function ccmCtrOnly(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return ctrXor(aesExpandKey(key), nonce, ciphertext, 1);
}

// ---------------- Hex helpers ----------------

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/[\s:-]/g, '');
  if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error('Invalid hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
