import { L2EncDecError } from "./errors.ts";

const BLOCK_SIZE = 128;
const BLOCK_BODY_SIZE = 124;
const PROGRESS_INTERVAL = 32;
const WORK_PER_WORKER = 1 << 16;

export interface RsaOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface WorkerRequest {
  data: Uint8Array;
  modulus: bigint;
  exponent: bigint;
  rejectUnreduced: boolean;
}

export type WorkerReply = { done: number } | { result: Uint8Array | null };

interface WorkerHandle {
  postMessage(request: WorkerRequest): void;
  listen(onMessage: (reply: WorkerReply) => void, onFailure: () => void): void;
  terminate(): void;
}

interface WebWorker {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: (event: { data: WorkerReply }) => void): void;
  terminate(): void;
}

declare const Worker: (new (url: URL, options: { type: "module" }) => WebWorker) | undefined;

const align4 = (x: number) => (x + 3) & ~3;

function parseHex(hex: string): bigint | null {
  return /^[0-9a-fA-F]+$/.test(hex) ? BigInt("0x" + hex) : null;
}

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

function spawnWorker(): WorkerHandle | null {
  const threads = globalThis.process?.getBuiltinModule?.("node:worker_threads");
  if (threads) {
    const ext = new URL(import.meta.url).pathname.endsWith(".ts") ? ".ts" : ".js";
    const worker = new threads.Worker(new URL(`./rsa-worker${ext}`, import.meta.url));
    return {
      postMessage: request => worker.postMessage(request),
      listen(onMessage, onFailure) {
        worker.on("message", onMessage);
        worker.on("messageerror", onFailure);
        worker.on("error", onFailure);
        worker.on("exit", onFailure);
      },
      terminate: () => void worker.terminate(),
    };
  }

  if (typeof Worker === "undefined")
    return null;
  const worker = new Worker(new URL("./rsa-worker.js", import.meta.url), { type: "module" });
  return {
    postMessage: request => worker.postMessage(request),
    listen(onMessage, onFailure) {
      worker.addEventListener("message", event => onMessage(event.data));
      worker.addEventListener("messageerror", onFailure);
      worker.addEventListener("error", onFailure);
    },
    terminate: () => worker.terminate(),
  };
}

function workerCount(blocks: number, exponent: bigint): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 1;
  const work = blocks * (exponent.toString(2).length + 16);
  return Math.min(cores, Math.floor(work / WORK_PER_WORKER));
}

const cancelled = (signal?: AbortSignal) =>
  new L2EncDecError("CANCELLED", undefined, { cause: signal?.reason });

function onMainThread(request: WorkerRequest, report: (done: number) => void, signal?: AbortSignal) {
  return transform(request, done => {
    if (signal?.aborted)
      throw cancelled(signal);
    report(done);
  }, true);
}

function inWorker(request: WorkerRequest, report: (done: number) => void,
  signal?: AbortSignal): Promise<Uint8Array | null> {
  let worker: WorkerHandle | null;
  try {
    worker = spawnWorker();
  } catch {
    worker = null;
  }
  if (!worker)
    return onMainThread(request, report, signal);

  const handle = worker;
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (then: () => void) => {
      if (settled)
        return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      handle.terminate();
      then();
    };
    const onAbort = () => settle(() => reject(cancelled(signal)));
    signal?.addEventListener("abort", onAbort, { once: true });

    handle.listen(reply => {
      if (!("done" in reply))
        return settle(() => resolve(reply.result));
      try {
        report(reply.done);
      } catch (error) {
        settle(() => reject(error));
      }
    }, () => settle(() => onMainThread(request, report, signal).then(resolve, reject)));
    handle.postMessage(request);
  });
}

async function run(request: WorkerRequest, { onProgress, signal }: RsaOptions): Promise<Uint8Array | null> {
  if (signal?.aborted)
    throw cancelled(signal);
  const total = request.data.length / BLOCK_SIZE;
  onProgress?.(0, total);

  const count = workerCount(total, request.exponent);
  if (count === 0)
    return onMainThread(request, done => onProgress?.(done, total), signal);

  const perChunk = Math.ceil(total / count) * BLOCK_SIZE;
  const progress = new Array<number>(count).fill(0);
  const results = await Promise.all(progress.map((_, i) => inWorker(
    { ...request, data: request.data.subarray(i * perChunk, (i + 1) * perChunk) },
    done => {
      progress[i] = Math.max(progress[i], done);
      onProgress?.(progress.reduce((a, b) => a + b), total);
    },
    signal,
  )));

  if (results.includes(null))
    return null;
  const output = new Uint8Array(request.data.length);
  results.forEach((chunk, i) => output.set(chunk!, i * perChunk));
  return output;
}

function addPadding(input: Uint8Array): Uint8Array {
  const blocks = Math.ceil(input.length / BLOCK_BODY_SIZE);
  const output = new Uint8Array(blocks * BLOCK_SIZE);
  for (let i = 0; i < blocks; i++) {
    const chunk = input.subarray(i * BLOCK_BODY_SIZE, (i + 1) * BLOCK_BODY_SIZE);
    const offset = i * BLOCK_SIZE;
    output[offset + 3] = chunk.length;
    output.set(chunk, offset + BLOCK_SIZE - align4(chunk.length));
  }
  return output;
}

function removePadding(input: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let offset = 0; offset + BLOCK_SIZE <= input.length; offset += BLOCK_SIZE) {
    const chunkSize = Math.min(input[offset + 3], BLOCK_BODY_SIZE);
    const start = offset + BLOCK_SIZE - align4(chunkSize);
    chunks.push(input.subarray(start, start + chunkSize));
    size += chunkSize;
  }
  const output = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }
  return output;
}

function parseKey(modulusHex: string, exponentHex: string) {
  const modulus = parseHex(modulusHex);
  const exponent = parseHex(exponentHex);
  if (modulus === null || exponent === null || !(modulus & 1n) || modulus >= 1n << BigInt(BLOCK_SIZE * 8))
    return null;
  return { modulus, exponent };
}

export async function rsaEncrypt(input: Uint8Array, modulusHex: string, publicExponentHex: string,
  options: RsaOptions = {}): Promise<Uint8Array | null> {
  const key = parseKey(modulusHex, publicExponentHex);
  if (!key || input.length === 0)
    return null;
  return run({ data: addPadding(input), ...key, rejectUnreduced: false }, options);
}

export async function rsaDecrypt(input: Uint8Array, modulusHex: string, privateExponentHex: string,
  options: RsaOptions = {}): Promise<Uint8Array | null> {
  const key = parseKey(modulusHex, privateExponentHex);
  if (!key || input.length % BLOCK_SIZE !== 0)
    return null;
  const result = await run({ data: input, ...key, rejectUnreduced: true }, options);
  return result && removePadding(result);
}
