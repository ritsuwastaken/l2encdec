export const Type = {
  NONE: 0,
  XOR: 1,
  XOR_FILENAME: 2,
  XOR_POSITION: 3,
  BLOWFISH: 4,
  RSA: 5,
} as const;
export type Type = (typeof Type)[keyof typeof Type];

export interface Params {
  type: Type;
  protocol: number;
  header: string;
  tail: string;
  skip_tail: boolean;
  skip_header: boolean;
  filename: string;
  xor_key: number;
  xor_start_position: number;
  blowfish_key: string;
  rsa_modulus: string;
  rsa_public_exponent: string;
  rsa_private_exponent: string;
}
