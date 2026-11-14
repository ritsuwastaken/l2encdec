import { unzlibSync, zlibSync } from "fflate";

const HEADER_SIZE = 4;
const MAX_DEFLATE_RATIO = 1032;

export function pack(input: Uint8Array): Uint8Array | null {
  if (input.length > 0xffffffff)
    return null;
  const compressed = zlibSync(input, { level: 9 });
  const output = new Uint8Array(HEADER_SIZE + compressed.length);
  new DataView(output.buffer).setUint32(0, input.length, true);
  output.set(compressed, HEADER_SIZE);
  return output;
}

export function unpack(input: Uint8Array): Uint8Array | null {
  if (input.length < HEADER_SIZE)
    return null;
  const size = new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(0, true);
  if (size > (input.length - HEADER_SIZE) * MAX_DEFLATE_RATIO)
    return null;
  const stream = input.subarray(HEADER_SIZE);
  let output: Uint8Array;
  try {
    output = unzlibSync(stream, { out: new Uint8Array(size + 1) });
  } catch {
    return null;
  }
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  if (output.length !== size || stream.length < 4 || adler32(output) !== view.getUint32(stream.length - 4))
    return null;
  return output;
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length;) {
    for (const end = Math.min(i + 5552, data.length); i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}
