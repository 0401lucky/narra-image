#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

import pg from "pg";

import {
  assertIdentityAllowlisted,
  assertReportFresh,
  assertSnapshotUnchanged,
  buildInspectionReport,
  listLocalMigrations,
  parseAllowlist,
  parseArguments,
  readReport,
  REPAIR_APPLY_SENTINEL,
  signReport,
  verifyReportDigest,
  writeReport,
} from "../lib/migration-safety.mjs";
import {
  describeError,
  prepareDatabase,
  PROJECT_ROOT,
  runPrismaChecked,
} from "../lib/migration-runtime.mjs";
import { REPAIR_RULES } from "./repair-allowlist.mjs";

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

function failedRows(report) {
  return report.snapshot.migrationRows.filter(
    (row) => !row.finishedAt && !row.rolledBackAt,
  );
}

export function buildRepairSuggestions(report) {
  return failedRows(report).map((row) => {
    const rule = REPAIR_RULES[row.migrationName];
    const local = report.snapshot.localMigrations.find(
      (migration) => migration.name === row.migrationName,
    );
    const actionable =
      Boolean(rule) &&
      Boolean(local) &&
      row.checksum === rule.checksum &&
      local.checksum === rule.checksum;
    return {
      migrationName: row.migrationName,
      databaseChecksum: row.checksum,
      localChecksum: local?.checksum ?? null,
      logsHash: row.logsHash,
      logsPreview: row.logsPreview,
      action: actionable ? rule.action : null,
      description: actionable ? rule.description : "没有匹配的精确 repair allowlist",
      actionable,
    };
  });
}

async function buildRepairReport(databaseUrl, dependencies = {}, scope) {
  const localMigrations = listLocalMigrations(MIGRATIONS_ROOT);
  const base = await (dependencies.buildReport ?? buildInspectionReport)({
    operation: "repair",
    databaseUrl,
    migrationsRoot: MIGRATIONS_ROOT,
    prefix: localMigrations.map(({ name }) => name),
    scope,
  });
  const { digest: _digest, ...unsigned } = base;
  return signReport({
    ...unsigned,
    repairSuggestions: buildRepairSuggestions(base),
  });
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function completeGenerationImageOptions(databaseUrl, schema) {
  const client = new pg.Client({ connectionString: databaseUrl });
  client.on("error", () => {
    // 连接错误由事务调用处处理。
  });
  await client.connect();
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier("GenerationJob")}`;
  try {
    await client.query("BEGIN");
    await client.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "quality" TEXT NOT NULL DEFAULT 'auto'`,
    );
    await client.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "outputFormat" TEXT NOT NULL DEFAULT 'png'`,
    );
    await client.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "outputCompression" INTEGER`,
    );
    await client.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "moderation" TEXT NOT NULL DEFAULT 'auto'`,
    );
    await client.query(`UPDATE ${table} SET "quality" = 'auto' WHERE "quality" IS NULL`);
    await client.query(
      `UPDATE ${table} SET "outputFormat" = 'png' WHERE "outputFormat" IS NULL`,
    );
    await client.query(
      `UPDATE ${table} SET "moderation" = 'auto' WHERE "moderation" IS NULL`,
    );
    await client.query(`ALTER TABLE ${table} ALTER COLUMN "quality" SET DEFAULT 'auto'`);
    await client.query(`ALTER TABLE ${table} ALTER COLUMN "quality" SET NOT NULL`);
    await client.query(
      `ALTER TABLE ${table} ALTER COLUMN "outputFormat" SET DEFAULT 'png'`,
    );
    await client.query(`ALTER TABLE ${table} ALTER COLUMN "outputFormat" SET NOT NULL`);
    await client.query(
      `ALTER TABLE ${table} ALTER COLUMN "moderation" SET DEFAULT 'auto'`,
    );
    await client.query(`ALTER TABLE ${table} ALTER COLUMN "moderation" SET NOT NULL`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function executeRepairAction(suggestion, report, databaseUrl, dependencies) {
  if (suggestion.action !== "complete-generation-image-options-v1") {
    throw new Error(`未知或未授权的 repair action：${suggestion.action}`);
  }
  await (dependencies.completeGenerationImageOptions ??
    completeGenerationImageOptions)(databaseUrl, report.identity.schema);
}

async function inspect(values, env, dependencies) {
  assertKnownArguments(values, new Set(["output"]));
  const report = await buildRepairReport(
    requireDatabaseUrl(env),
    dependencies,
    "migration-repair:inspect",
  );
  if (values.output) {
    (dependencies.writeReport ?? writeReport)(report, path.resolve(values.output));
    console.log(`[migration-repair] inspect 报告已写入 ${values.output}`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  return 0;
}

async function apply(values, env, dependencies) {
  assertKnownArguments(
    values,
    new Set(["report", "digest", "migration"]),
  );
  if (env.MIGRATION_REPAIR_APPLY_CONFIRM !== REPAIR_APPLY_SENTINEL) {
    throw new Error(
      `缺少 MIGRATION_REPAIR_APPLY_CONFIRM=${REPAIR_APPLY_SENTINEL}`,
    );
  }
  if (!values.report || !values.digest || !values.migration) {
    throw new Error("apply 必须提供 --report、--digest 与 --migration");
  }

  const databaseUrl = requireDatabaseUrl(env);
  const report = (dependencies.readReport ?? readReport)(
    path.resolve(values.report),
  );
  if (report.operation !== "repair") throw new Error("报告不是 repair inspect");
  verifyReportDigest(report, values.digest);
  assertReportFresh(report);
  assertIdentityAllowlisted(
    report.identity.digest,
    env.MIGRATION_ALLOWED_DATABASE_IDENTITIES,
  );
  if (!parseAllowlist(env.MIGRATION_REPAIR_ALLOWED_SCHEMA_HASHES).has(
    report.snapshot.schemaHash,
  )) {
    throw new Error(
      "前置 schema hash 不在 MIGRATION_REPAIR_ALLOWED_SCHEMA_HASHES allowlist 中",
    );
  }

  const suggestion = report.repairSuggestions.find(
    (item) => item.migrationName === values.migration,
  );
  if (!suggestion?.actionable) {
    throw new Error("目标 failed migration 没有精确匹配的 repair allowlist");
  }

  const current = await buildRepairReport(
    databaseUrl,
    dependencies,
    "migration-repair:apply-reinspect",
  );
  assertSnapshotUnchanged(report, current);
  const currentSuggestion = current.repairSuggestions.find(
    (item) => item.migrationName === values.migration,
  );
  if (
    !currentSuggestion?.actionable ||
    currentSuggestion.databaseChecksum !== suggestion.databaseChecksum ||
    currentSuggestion.logsHash !== suggestion.logsHash
  ) {
    throw new Error("failed migration 行、checksum 或日志已变化");
  }

  await executeRepairAction(suggestion, report, databaseUrl, dependencies);
  await (dependencies.runPrisma ?? runPrismaChecked)(
    ["migrate", "resolve", "--applied", values.migration],
    {
      databaseUrl,
      label: `精确标记 repaired migration ${values.migration}`,
      scope: "migration-repair:apply",
    },
  );
  await (dependencies.prepareDatabase ?? prepareDatabase)({ databaseUrl });

  const final = await buildRepairReport(
    databaseUrl,
    dependencies,
    "migration-repair:verify",
  );
  if (failedRows(final).length > 0) {
    throw new Error("repair 后仍存在未决 failed migration");
  }
  if (!final.snapshot.prismaDiff.inSync) {
    throw new Error("repair 后 schema diff 仍不为零");
  }
  console.log("[migration-repair] repair、deploy 与 schema 校验完成");
  return 0;
}

export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const { mode, values } = parseArguments(argv);
  if (mode === "inspect") return inspect(values, env, dependencies);
  if (mode === "apply") return apply(values, env, dependencies);
  throw new Error(
    "用法: node scripts/migrations/repair.mjs <inspect|apply> [--output/report/digest/migration value]",
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`[migration-repair] ${describeError(error)}`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 2;
  }
}
