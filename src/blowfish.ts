import { P_INIT, S_INIT } from "./blowfish-tables.ts";

const BLOCK_SIZE = 8;
const MAX_KEY_SIZE = 56;

class Cipher {
  private readonly p = P_INIT.slice();
  private readonly s = S_INIT.slice();

  constructor(key: Uint8Array) {
    for (let i = 0, k = 0; i < 18; i++) {
      let word = 0;
      for (let j = 0; j < 4; j++, k = (k + 1) % key.length)
        word = (word << 8) | key[k];
      this.p[i] ^= word;
    }

    let l = 0, r = 0;
    for (const table of [this.p, this.s]) {
      for (let i = 0; i < table.length; i += 2) {
        [l, r] = this.encrypt(l, r);
        table[i] = l;
        table[i + 1] = r;
      }
    }
  }

  private f(x: number): number {
    const s = this.s;
    return ((s[x >>> 24] + s[256 + ((x >>> 16) & 0xff)]) ^ s[512 + ((x >>> 8) & 0xff)]) + s[768 + (x & 0xff)];
  }

  encrypt(l: number, r: number): [number, number] {
    const p = this.p;
    for (let i = 0; i < 16; i += 2) {
      l ^= p[i];
      r ^= this.f(l) ^ p[i + 1];
      l ^= this.f(r);
    }
    return [(r ^ p[17]) >>> 0, (l ^ p[16]) >>> 0];
  }

  decrypt(l: number, r: number): [number, number] {
    const p = this.p;
    for (let i = 17; i > 1; i -= 2) {
      l ^= p[i];
      r ^= this.f(l) ^ p[i - 1];
      l ^= this.f(r);
    }
    return [(r ^ p[0]) >>> 0, (l ^ p[1]) >>> 0];
  }
}

export function blowfish(input: Uint8Array, key: string, decrypt: boolean): Uint8Array | null {
  let keyBytes = new TextEncoder().encode(key);
  if (keyBytes.length === 0 || keyBytes[keyBytes.length - 1] !== 0) {
    const terminated = new Uint8Array(keyBytes.length + 1);
    terminated.set(keyBytes);
    keyBytes = terminated;
  }
  if (keyBytes.length > MAX_KEY_SIZE)
    return null;

  const cipher = new Cipher(keyBytes);
  const output = new Uint8Array(input);
  const view = new DataView(output.buffer);
  for (let i = 0; i + BLOCK_SIZE <= output.length; i += BLOCK_SIZE) {
    const l = view.getUint32(i, true);
    const r = view.getUint32(i + 4, true);
    const [a, b] = decrypt ? cipher.decrypt(l, r) : cipher.encrypt(l, r);
    view.setUint32(i, a, true);
    view.setUint32(i + 4, b, true);
  }
  return output;
}
