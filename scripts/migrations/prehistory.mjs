#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertIdentityAllowlisted,
  assertReportFresh,
  assertSnapshotUnchanged,
  buildInspectionReport,
  classifyMigrationHistory,
  listLocalMigrations,
  parseAllowlist,
  parseArguments,
  PREHISTORY_APPLY_SENTINEL,
  readReport,
  verifyReportDigest,
  writeReport,
} from "../lib/migration-safety.mjs";
import {
  describeError,
  FOUNDATION_MIGRATION,
  prepareDatabase,
  PROJECT_ROOT,
  runPrismaChecked,
} from "../lib/migration-runtime.mjs";

const MIGRATIONS_ROOT = path.join(PROJECT_ROOT, "prisma", "migrations");
const INITIAL_MIGRATION = FOUNDATION_MIGRATION;

function requireDatabaseUrl(env) {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  return databaseUrl;
}

function assertKnownArguments(values, allowed) {
  const unknown = Object.keys(values).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`无法识别参数：--${unknown.join(", --")}`);
}

async function buildPrehistoryReport(databaseUrl, dependencies, scope) {
  const localMigrations = listLocalMigrations(MIGRATIONS_ROOT);
  const report = await (dependencies.buildReport ?? buildInspectionReport)({
    operation: "prehistory",
    databaseUrl,
    migrationsRoot: MIGRATIONS_ROOT,
    prefix: localMigrations.map(({ name }) => name),
    scope,
  });
  const historyKind = classifyMigrationHistory(
    report.snapshot.migrationRows,
    report.snapshot.localMigrations,
  );
  if (!new Set(["missing-prehistory", "failed-prehistory"]).has(historyKind)) {
    throw new Error(
      `目标不是“后续已应用但初始 migration 缺失”的数据库：${historyKind}`,
    );
  }
  const initial = report.snapshot.localMigrations[0];
  if (initial?.name !== INITIAL_MIGRATION) {
    throw new Error(`本地首个 migration 必须是 ${INITIAL_MIGRATION}`);
  }
  return report;
}

async function inspect(values, env, dependencies) {
  assertKnownArguments(values, new Set(["output"]));
  const report = await buildPrehistoryReport(
    requireDatabaseUrl(env),
    dependencies,
    "migration-prehistory:inspect",
  );
  if (values.output) {
    (dependencies.writeReport ?? writeReport)(report, path.resolve(values.output));
    console.log(`[migration-prehistory] inspect 报告已写入 ${values.output}`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  return 0;
}

async function apply(values, env, dependencies) {
  assertKnownArguments(values, new Set(["report", "digest"]));
  if (env.MIGRATION_PREHISTORY_APPLY_CONFIRM !== PREHISTORY_APPLY_SENTINEL) {
    throw new Error(
      `缺少 MIGRATION_PREHISTORY_APPLY_CONFIRM=${PREHISTORY_APPLY_SENTINEL}`,
    );
  }
  if (!values.report || !values.digest) {
    throw new Error("apply 必须提供 --report 与 --digest");
  }

  const databaseUrl = requireDatabaseUrl(env);
  const report = (dependencies.readReport ?? readReport)(
    path.resolve(values.report),
  );
  if (report.operation !== "prehistory") {
    throw new Error("报告不是 prehistory inspect");
  }
  verifyReportDigest(report, values.digest);
  assertReportFresh(report);
  assertIdentityAllowlisted(
    report.identity.digest,
    env.MIGRATION_ALLOWED_DATABASE_IDENTITIES,
  );
  if (!parseAllowlist(env.MIGRATION_PREHISTORY_ALLOWED_SCHEMA_HASHES).has(
    report.snapshot.schemaHash,
  )) {
    throw new Error(
      "schema hash 不在 MIGRATION_PREHISTORY_ALLOWED_SCHEMA_HASHES allowlist 中",
    );
  }

  const current = await buildPrehistoryReport(
    databaseUrl,
    dependencies,
    "migration-prehistory:apply-reinspect",
  );
  assertSnapshotUnchanged(report, current);
  const foundationFailure = current.snapshot.migrationRows.some(
    (row) =>
      row.migrationName === INITIAL_MIGRATION &&
      !row.finishedAt &&
      !row.rolledBackAt,
  );
  if (foundationFailure) {
    await (dependencies.runPrisma ?? runPrismaChecked)(
      ["migrate", "resolve", "--rolled-back", INITIAL_MIGRATION],
      {
        databaseUrl,
        label: `精确回滚失败的 pre-history 记录 ${INITIAL_MIGRATION}`,
        scope: "migration-prehistory:apply",
      },
    );
  }
  await (dependencies.runPrisma ?? runPrismaChecked)(
    ["migrate", "resolve", "--applied", INITIAL_MIGRATION],
    {
      databaseUrl,
      label: `精确补记 pre-history migration ${INITIAL_MIGRATION}`,
      scope: "migration-prehistory:apply",
    },
  );
  await (dependencies.prepareDatabase ?? prepareDatabase)({ databaseUrl });
  console.log("[migration-prehistory] 初始 migration 已显式补记并完成 deploy");
  return 0;
}

export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const { mode, values } = parseArguments(argv);
  if (mode === "inspect") return inspect(values, env, dependencies);
  if (mode === "apply") return apply(values, env, dependencies);
  throw new Error(
    "用法: node scripts/migrations/prehistory.mjs <inspect|apply> [--output/report/digest value]",
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`[migration-prehistory] ${describeError(error)}`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 2;
  }
}
