# l2encdec

## Usage

```bash
$ npm install l2encdec
```

```typescript
import { initParams, encode, decode } from "l2encdec";

const params = initParams(413);
const encoded = await encode(new Uint8Array([1, 2, 3, 4, 5]), params);
const decoded = await decode(encoded, params);
```

## API

- `initParams(protocol, { filename?, legacyRsa? }): Params`
  returns default parameters. Protocol 121 requires `filename`. Legacy RSA
  keys (`legacyRsa: true`) for protocols 411–414 can only decode.
- `encode(input, params, { onProgress?, signal? }): Promise<Uint8Array>`
- `decode(input, params, { onProgress?, signal? }): Promise<Uint8Array>`
- `verifyChecksum(input): void`
- `detectProtocol(input): number | null`

## CLI

```bash
npx l2encdec encoded_input.dat decoded_output.bin
npx l2encdec -c decode -p 413 input.dat output.bin
npx l2encdec -c encode -p 413 output.bin input.dat
```

Options: `-c` / `--command`, `-p` / `--protocol`, `-f` / `--filename` for protocol 121,
and `-l` / `--legacy` for original RSA decryption keys. Use `-t` / `--tail` to omit the tail. Omitting `--protocol` reads it from the header for `decode` and defaults to `413` for `encode`.
