export const BLOCK_SIZE = 128;
const PROGRESS_INTERVAL = 32;

export interface WorkerRequest {
  data: Uint8Array;
  modulus: bigint;
  exponent: bigint;
  rejectUnreduced: boolean;
}

export type WorkerReply = { done: number } | { result: Uint8Array | null };

function createModPow(modulus: bigint): (base: bigint, exponent: bigint) => bigint {
  const k = BigInt(modulus.toString(2).length);
  const mu = (1n << (2n * k)) / modulus;
  const reduce = (x: bigint) => {
    let r = x - (((x >> (k - 1n)) * mu) >> (k + 1n)) * modulus;
    while (r >= modulus)
      r -= modulus;
    return r;
  };

  return (base, exponent) => {
    base %= modulus;
    if (exponent < 1n << 32n) {
      let result = 1n % modulus;
      for (const bit of exponent.toString(2)) {
        result = reduce(result * result);
        if (bit === "1")
          result = reduce(result * base);
      }
      return result;
    }

    const table = [1n % modulus, base];
    for (let i = 2; i < 16; i++)
      table.push(reduce(table[i - 1] * table[1]));

    let result = table[0];
    for (const digit of exponent.toString(16)) {
      for (let i = 0; i < 4; i++)
        result = reduce(result * result);
      result = reduce(result * table[parseInt(digit, 16)]);
    }
    return result;
  };
}

function readBlock(data: Uint8Array, offset: number): bigint {
  let hex = "0x";
  for (let i = offset; i < offset + BLOCK_SIZE; i++)
    hex += data[i].toString(16).padStart(2, "0");
  return BigInt(hex);
}

function writeBlock(value: bigint, data: Uint8Array, offset: number): void {
  for (let i = offset + BLOCK_SIZE - 1; i >= offset; i--) {
    data[i] = Number(value & 0xffn);
    value >>= 8n;
  }
}

const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

export async function transform({ data, modulus, exponent, rejectUnreduced }: WorkerRequest,
  onProgress?: (done: number) => void, yieldBetweenSteps = false): Promise<Uint8Array | null> {
  const modPow = createModPow(modulus);
  const output = new Uint8Array(data.length);
  const total = data.length / BLOCK_SIZE;
  for (let i = 0; i < total; i++) {
    const block = readBlock(data, i * BLOCK_SIZE);
    if (rejectUnreduced && block >= modulus)
      return null;
    writeBlock(modPow(block, exponent), output, i * BLOCK_SIZE);
    if ((i + 1) % PROGRESS_INTERVAL === 0 || i + 1 === total) {
      onProgress?.(i + 1);
      if (yieldBetweenSteps)
        await yieldToEventLoop();
    }
  }
  return output;
}
