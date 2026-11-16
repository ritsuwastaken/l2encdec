import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { blowfish } from "../src/blowfish.ts";
import { decode, detectProtocol, encode, initParams, L2EncDecError, SUPPORTED_PROTOCOLS, verifyChecksum } from "../src/index.ts";
import { pack, unpack } from "../src/zlib.ts";

const sample = Uint8Array.from({ length: 1000 }, (_, i) => (i * 31 + 7) & 0xff);

for (const protocol of SUPPORTED_PROTOCOLS) {
  test(`protocol ${protocol} round-trips`, async () => {
    const params = initParams(protocol, { filename: "Test.int" });
    const encoded = await encode(sample, params);
    verifyChecksum(encoded);
    assert.deepEqual(await decode(encoded, params), sample);
  });
}

test("RSA round-trips across workers with progress", async () => {
  const input = new Uint8Array(randomBytes(64 * 1024));
  const params = initParams(413);
  const seen: number[] = [];
  const encoded = await encode(input, params, { onProgress: done => seen.push(done) });
  assert.equal(seen.at(-1), (encoded.length - 28 - 20) / 128);
  assert.ok(seen.every((n, i) => i === 0 || n >= seen[i - 1]));
  assert.deepEqual(await decode(encoded, params), input);
});

test("RSA encode can be cancelled", async () => {
  const controller = new AbortController();
  const promise = encode(new Uint8Array(randomBytes(64 * 1024)), initParams(413), {
    signal: controller.signal,
    onProgress: done => done > 0 && controller.abort(),
  });
  await assert.rejects(promise, (err: L2EncDecError) => err.code === "CANCELLED");
});

test("errors carry string codes", async () => {
  assert.throws(() => initParams(999), { name: "L2EncDecError", code: "INVALID_PARAMS" });
  assert.throws(() => initParams(121), { code: "INVALID_PARAMS" });
  await assert.rejects(decode(new Uint8Array(4), initParams(111)), { code: "INVALID_INPUT" });
  assert.throws(() => verifyChecksum(new Uint8Array(20).fill(1)), { code: "CHECKSUM_MISMATCH" });
});

test("blowfish matches reference vector", () => {
  const toWords = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex").swap32());
  const out = blowfish(toWords("0000000000000000"), "", false);
  assert.deepEqual(out, toWords("4ef997456198dd78"));
});

test("encode does not mutate a Buffer input", async () => {
  const input = Buffer.from(sample);
  await encode(input, initParams(111));
  assert.deepEqual(new Uint8Array(input), sample);
});

test("unpack rejects a bad checksum or wrong size", async () => {
  const packed = (await pack(sample))!;
  assert.deepEqual(await unpack(packed), sample);

  const badAdler = packed.slice();
  badAdler[badAdler.length - 1] ^= 1;
  assert.equal(await unpack(badAdler), null);

  for (const size of [sample.length - 1, sample.length + 1]) {
    const wrong = packed.slice();
    new DataView(wrong.buffer).setUint32(0, size, true);
    assert.equal(await unpack(wrong), null);
  }
  assert.equal(await unpack(new Uint8Array([4, 0, 0, 0, 1, 2, 3, 4])), null);
});

test("odd-length custom tail round-trips", async () => {
  const params = { ...initParams(111), tail: "abc" };
  assert.deepEqual(await decode(await encode(sample, params), params), sample);
});

const header = (text: string, rest = 32) => Uint8Array.from([...[...text].flatMap((char) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8]), ...new Array(rest).fill(0)]);

test("detectProtocol reads the header like the client", async () => {
  for (const protocol of SUPPORTED_PROTOCOLS)
    assert.equal(detectProtocol(await encode(sample, initParams(protocol, { filename: "Test.int" }))), protocol);
  assert.equal(detectProtocol(header("Lineage2Ver111")), 111);
  assert.equal(detectProtocol(header("Lineage2Ver1a1")), 1);
  assert.equal(detectProtocol(header("Lineage2Verabc")), 0);
  assert.equal(detectProtocol(header("lineage2Ver111")), null);
  assert.equal(detectProtocol(header("Lineage2Ve\u0172111")), null);
  assert.equal(detectProtocol(sample), null);
  assert.equal(detectProtocol(header("Lineage2Ver111", 0).subarray(0, 27)), null);
});
