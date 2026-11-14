export type ErrorCode =
  | "INVALID_PARAMS"
  | "INVALID_INPUT"
  | "COMPRESSION_FAILED"
  | "DECOMPRESSION_FAILED"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "CHECKSUM_MISMATCH"
  | "CANCELLED";

const MESSAGES: Record<ErrorCode, string> = {
  INVALID_PARAMS: "Invalid parameters",
  INVALID_INPUT: "Invalid input",
  COMPRESSION_FAILED: "Compression failed",
  DECOMPRESSION_FAILED: "Decompression failed",
  ENCRYPTION_FAILED: "Encryption failed",
  DECRYPTION_FAILED: "Decryption failed",
  CHECKSUM_MISMATCH: "Checksum mismatch",
  CANCELLED: "Cancelled",
};

export class L2EncDecError extends Error {
  override readonly name = "L2EncDecError";
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message = MESSAGES[code], options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
