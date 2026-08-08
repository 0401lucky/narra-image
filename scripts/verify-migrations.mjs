#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertFixedTargets,
  runStage,
} from "./lib/command-runner.mjs";
import {
  assertDockerPrerequisites,
  buildDatabaseEnvironment,
  buildDatabaseUrl,
  cleanupPostgres,
  createDatabase,
  createPostgresResource,
  runPsql,
  startPostgres,
  waitForPostgres,
} from "./lib/disposable-postgres.mjs";
import {
  listLocalMigrations,
  PREHISTORY_APPLY_SENTINEL,
  BASELINE_APPLY_SENTINEL,
} from "./lib/migration-safety.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MIGRATIONS_ROOT = path.join(PROJECT_ROOT, "prisma", "migrations");
const GLOBAL_DEADLINE_MS = 240_000;
const CLEANUP_RESERVE_MS = 15_000;
const SCRATCH_PARENT = path.resolve(
  process.env.MIGRATION_VERIFY_TMPDIR?.trim() || tmpdir(),
);
const SCRATCH_PREFIX = "narra-migrations-";
const IMAGE =
  process.env.MIGRATION_VERIFY_POSTGRES_IMAGE?.trim() || "postgres:17-alpine";

const EXIT = Object.freeze({
  success: 0,
  preflight: 2,
  empty: 3,
  baseline: 4,
  prehistory: 5,
  failed: 6,
  pgx: 7,
  cleanup: 8,
});

function failure(exitCode, message) {
  return Object.assign(new Error(message), { exitCode });
}

function scenarioDatabaseName(label) {
  return `narra_${label}_${randomBytes(5).toString("hex")}`;
}

async function runNodeScript(script, args, env, options) {
  return runStage(
    {
      label: options.label,
      executable: process.execPath,
      args: [script, ...args],
      cwd: PROJECT_ROOT,
      env,
      capture: options.capture ?? false,
    },
    {
      scope: "verify:migrations",
      deadlineAt: options.deadlineAt,
    },
  );
}

async function runExpectedSuccess(script, args, env, options, exitCode) {
  const result = await runNodeScript(script, args, env, options);
  if (result.code === 0) return result;
  if (result.stdout.trim()) console.error(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  throw failure(exitCode, `${options.label} 失败（退出码 ${result.code}）`);
}

async function runExpectedFailure(script, args, env, options, exitCode) {
  const result = await runNodeScript(script, args, env, {
    ...options,
    capture: true,
  });
  if (result.code !== 0) return result;
  throw failure(exitCode, `${options.label} 意外成功，拒绝假绿`);
}

async function applyMigrationPrefix(resource, databaseName, migrations, options) {
  for (const migration of migrations) {
    const sql = readFileSync(
      path.join(MIGRATIONS_ROOT, migration.name, "migration.sql"),
      "utf8",
    );
    await runPsql(resource, {
      ...options,
      databaseName,
      label: `应用 legacy fixture ${migration.name}`,
      input: sql,
      exitCode: EXIT.baseline,
    });
  }
}

async function queryScalar(resource, databaseName, command, options) {
  const result = await runPsql(resource, {
    ...options,
    databaseName,
    command,
    tuplesOnly: true,
  });
  return result.stdout.trim();
}

async function verifyEmptyDatabase(resource, options) {
  const databaseName = scenarioDatabaseName("empty");
  await createDatabase(resource, databaseName, options);
  const databaseUrl = buildDatabaseUrl(resource, databaseName);
  const env = buildDatabaseEnvironment(databaseUrl);
  await runExpectedSuccess(
    "scripts/migrate-deploy.mjs",
    [],
    env,
    { ...options, label: "空库按完整 migration 历史 deploy" },
    EXIT.empty,
  );
  const count = await queryScalar(
    resource,
    databaseName,
    'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    options,
  );
  const expected = String(listLocalMigrations(MIGRATIONS_ROOT).length);
  if (count !== expected) {
    throw failure(EXIT.empty, `空库已应用 migration 数量 ${count}，预期 ${expected}`);
  }
  return { databaseName, databaseUrl, env };
}

async function verifyNoHistoryBaseline(resource, scratchDirectory, options) {
  const databaseName = scenarioDatabaseName("baseline");
  await createDatabase(resource, databaseName, options);
  const localMigrations = listLocalMigrations(MIGRATIONS_ROOT);
  const legacyPrefix = localMigrations.slice(0, -1);
  await applyMigrationPrefix(resource, databaseName, legacyPrefix, options);
  const databaseUrl = buildDatabaseUrl(resource, databaseName);
  const env = buildDatabaseEnvironment(databaseUrl);

  await runExpectedFailure(
    "scripts/migrate-deploy.mjs",
    [],
    env,
    { ...options, label: "无 migration 历史的 legacy 库普通 deploy 必须失败" },
    EXIT.baseline,
  );
  const reportPath = path.join(scratchDirectory, "baseline-report.json");
  const prefix = legacyPrefix.map(({ name }) => name).join(",");
  await runExpectedSuccess(
    "scripts/migrations/baseline.mjs",
    ["inspect", "--prefix", prefix, "--output", reportPath],
    env,
    { ...options, label: "生成 digest 绑定的 baseline inspect 报告" },
    EXIT.baseline,
  );
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const applyEnv = buildDatabaseEnvironment(databaseUrl, {
    MIGRATION_BASELINE_APPLY_CONFIRM: BASELINE_APPLY_SENTINEL,
    MIGRATION_ALLOWED_DATABASE_IDENTITIES: report.identity.digest,
  });
  await runExpectedSuccess(
    "scripts/migrations/baseline.mjs",
    [
      "apply",
      "--prefix",
      prefix,
      "--report",
      reportPath,
      "--digest",
      report.digest,
    ],
    applyEnv,
    { ...options, label: "显式 apply baseline 后继续 deploy" },
    EXIT.baseline,
  );
}

async function verifyMissingPrehistory(resource, scratchDirectory, options) {
  const databaseName = scenarioDatabaseName("prehistory");
  await createDatabase(resource, databaseName, options);
  const databaseUrl = buildDatabaseUrl(resource, databaseName);
  const env = buildDatabaseEnvironment(databaseUrl);
  await runExpectedSuccess(
    "scripts/migrate-deploy.mjs",
    [],
    env,
    { ...options, label: "准备完整历史库 fixture" },
    EXIT.prehistory,
  );
  await runPsql(resource, {
    ...options,
    databaseName,
    label: "构造缺失 pre-history migration 的历史库",
    command:
      'DELETE FROM "_prisma_migrations" WHERE migration_name = \'20260423000000_initial_schema\'',
    exitCode: EXIT.prehistory,
  });
  const before = await queryScalar(
    resource,
    databaseName,
    'SELECT COUNT(*) FROM "_prisma_migrations" WHERE migration_name = \'20260423000000_initial_schema\'',
    options,
  );
  if (before !== "0") throw failure(EXIT.prehistory, "pre-history fixture 构造失败");

  await runExpectedFailure(
    "scripts/migrate-deploy.mjs",
    [],
    env,
    { ...options, label: "缺失新增前置 migration 时普通 deploy 不得静默接管" },
    EXIT.prehistory,
  );
  const afterFailure = await queryScalar(
    resource,
    databaseName,
    'SELECT COUNT(*) FROM "_prisma_migrations" WHERE migration_name = \'20260423000000_initial_schema\' AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
    options,
  );
  if (afterFailure !== "0") {
    throw failure(EXIT.prehistory, "普通 deploy 静默补记了 pre-history migration");
  }

  const reportPath = path.join(scratchDirectory, "prehistory-report.json");
  await runExpectedSuccess(
    "scripts/migrations/prehistory.mjs",
    ["inspect", "--output", reportPath],
    env,
    { ...options, label: "生成 pre-history inspect 报告" },
    EXIT.prehistory,
  );
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const applyEnv = buildDatabaseEnvironment(databaseUrl, {
    MIGRATION_PREHISTORY_APPLY_CONFIRM: PREHISTORY_APPLY_SENTINEL,
    MIGRATION_ALLOWED_DATABASE_IDENTITIES: report.identity.digest,
    MIGRATION_PREHISTORY_ALLOWED_SCHEMA_HASHES: report.snapshot.schemaHash,
  });
  await runExpectedSuccess(
    "scripts/migrations/prehistory.mjs",
    ["apply", "--report", reportPath, "--digest", report.digest],
    applyEnv,
    { ...options, label: "显式补记 pre-history migration 后 deploy" },
    EXIT.prehistory,
  );
}

async function verifyFailedMigration(resource, options) {
  const databaseName = scenarioDatabaseName("failed");
  await createDatabase(resource, databaseName, options);
  const databaseUrl = buildDatabaseUrl(resource, databaseName);
  const env = buildDatabaseEnvironment(databaseUrl);
  await runExpectedSuccess(
    "scripts/migrate-deploy.mjs",
    [],
    env,
    { ...options, label: "准备 failed migration fixture" },
    EXIT.failed,
  );
  await runPsql(resource, {
    ...options,
    databaseName,
    label: "注入 failed migration 记录",
    command: `
      INSERT INTO "_prisma_migrations" (
        id, checksum, migration_name, logs, started_at, applied_steps_count
      ) VALUES (
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        repeat('f', 64),
        '20990101000000_intentional_failure',
        'intentional disposable failure',
        CURRENT_TIMESTAMP,
        0
      )
    `,
    exitCode: EXIT.failed,
  });
  const before = await queryScalar(
    resource,
    databaseName,
    `SELECT checksum || ':' || COALESCE(finished_at::text, 'NULL') || ':' || COALESCE(rolled_back_at::text, 'NULL') FROM "_prisma_migrations" WHERE migration_name = '20990101000000_intentional_failure'`,
    options,
  );
  await runExpectedFailure(
    "scripts/migrate-deploy.mjs",
    [],
    env,
    { ...options, label: "普通 deploy 遇到 failed migration 必须失败" },
    EXIT.failed,
  );
  const after = await queryScalar(
    resource,
    databaseName,
    `SELECT checksum || ':' || COALESCE(finished_at::text, 'NULL') || ':' || COALESCE(rolled_back_at::text, 'NULL') FROM "_prisma_migrations" WHERE migration_name = '20990101000000_intentional_failure'`,
    options,
  );
  if (before !== after) {
    throw failure(EXIT.failed, "普通 deploy 改写了 failed migration 历史");
  }
}

async function verifyPgxUrl(databaseEnv, options) {
  const result = await runStage(
    {
      label: "Go rollback preflight 解析特殊字符 DATABASE_URL",
      executable: "go",
      args: ["-C", "worker", "run", "./cmd/rollback-preflight"],
      cwd: PROJECT_ROOT,
      env: databaseEnv,
      capture: true,
    },
    {
      scope: "verify:migrations",
      deadlineAt: options.deadlineAt,
    },
  );
  if (result.code !== 0) {
    if (result.stdout.trim()) console.error(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    throw failure(EXIT.pgx, "Go rollback preflight 无法连接特殊字符 URL");
  }
}

function cleanupScratch(scratchDirectory) {
  if (!scratchDirectory) return true;
  const resolved = path.resolve(scratchDirectory);
  if (
    path.dirname(resolved).toLowerCase() !== SCRATCH_PARENT.toLowerCase() ||
    !path.basename(resolved).startsWith(SCRATCH_PREFIX)
  ) {
    console.error(`拒绝清理非 runner 临时目录：${resolved}`);
    return false;
  }
  try {
    rmSync(resolved, { recursive: true, force: true });
    return !existsSync(resolved);
  } catch (error) {
    console.error(`临时目录清理失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function main() {
  const runnerDeadlineAt = Date.now() + GLOBAL_DEADLINE_MS;
  const workDeadlineAt = runnerDeadlineAt - CLEANUP_RESERVE_MS;
  const options = {
    scope: "verify:migrations",
    deadlineAt: workDeadlineAt,
  };
  const resource = createPostgresResource({
    prefix: "narra-migrations-pg-",
    ownerLabelKey: "com.narra.migrations.owner",
    image: IMAGE,
  });
  let scratchDirectory;
  let exitCode = EXIT.success;
  try {
    assertFixedTargets(
      PROJECT_ROOT,
      [
        "scripts/migrate-deploy.mjs",
        "scripts/migrations/baseline.mjs",
        "scripts/migrations/prehistory.mjs",
        "prisma/migrations/20260423000000_initial_schema/migration.sql",
        "worker/cmd/rollback-preflight",
      ],
      "verify:migrations",
    );
    if (!existsSync(SCRATCH_PARENT)) {
      throw failure(EXIT.preflight, `临时目录父级不存在：${SCRATCH_PARENT}`);
    }
    scratchDirectory = mkdtempSync(path.join(SCRATCH_PARENT, SCRATCH_PREFIX));
    await assertDockerPrerequisites(resource, options);
    await startPostgres(resource, options);
    await waitForPostgres(resource, options);
    const empty = await verifyEmptyDatabase(resource, options);
    await verifyNoHistoryBaseline(resource, scratchDirectory, options);
    await verifyMissingPrehistory(resource, scratchDirectory, options);
    await verifyFailedMigration(resource, options);
    await verifyPgxUrl(empty.env, options);
    console.log(
      `[verify:migrations] 全部场景通过；owner=${resource.ownerToken}`,
    );
  } catch (error) {
    exitCode = Number.isInteger(error?.exitCode)
      ? error.exitCode
      : EXIT.preflight;
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    const cleanupOptions = {
      scope: "verify:migrations:cleanup",
      deadlineAt: runnerDeadlineAt,
    };
    const postgresCleaned = await cleanupPostgres(resource, cleanupOptions);
    const scratchCleaned = cleanupScratch(scratchDirectory);
    if (!postgresCleaned || !scratchCleaned) exitCode = EXIT.cleanup;
  }
  return exitCode;
}

process.exitCode = await main();
