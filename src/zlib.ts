const HEADER_SIZE = 4;
const MAX_DEFLATE_RATIO = 1032;

async function transform(input: Uint8Array, stream: CompressionStream | DecompressionStream,
  limit = Infinity): Promise<Uint8Array | null> {
  const reader = new Blob([input]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      length += chunk.value.length;
      if (length > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export async function pack(input: Uint8Array): Promise<Uint8Array | null> {
  if (input.length > 0xffffffff)
    return null;
  const compressed = await transform(input, new CompressionStream("deflate"));
  if (!compressed)
    return null;
  const output = new Uint8Array(HEADER_SIZE + compressed.length);
  new DataView(output.buffer).setUint32(0, input.length, true);
  output.set(compressed, HEADER_SIZE);
  return output;
}

export async function unpack(input: Uint8Array): Promise<Uint8Array | null> {
  if (input.length < HEADER_SIZE)
    return null;
  const size = new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(0, true);
  if (size > (input.length - HEADER_SIZE) * MAX_DEFLATE_RATIO)
    return null;
  const output = await transform(input.subarray(HEADER_SIZE), new DecompressionStream("deflate"), size);
  return output?.length === size ? output : null;
}
