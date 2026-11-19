#!/usr/bin/env node

import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { decode, detectProtocol, encode, initParams } from "./index.ts";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      protocol: { type: "string", short: "p" },
      command: { type: "string", short: "c", default: "decode" },
      filename: { type: "string", short: "f", default: "" },
      legacy: { type: "boolean", short: "l", default: false },
      tail: { type: "boolean", short: "t", default: false },
    },
    allowPositionals: true,
  });

  if (!["decode", "encode"].includes(values.command) || !positionals[0] || !positionals[1]) {
    console.error(`
Usage:
  npx l2encdec -c encode -p 413 <input> <output>
  npx l2encdec -c decode -p 413 <input> <output>
  npx l2encdec <input> <output>

Options:
  -t, --tail         Omit the tail when encoding; decode input without a tail.
  -p, --protocol     Decode: detect from header if omitted. Encode: default 413.
`);
    process.exit(1);
  }

  const input = await fs.readFile(positionals[0]);
  const protocol = values.protocol !== undefined ? Number(values.protocol)
    : values.command === "decode" ? detectProtocol(input) : 413;
  if (protocol === null)
    throw new Error("Could not detect protocol from the input header");
  const params = initParams(protocol, {
    filename: values.filename,
    legacyRsa: values.command === "decode" && values.legacy,
  });
  params.skip_tail = values["tail"];
  const result = await (values.command === "encode" ? encode : decode)(input, params);
  await fs.writeFile(positionals[1], result);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
