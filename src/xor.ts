function keyByIndex(index: number): number {
  const d1 = index & 0xf;
  const d2 = (index >>> 4) & 0xf;
  const d3 = (index >>> 8) & 0xf;
  const d4 = (index >>> 12) & 0xf;
  return ((d2 ^ d4) << 4) | (d1 ^ d3);
}

export function keyByFilename(filename: string): number {
  let acc = 0;
  for (let c of new TextEncoder().encode(filename)) {
    if (c >= 0x41 && c <= 0x5a)
      c += 0x20;
    acc += c;
  }
  return acc & 0xff;
}

export function xorKey(input: Uint8Array, key: number): Uint8Array {
  const output = input.slice();
  for (let i = 0; i < output.length; i++)
    output[i] ^= key;
  return output;
}

export function xorPosition(input: Uint8Array, startPosition: number): Uint8Array {
  const output = input.slice();
  let index = startPosition >>> 0;
  for (let i = 0; i < output.length; i++, index = (index + 1) >>> 0)
    output[i] ^= keyByIndex(index);
  return output;
}
