#!/usr/bin/env node

import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { decode, encode, initParams } from "./index.ts";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      protocol: { type: "string", short: "p", default: "413" },
      command: { type: "string", short: "c", default: "decode" },
      filename: { type: "string", short: "f", default: "" },
      legacy: { type: "boolean", short: "l", default: false },
    },
    allowPositionals: true,
  });

  if (!["decode", "encode"].includes(values.command) || !positionals[0] || !positionals[1]) {
    console.error(`
Usage:
  npx l2encdec -c encode -p 413 <input> <output>
  npx l2encdec -c decode -p 413 <input> <output>
`);
    process.exit(1);
  }

  const input = await fs.readFile(positionals[0]);
  const params = initParams(Number(values.protocol), {
    filename: values.filename,
    legacyRsa: values.command === "decode" && values.legacy,
  });
  const result = await (values.command === "encode" ? encode : decode)(input, params);
  await fs.writeFile(positionals[1], result);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
