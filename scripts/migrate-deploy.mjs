#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

import { describeError, prepareDatabase } from "./lib/migration-runtime.mjs";

export async function main() {
  try {
    await prepareDatabase();
    console.log("[migration] migrate deploy 与状态校验完成");
    return 0;
  } catch (error) {
    console.error(`[migration] 迁移失败：${describeError(error)}`);
    return Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
