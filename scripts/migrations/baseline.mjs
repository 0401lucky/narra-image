#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertContinuousPrefix,
  assertIdentityAllowlisted,
  assertReportFresh,
  assertSnapshotUnchanged,
  BASELINE_APPLY_SENTINEL,
  buildInspectionReport,
  classifyMigrationHistory,
  parseArguments,
  parsePrefix,
  readReport,
  verifyReportDigest,
  writeReport,
} from "../lib/migration-safety.mjs";
import {
  describeError,
  prepareDatabase,
  PROJECT_ROOT,
  runPrismaChecked,
} from "../lib/migration-runtime.mjs";

const MIGRATIONS_ROOT = path.join(PROJECT_ROOT, "prisma", "migrations");

function requireDatabaseUrl(env) {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  return databaseUrl;
}

function assertKnownArguments(values, allowed) {
  const unknown = Object.keys(values).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`无法识别参数：--${unknown.join(", --")}`);
}

async function inspect(values, env, dependencies = {}) {
  assertKnownArguments(values, new Set(["prefix", "output"]));
  const databaseUrl = requireDatabaseUrl(env);
  const prefix = parsePrefix(values.prefix);
  const report = await (dependencies.buildReport ?? buildInspectionReport)({
    operation: "baseline",
    databaseUrl,
    migrationsRoot: MIGRATIONS_ROOT,
    prefix,
    scope: "migration-baseline:inspect",
  });

  const historyKind = classifyMigrationHistory(
    report.snapshot.migrationRows,
    report.snapshot.localMigrations,
  );
  if (historyKind === "missing-prehistory") {
    throw new Error("检测到后续 migration 已应用但初始 migration 缺失，请使用 prehistory 流程");
  }
  if (historyKind === "failed") {
    throw new Error("检测到 failed migration，请使用 repair 流程");
  }
  if (historyKind === "divergent") {
    throw new Error("migration 历史不是连续前缀，拒绝 baseline");
  }

  if (
    prefix.length === 0 &&
    report.snapshot.schemaTableCount > 0 &&
    report.snapshot.migrationRows.length === 0
  ) {
    throw new Error("非空 schema 且无 migration 历史时必须显式提供 --prefix");
  }
  if (values.output) {
    (dependencies.writeReport ?? writeReport)(report, path.resolve(values.output));
    console.log(`[migration-baseline] inspect 报告已写入 ${values.output}`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  return 0;
}

async function apply(values, env, dependencies = {}) {
  assertKnownArguments(values, new Set(["prefix", "report", "digest"]));
  if (env.MIGRATION_BASELINE_APPLY_CONFIRM !== BASELINE_APPLY_SENTINEL) {
    throw new Error(
      `缺少 MIGRATION_BASELINE_APPLY_CONFIRM=${BASELINE_APPLY_SENTINEL}`,
    );
  }
  if (!values.report || !values.digest || values.prefix === undefined) {
    throw new Error("apply 必须提供 --report、--digest 与 --prefix");
  }

  const databaseUrl = requireDatabaseUrl(env);
  const prefix = parsePrefix(values.prefix);
  const report = (dependencies.readReport ?? readReport)(
    path.resolve(values.report),
  );
  if (report.operation !== "baseline") throw new Error("报告不是 baseline inspect");
  verifyReportDigest(report, values.digest);
  assertReportFresh(report);
  if (JSON.stringify(prefix) !== JSON.stringify(report.candidatePrefix)) {
    throw new Error("apply 的 --prefix 与 inspect 报告不一致");
  }
  assertContinuousPrefix(prefix, report.snapshot.localMigrations);
  const historyKind = classifyMigrationHistory(
    report.snapshot.migrationRows,
    report.snapshot.localMigrations,
  );
  if (!new Set(["untracked", "tracked-prefix"]).has(historyKind)) {
    throw new Error(`报告 migration 历史不允许 baseline：${historyKind}`);
  }
  assertIdentityAllowlisted(
    report.identity.digest,
    env.MIGRATION_ALLOWED_DATABASE_IDENTITIES,
  );

  const current = await (dependencies.buildReport ?? buildInspectionReport)({
    operation: "baseline",
    databaseUrl,
    migrationsRoot: MIGRATIONS_ROOT,
    prefix,
    scope: "migration-baseline:apply-reinspect",
  });
  assertSnapshotUnchanged(report, current);

  const completed = new Map(
    report.snapshot.migrationRows
      .filter((row) => row.finishedAt && !row.rolledBackAt)
      .map((row) => [row.migrationName, row]),
  );
  const unresolvedFailures = report.snapshot.migrationRows.filter(
    (row) => !row.finishedAt && !row.rolledBackAt,
  );
  if (unresolvedFailures.length > 0) {
    throw new Error("存在 failed migration，必须使用 repair 流程");
  }

  for (const migrationName of prefix) {
    const local = report.snapshot.localMigrations.find(
      (migration) => migration.name === migrationName,
    );
    const existing = completed.get(migrationName);
    if (existing) {
      if (existing.checksum !== local.checksum) {
        throw new Error(`已应用 migration checksum 不匹配：${migrationName}`);
      }
      continue;
    }
    await (dependencies.runPrisma ?? runPrismaChecked)(
      ["migrate", "resolve", "--applied", migrationName],
      {
        databaseUrl,
        label: `精确 baseline ${migrationName}`,
        scope: "migration-baseline:apply",
      },
    );
  }

  await (dependencies.prepareDatabase ?? prepareDatabase)({ databaseUrl });
  const finalReport = await (dependencies.buildReport ?? buildInspectionReport)({
    operation: "baseline-result",
    databaseUrl,
    migrationsRoot: MIGRATIONS_ROOT,
    prefix: report.snapshot.localMigrations.map(({ name }) => name),
    scope: "migration-baseline:verify",
  });
  if (!finalReport.snapshot.prismaDiff.inSync) {
    throw new Error("baseline apply 后 schema diff 仍不为零");
  }
  console.log("[migration-baseline] baseline apply、deploy 与 schema 校验完成");
  return 0;
}

export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const { mode, values } = parseArguments(argv);
  if (mode === "inspect") return inspect(values, env, dependencies);
  if (mode === "apply") return apply(values, env, dependencies);
  throw new Error(
    "用法: node scripts/migrations/baseline.mjs <inspect|apply> [--prefix a,b] [--output/report/digest value]",
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`[migration-baseline] ${describeError(error)}`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 2;
  }
}
