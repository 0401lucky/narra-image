import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import pg from "pg";

const BASELINE_MIGRATIONS = ["20260423165000_single_image_works"];
const DATABASE_READY_ATTEMPTS = Number(process.env.DATABASE_READY_ATTEMPTS ?? 180);
const DATABASE_READY_DELAY_MS = Number(process.env.DATABASE_READY_DELAY_MS ?? 2_000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeDatabaseError(error) {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const code = "code" in error && error.code ? ` ${error.code}` : "";
  const message =
    "message" in error && error.message ? error.message : String(error);

  return `${message}${code}`;
}

function isTransientDatabaseError(value) {
  const message =
    typeof value === "string" ? value : describeDatabaseError(value);

  return /57P03|P1001|P1002|P1017|DatabaseNotReachable|Connection terminated|terminating connection|not yet accepting connections|in recovery mode|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(
    message,
  );
}

function createDatabaseClient() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  client.on("error", () => {
    // PostgreSQL 恢复期间可能在 connect/query 前后抛 error 事件。
    // 监听后让调用处通过 Promise 拒绝进入重试，而不是让 Node 进程直接退出。
  });

  return client;
}

async function closeDatabaseClient(client) {
  try {
    await client.end();
  } catch {
    // 连接未建立或已被服务端关闭时，关闭连接可能也会失败。
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    status: result.status ?? 1,
  };
}

function runPrisma(args) {
  return run("pnpm", ["exec", "prisma", ...args]);
}

async function runPrismaWithDatabaseRetry(args) {
  let lastResult = null;

  for (let attempt = 1; attempt <= DATABASE_READY_ATTEMPTS; attempt++) {
    const result = runPrisma(args);
    lastResult = result;

    if (result.ok || !isTransientDatabaseError(result.output)) {
      return result;
    }

    if (attempt >= DATABASE_READY_ATTEMPTS) {
      return result;
    }

    console.warn(
      `Database is not ready for prisma ${args.join(" ")} (${attempt}/${DATABASE_READY_ATTEMPTS}).`,
    );
    await sleep(DATABASE_READY_DELAY_MS);
  }

  return lastResult ?? { ok: false, output: "", status: 1 };
}

function runRequired(command, args) {
  const result = run(command, args);
  if (!result.ok) process.exit(result.status);
}

function getPrismaMigrations() {
  return readdirSync(join(process.cwd(), "prisma", "migrations"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function getDatabaseSchemaName() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return "public";

  try {
    return new URL(databaseUrl).searchParams.get("schema") || "public";
  } catch {
    return "public";
  }
}

async function waitForDatabase() {
  if (!process.env.DATABASE_URL) return;

  for (let attempt = 1; attempt <= DATABASE_READY_ATTEMPTS; attempt++) {
    const client = createDatabaseClient();

    try {
      await client.connect();
      await client.query("SELECT 1");
      await closeDatabaseClient(client);
      console.log("Database is accepting connections.");
      return;
    } catch (error) {
      await closeDatabaseClient(client);

      if (attempt >= DATABASE_READY_ATTEMPTS) {
        throw error;
      }

      console.warn(
        `Database is not ready yet (${attempt}/${DATABASE_READY_ATTEMPTS}): ${describeDatabaseError(
          error,
        )}`,
      );
      await sleep(DATABASE_READY_DELAY_MS);
    }
  }
}

async function isDatabaseSchemaEmpty() {
  if (!process.env.DATABASE_URL) return false;

  const client = createDatabaseClient();

  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
        LIMIT 1
      `,
      [getDatabaseSchemaName()],
    );

    return result.rowCount === 0;
  } finally {
    await closeDatabaseClient(client);
  }
}

async function resolveApplied(migrationName) {
  const result = await runPrismaWithDatabaseRetry([
    "migrate",
    "resolve",
    "--applied",
    migrationName,
  ]);
  if (!result.ok && !result.output.includes("already recorded as applied")) {
    process.exit(result.status);
  }
}

async function prepareDatabase() {
  await waitForDatabase();

  if (await isDatabaseSchemaEmpty()) {
    const push = await runPrismaWithDatabaseRetry(["db", "push"]);
    if (!push.ok) process.exit(push.status);

    for (const migrationName of getPrismaMigrations()) {
      await resolveApplied(migrationName);
    }
    return;
  }

  const deploy = await runPrismaWithDatabaseRetry(["migrate", "deploy"]);
  if (deploy.ok) return;

  if (!deploy.output.includes("P3005")) {
    process.exit(deploy.status);
  }

  for (const migrationName of BASELINE_MIGRATIONS) {
    await resolveApplied(migrationName);
  }

  const retry = await runPrismaWithDatabaseRetry(["migrate", "deploy"]);
  if (!retry.ok) process.exit(retry.status);
}

try {
  await prepareDatabase();
} catch (error) {
  console.error(`Failed to prepare database: ${describeDatabaseError(error)}`);
  process.exit(1);
}

runRequired("next", ["start"]);
