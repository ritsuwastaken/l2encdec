import { blowfish } from "./blowfish.ts";
import { crc32 } from "./checksum.ts";
import { L2EncDecError } from "./errors.ts";
import { MODERN_RSA_PARAMS, PROTOCOL_CONFIGS } from "./protocols.ts";
import { rsaDecrypt, rsaEncrypt, type RsaOptions } from "./rsa.ts";
import { Type, type Params } from "./types.ts";
import { keyByFilename, xorKey, xorPosition } from "./xor.ts";
import { pack, unpack } from "./zlib.ts";

export { L2EncDecError, type ErrorCode } from "./errors.ts";
export { SUPPORTED_PROTOCOLS } from "./protocols.ts";
export * from "./types.ts";
export { crc32 };

export type ByteInput = Uint8Array | ArrayLike<number>;

export type Options = RsaOptions;

export interface InitOptions {
  filename?: string;
  legacyRsa?: boolean;
}

const HEADER_PREFIX = "Lineage2Ver";
const HEADER_SIZE = (HEADER_PREFIX.length + 3) * 2;
const TAIL_SIZE = 20;
const TAIL_CRC32_OFFSET = 12;

const toBytes = (input: ByteInput) => input instanceof Uint8Array
  ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  : Uint8Array.from(input);

export function defaultParams(): Params {
  return {
    type: Type.NONE,
    protocol: 0,
    header: "",
    tail: "",
    skip_tail: false,
    skip_header: false,
    filename: "",
    xor_key: 0,
    xor_start_position: 0,
    blowfish_key: "",
    rsa_modulus: "",
    rsa_public_exponent: "",
    rsa_private_exponent: "",
  };
}

export function initParams(protocol: number, { filename = "", legacyRsa = false }: InitOptions = {}): Params {
  const config = PROTOCOL_CONFIGS[protocol];
  if (!config)
    throw new L2EncDecError("INVALID_PARAMS", `Unsupported protocol: ${protocol}`);
  if (protocol === 121 && !filename)
    throw new L2EncDecError("INVALID_PARAMS", "Protocol 121 requires a filename");
  const base = config.type === Type.RSA && !legacyRsa ? MODERN_RSA_PARAMS : config;
  return { ...defaultParams(), ...base, protocol, filename };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2)
    hex = "0" + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const pair = hex.slice(i * 2, i * 2 + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair))
      return null;
    out[i] = parseInt(pair, 16);
  }
  return out;
}

function makeHeader(header: string): Uint8Array {
  const out = new Uint8Array(header.length * 2);
  for (let i = 0; i < header.length; i++)
    out[i * 2] = header.charCodeAt(i);
  return out;
}

function makeTail(crc: number): Uint8Array {
  const tail = new Uint8Array(TAIL_SIZE);
  new DataView(tail.buffer).setUint32(TAIL_CRC32_OFFSET, crc, true);
  return tail;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export async function encode(input: ByteInput, params: Params, options: Options = {}): Promise<Uint8Array> {
  const p = params;
  const data = toBytes(input);
  if (!p.skip_header && !p.header && (p.protocol <= 99 || p.protocol > 999))
    throw new L2EncDecError("INVALID_PARAMS", "A header or a 3-digit protocol is required");

  let enc: Uint8Array;
  switch (p.type) {
    case Type.XOR:
      enc = xorKey(data, p.xor_key);
      break;
    case Type.XOR_FILENAME:
      enc = xorKey(data, keyByFilename(p.filename));
      break;
    case Type.XOR_POSITION:
      enc = xorPosition(data, p.xor_start_position);
      break;
    case Type.BLOWFISH: {
      const result = blowfish(data, p.blowfish_key, false);
      if (!result)
        throw new L2EncDecError("ENCRYPTION_FAILED");
      enc = result;
      break;
    }
    case Type.RSA: {
      const compressed = pack(data);
      if (!compressed)
        throw new L2EncDecError("COMPRESSION_FAILED");
      const result = await rsaEncrypt(compressed, p.rsa_modulus, p.rsa_public_exponent, options);
      if (!result)
        throw new L2EncDecError("ENCRYPTION_FAILED");
      enc = result;
      break;
    }
    default:
      enc = data.slice();
  }

  if (!p.skip_header)
    enc = concat(makeHeader(p.header || HEADER_PREFIX + p.protocol), enc);

  if (!p.skip_tail) {
    const tail = p.tail ? hexToBytes(p.tail) : makeTail(crc32(enc));
    if (!tail)
      throw new L2EncDecError("INVALID_PARAMS", "Tail must be a hex string");
    enc = concat(enc, tail);
  }
  return enc;
}

export async function decode(input: ByteInput, params: Params, options: Options = {}): Promise<Uint8Array> {
  const p = params;
  const bytes = toBytes(input);
  const headerSize = p.skip_header ? 0 : p.header ? p.header.length * 2 : HEADER_SIZE;
  const tailSize = p.skip_tail ? 0 : p.tail ? Math.ceil(p.tail.length / 2) : TAIL_SIZE;
  if (bytes.length < headerSize + tailSize)
    throw new L2EncDecError("INVALID_INPUT", "Input is shorter than header and tail");

  const data = bytes.subarray(headerSize, bytes.length - tailSize);
  switch (p.type) {
    case Type.XOR:
      return xorKey(data, p.xor_key);
    case Type.XOR_FILENAME:
      return xorKey(data, keyByFilename(p.filename));
    case Type.XOR_POSITION:
      return xorPosition(data, p.xor_start_position);
    case Type.BLOWFISH: {
      const result = blowfish(data, p.blowfish_key, true);
      if (!result)
        throw new L2EncDecError("DECRYPTION_FAILED");
      return result;
    }
    case Type.RSA: {
      const compressed = await rsaDecrypt(data, p.rsa_modulus, p.rsa_private_exponent, options);
      if (!compressed)
        throw new L2EncDecError("DECRYPTION_FAILED");
      const result = unpack(compressed);
      if (!result)
        throw new L2EncDecError("DECOMPRESSION_FAILED");
      return result;
    }
    default:
      return data.slice();
  }
}

export function verifyChecksum(input: ByteInput): void {
  const bytes = toBytes(input);
  const ok = bytes.length >= TAIL_SIZE
    && crc32(bytes.subarray(0, bytes.length - TAIL_SIZE))
    === new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .getUint32(bytes.length - TAIL_SIZE + TAIL_CRC32_OFFSET, true);
  if (!ok)
    throw new L2EncDecError("CHECKSUM_MISMATCH");
}
