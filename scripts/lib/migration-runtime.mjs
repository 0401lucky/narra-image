import { fileURLToPath } from "node:url";
import path from "node:path";

import pg from "pg";

import { runStage } from "./command-runner.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PRISMA_CLI = path.join(
  PROJECT_ROOT,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
export const FOUNDATION_MIGRATION = "20260423000000_initial_schema";

export function parsePositiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

export function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isTransientDatabaseError(value) {
  const message = describeError(value);
  return /57P03|P1001|P1002|P1017|DatabaseNotReachable|Connection terminated|terminating connection|not yet accepting connections|in recovery mode|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(
    message,
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForDatabase(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("缺少 DATABASE_URL，拒绝执行数据库迁移");
  }

  const attempts = parsePositiveInteger(
    options.attempts ?? process.env.DATABASE_READY_ATTEMPTS,
    180,
    "DATABASE_READY_ATTEMPTS",
  );
  const delayMs = parsePositiveInteger(
    options.delayMs ?? process.env.DATABASE_READY_DELAY_MS,
    2_000,
    "DATABASE_READY_DELAY_MS",
  );

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new pg.Client({ connectionString: databaseUrl });
    client.on("error", () => {
      // 恢复窗口中的异步连接错误由本轮重试统一处理。
    });

    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      console.log("[migration] 数据库连接已就绪");
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // 未建立连接或连接已被服务端关闭时无需二次报错。
      }

      if (attempt >= attempts || !isTransientDatabaseError(error)) break;
      console.warn(
        `[migration] 数据库尚未就绪 (${attempt}/${attempts})，等待后重试`,
      );
      await delay(delayMs);
    }
  }

  throw new Error(`数据库未就绪：${describeError(lastError)}`);
}

function schemaFromDatabaseUrl(databaseUrl) {
  try {
    return new URL(databaseUrl).searchParams.get("schema") || "public";
  } catch {
    throw new Error("DATABASE_URL 不是有效 URL");
  }
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function assertMigrationHistoryReady(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  const schema = schemaFromDatabaseUrl(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl });
  client.on("error", () => {
    // 调用处通过 Promise 失败处理连接中断。
  });
  await client.connect();
  try {
    const tables = await client.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `,
      [schema],
    );
    const migrationTableExists = tables.rows.some(
      (row) => row.table_name === "_prisma_migrations",
    );
    const applicationTables = tables.rows.filter(
      (row) => row.table_name !== "_prisma_migrations",
    );
    if (!migrationTableExists) {
      if (applicationTables.length > 0) {
        const error = new Error(
          "数据库非空但缺少 migration 历史，必须先执行 baseline inspect/apply",
        );
        error.exitCode = 2;
        error.code = "BASELINE_REQUIRED";
        throw error;
      }
      return;
    }

    const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier("_prisma_migrations")}`;
    const rows = await client.query(
      `
        SELECT migration_name, finished_at, rolled_back_at
        FROM ${qualified}
        ORDER BY started_at, migration_name
      `,
    );
    const applied = rows.rows.filter(
      (row) => row.finished_at && !row.rolled_back_at,
    );
    const failed = rows.rows.filter(
      (row) => !row.finished_at && !row.rolled_back_at,
    );
    const foundationApplied = applied.some(
      (row) => row.migration_name === FOUNDATION_MIGRATION,
    );
    const laterApplied = applied.some(
      (row) => row.migration_name > FOUNDATION_MIGRATION,
    );
    if (!foundationApplied && laterApplied) {
      const error = new Error(
        "检测到后续 migration 已应用但 synthetic foundation 缺失，必须先执行 prehistory inspect/apply",
      );
      error.exitCode = 2;
      error.code = "PREHISTORY_REQUIRED";
      throw error;
    }
    if (failed.length > 0) {
      const error = new Error(
        `检测到 ${failed.length} 条未决 failed migration，必须先执行 repair inspect/apply`,
      );
      error.exitCode = 2;
      error.code = "MIGRATION_REPAIR_REQUIRED";
      throw error;
    }
  } finally {
    await client.end();
  }
}

export function createPrismaCommand(args, options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("缺少 DATABASE_URL，拒绝执行 Prisma 命令");
  }

  return {
    label: options.label ?? `prisma ${args.join(" ")}`,
    executable: process.execPath,
    args: [PRISMA_CLI, ...args],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...options.env,
      DATABASE_URL: databaseUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    },
    capture: options.capture ?? false,
    timeoutMs: options.timeoutMs,
  };
}

export async function runPrismaChecked(args, options = {}) {
  const result = await (options.runCommand ?? runStage)(
    createPrismaCommand(args, options),
    { scope: options.scope ?? "migration", deadlineAt: options.deadlineAt },
  );
  if (result.code === 0) return result;

  const error = new Error(`prisma ${args.join(" ")} 失败（退出码 ${result.code}）`);
  error.exitCode = result.code;
  error.commandResult = result;
  throw error;
}

export async function prepareDatabase(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  await (options.waitForDatabase ?? waitForDatabase)({
    ...options,
    databaseUrl,
  });
  await (options.checkMigrationHistory ?? assertMigrationHistoryReady)({
    ...options,
    databaseUrl,
  });

  const sharedOptions = {
    ...options,
    databaseUrl,
    scope: options.scope ?? "migration",
  };
  await runPrismaChecked(["migrate", "deploy"], {
    ...sharedOptions,
    label: "部署 Prisma migrations",
  });
  await runPrismaChecked(["migrate", "status"], {
    ...sharedOptions,
    label: "校验 Prisma migration 状态",
  });
}

export { PRISMA_CLI, PROJECT_ROOT };
