import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import pg from "pg";

import { runPrismaChecked } from "./migration-runtime.mjs";

export const REPORT_SCHEMA_VERSION = 1;
export const DEFAULT_REPORT_TTL_MS = 15 * 60 * 1_000;
export const BASELINE_APPLY_SENTINEL = "APPLY_APPROVED_BASELINE";
export const REPAIR_APPLY_SENTINEL = "APPLY_APPROVED_REPAIR";
export const PREHISTORY_APPLY_SENTINEL = "APPLY_APPROVED_PREHISTORY";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestReport(report) {
  const { digest: _ignored, ...unsigned } = report;
  return sha256(stableStringify(unsigned));
}

export function signReport(report) {
  return { ...report, digest: digestReport(report) };
}

export function verifyReportDigest(report, expectedDigest) {
  if (!report || typeof report !== "object") {
    throw new Error("报告格式无效");
  }
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error(`不支持的报告版本：${report.schemaVersion}`);
  }
  const actualDigest = digestReport(report);
  if (report.digest !== actualDigest || expectedDigest !== actualDigest) {
    throw new Error("报告 digest 不匹配，拒绝使用被修改或传错的报告");
  }
}

export function assertReportFresh(report, now = Date.now()) {
  const generatedAt = Date.parse(report.generatedAt);
  const expiresAt = Date.parse(report.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt)) {
    throw new Error("报告时间字段无效");
  }
  if (expiresAt <= generatedAt || now > expiresAt) {
    throw new Error("报告已过期，必须重新 inspect");
  }
  if (generatedAt > now + 60_000) {
    throw new Error("报告生成时间位于未来，拒绝使用");
  }
}

export function redactSensitiveText(value) {
  return String(value ?? "")
    .replace(
      /\b(postgres(?:ql)?):\/\/([^\s:/?#]+):([^\s@/?#]*)@([^\s]+)/gi,
      "$1://[REDACTED]@[REDACTED]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
    .replace(
      /\b(api[_-]?key|authorization|auth[_-]?secret|password)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/([?&](?:token|signature|sig|key|secret)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function parseDatabaseIdentity(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL 不是有效 URL");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL 必须使用 PostgreSQL 协议");
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const schema = parsed.searchParams.get("schema") || "public";
  if (!parsed.hostname || !database || !schema) {
    throw new Error("DATABASE_URL 缺少 host、database 或 schema");
  }
  const identity = {
    protocol: parsed.protocol.replace(/:$/, ""),
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    database,
    schema,
    usernameHash: sha256(decodeURIComponent(parsed.username || "")),
  };
  return { ...identity, digest: sha256(stableStringify(identity)) };
}

export function parseAllowlist(value) {
  return new Set(
    String(value ?? "")
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function assertIdentityAllowlisted(identityDigest, value) {
  const allowlist = parseAllowlist(value);
  if (!allowlist.has(identityDigest)) {
    throw new Error(
      "数据库身份不在 MIGRATION_ALLOWED_DATABASE_IDENTITIES allowlist 中",
    );
  }
}

export function listLocalMigrations(migrationsRoot) {
  if (!existsSync(migrationsRoot)) return [];
  return readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(migrationsRoot, entry.name, "migration.sql")),
    )
    .map((entry) => {
      const sql = readFileSync(
        path.join(migrationsRoot, entry.name, "migration.sql"),
      );
      return { name: entry.name, checksum: sha256(sql) };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function assertContinuousPrefix(prefix, localMigrations) {
  if (!Array.isArray(prefix)) throw new Error("migration prefix 必须是数组");
  if (prefix.length > localMigrations.length) {
    throw new Error("migration prefix 超出本地 migration 数量");
  }
  const expected = localMigrations.slice(0, prefix.length).map(({ name }) => name);
  if (JSON.stringify(prefix) !== JSON.stringify(expected)) {
    throw new Error("baseline 只允许从首个 migration 开始且无缺口的连续前缀");
  }
}

export function classifyMigrationHistory(migrationRows, localMigrations) {
  const localNames = localMigrations.map(({ name }) => name);
  const completedNames = migrationRows
    .filter((row) => row.finishedAt && !row.rolledBackAt)
    .map((row) => row.migrationName)
    .filter((name) => localNames.includes(name))
    .sort(
      (left, right) => localNames.indexOf(left) - localNames.indexOf(right),
    );
  const failed = migrationRows.filter(
    (row) => !row.finishedAt && !row.rolledBackAt,
  );
  if (failed.length > 0) {
    const firstName = localNames[0];
    const onlyFoundationFailed = failed.every(
      (row) => row.migrationName === firstName,
    );
    const laterCompleted = completedNames.some(
      (name) => localNames.indexOf(name) > 0,
    );
    if (onlyFoundationFailed && laterCompleted) return "failed-prehistory";
    return "failed";
  }
  if (completedNames.length === 0) return "untracked";

  const expectedPrefix = localNames.slice(0, completedNames.length);
  if (JSON.stringify(completedNames) === JSON.stringify(expectedPrefix)) {
    return "tracked-prefix";
  }
  if (
    !completedNames.includes(localNames[0]) &&
    completedNames.some((name) => localNames.indexOf(name) > 0)
  ) {
    return "missing-prehistory";
  }
  return "divergent";
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function withClient(databaseUrl, callback) {
  const client = new pg.Client({ connectionString: databaseUrl });
  client.on("error", () => {
    // 调用处通过 Promise 失败处理连接中断。
  });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    try {
      await client.end();
    } catch {
      // 连接已断开时无需覆盖原始错误。
    }
  }
}

async function tableExists(client, schema, tableName) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      ) AS exists
    `,
    [schema, tableName],
  );
  return result.rows[0]?.exists === true;
}

async function collectMigrationRows(client, schema) {
  if (!(await tableExists(client, schema, "_prisma_migrations"))) return [];
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier("_prisma_migrations")}`;
  const result = await client.query(
    `
      SELECT id, checksum, migration_name,
             finished_at, rolled_back_at, started_at,
             applied_steps_count, logs
      FROM ${qualified}
      ORDER BY started_at, migration_name, id
    `,
  );
  return result.rows.map((row) => ({
    id: row.id,
    checksum: row.checksum,
    migrationName: row.migration_name,
    finishedAt: row.finished_at?.toISOString?.() ?? null,
    rolledBackAt: row.rolled_back_at?.toISOString?.() ?? null,
    startedAt: row.started_at?.toISOString?.() ?? null,
    appliedStepsCount: Number(row.applied_steps_count ?? 0),
    logsHash: sha256(row.logs ?? ""),
    logsPreview: redactSensitiveText(row.logs ?? "").slice(0, 500),
  }));
}

async function collectSchemaCatalog(client, schema) {
  const tables = await client.query(
      `
        SELECT table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name, table_type
      `,
      [schema],
    );
  const columns = await client.query(
      `
        SELECT table_name, ordinal_position, column_name, data_type, udt_name,
               is_nullable, column_default, character_maximum_length,
               numeric_precision, numeric_scale, datetime_precision
        FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position
      `,
      [schema],
    );
  const enums = await client.query(
      `
        SELECT t.typname AS enum_name, e.enumsortorder, e.enumlabel
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = $1
        ORDER BY t.typname, e.enumsortorder
      `,
      [schema],
    );
  const constraints = await client.query(
      `
        SELECT c.conname, c.contype, rel.relname AS table_name,
               pg_get_constraintdef(c.oid, true) AS definition
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        LEFT JOIN pg_class rel ON rel.oid = c.conrelid
        WHERE n.nspname = $1
        ORDER BY rel.relname, c.conname
      `,
      [schema],
    );
  const indexes = await client.query(
      `
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = $1
        ORDER BY tablename, indexname
      `,
      [schema],
    );
  const triggers = await client.query(
      `
        SELECT rel.relname AS table_name, trg.tgname,
               pg_get_triggerdef(trg.oid, true) AS definition
        FROM pg_trigger trg
        JOIN pg_class rel ON rel.oid = trg.tgrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = $1 AND NOT trg.tgisinternal
        ORDER BY rel.relname, trg.tgname
      `,
      [schema],
    );
  const functions = await client.query(
      `
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
               pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1
        ORDER BY p.proname, arguments
      `,
      [schema],
    );
  return {
    tables: tables.rows,
    columns: columns.rows,
    enums: enums.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
    functions: functions.rows,
  };
}

export async function collectDatabaseSnapshot(databaseUrl) {
  const configuredIdentity = parseDatabaseIdentity(databaseUrl);
  return withClient(databaseUrl, async (client) => {
    const actual = await client.query(
      `
        SELECT current_database() AS database,
               current_user AS username,
               inet_server_addr()::text AS server_address,
               inet_server_port() AS server_port
      `,
    );
    const actualRow = actual.rows[0];
    if (actualRow.database !== configuredIdentity.database) {
      throw new Error("DATABASE_URL 数据库名与实际连接目标不一致");
    }

    const schemaCatalog = await collectSchemaCatalog(
      client,
      configuredIdentity.schema,
    );
    const migrationRows = await collectMigrationRows(
      client,
      configuredIdentity.schema,
    );
    const identity = {
      ...configuredIdentity,
      serverAddress: actualRow.server_address || configuredIdentity.host,
      serverPort: String(actualRow.server_port || configuredIdentity.port),
      actualUsernameHash: sha256(actualRow.username ?? ""),
    };
    identity.digest = sha256(stableStringify(identity));

    return {
      identity,
      schemaHash: sha256(stableStringify(schemaCatalog)),
      schemaTableCount: schemaCatalog.tables.filter(
        (table) => table.table_name !== "_prisma_migrations",
      ).length,
      migrationHistoryHash: sha256(stableStringify(migrationRows)),
      migrationRows,
    };
  });
}

export async function collectPrismaDiff(options) {
  const result = await runPrismaChecked(
    [
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ],
    {
      databaseUrl: options.databaseUrl,
      capture: true,
      label: "读取目标数据库与 Prisma schema 差异",
      scope: options.scope ?? "migration-inspect",
      runCommand: options.runCommand,
    },
  ).catch((error) => {
    if (error.exitCode === 2 && error.commandResult) return error.commandResult;
    throw error;
  });

  const output = redactSensitiveText(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  ).trim();
  return {
    exitCode: result.code,
    inSync: result.code === 0,
    outputHash: sha256(output),
    summary: output.slice(0, 2_000),
  };
}

export async function buildInspectionReport(options) {
  const generatedAt = new Date(options.now ?? Date.now());
  const localMigrations = listLocalMigrations(options.migrationsRoot);
  assertContinuousPrefix(options.prefix, localMigrations);
  const databaseSnapshot = await (
    options.collectSnapshot ?? collectDatabaseSnapshot
  )(options.databaseUrl);
  const prismaDiff = await (options.collectDiff ?? collectPrismaDiff)({
    ...options,
    databaseUrl: options.databaseUrl,
  });
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    operation: options.operation,
    generatedAt: generatedAt.toISOString(),
    expiresAt: new Date(
      generatedAt.getTime() + (options.ttlMs ?? DEFAULT_REPORT_TTL_MS),
    ).toISOString(),
    nonce: options.nonce ?? randomUUID(),
    identity: databaseSnapshot.identity,
    snapshot: {
      schemaHash: databaseSnapshot.schemaHash,
      schemaTableCount: databaseSnapshot.schemaTableCount,
      migrationHistoryHash: databaseSnapshot.migrationHistoryHash,
      migrationRows: databaseSnapshot.migrationRows,
      localMigrations,
      localMigrationsHash: sha256(stableStringify(localMigrations)),
      prismaDiff,
    },
    candidatePrefix: options.prefix,
  };
  return signReport(report);
}

export function assertSnapshotUnchanged(report, current) {
  const expected = {
    identityDigest: report.identity.digest,
    schemaHash: report.snapshot.schemaHash,
    migrationHistoryHash: report.snapshot.migrationHistoryHash,
    localMigrationsHash: report.snapshot.localMigrationsHash,
    prismaDiffExitCode: report.snapshot.prismaDiff.exitCode,
    prismaDiffOutputHash: report.snapshot.prismaDiff.outputHash,
  };
  const actual = {
    identityDigest: current.identity.digest,
    schemaHash: current.snapshot.schemaHash,
    migrationHistoryHash: current.snapshot.migrationHistoryHash,
    localMigrationsHash: current.snapshot.localMigrationsHash,
    prismaDiffExitCode: current.snapshot.prismaDiff.exitCode,
    prismaDiffOutputHash: current.snapshot.prismaDiff.outputHash,
  };
  if (stableStringify(expected) !== stableStringify(actual)) {
    throw new Error("数据库身份、schema、migration 历史或本地 checksum 已变化");
  }
}

export function writeReport(report, outputPath) {
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export function readReport(reportPath) {
  return JSON.parse(readFileSync(reportPath, "utf8"));
}

export function parseArguments(argv) {
  const [mode, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`无法识别参数：${token}`);
    const equalIndex = token.indexOf("=");
    const key = token.slice(2, equalIndex === -1 ? undefined : equalIndex);
    const inlineValue = equalIndex === -1 ? undefined : token.slice(equalIndex + 1);
    const value = inlineValue ?? rest[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 --${key} 缺少值`);
    }
    if (values[key] !== undefined) throw new Error(`参数 --${key} 重复`);
    values[key] = value;
  }
  return { mode, values };
}

export function parsePrefix(value) {
  if (value === undefined || value === "") return [];
  const prefix = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (new Set(prefix).size !== prefix.length) {
    throw new Error("migration prefix 含重复项");
  }
  return prefix;
}
