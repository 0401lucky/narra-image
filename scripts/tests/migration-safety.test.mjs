import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assertContinuousPrefix,
  classifyMigrationHistory,
  assertIdentityAllowlisted,
  assertReportFresh,
  digestReport,
  parseDatabaseIdentity,
  parsePrefix,
  redactSensitiveText,
  signReport,
  verifyReportDigest,
} from "../lib/migration-safety.mjs";
import { buildRepairSuggestions } from "../migrations/repair.mjs";
import { verifyPgxUrl } from "../verify-migrations.mjs";

const migrations = [
  { name: "001_first", checksum: "a" },
  { name: "002_second", checksum: "b" },
  { name: "003_third", checksum: "c" },
];

test("baseline 只接受从首项开始的连续 migration 前缀", () => {
  assert.doesNotThrow(() => assertContinuousPrefix([], migrations));
  assert.doesNotThrow(() =>
    assertContinuousPrefix(["001_first", "002_second"], migrations),
  );
  assert.throws(
    () => assertContinuousPrefix(["002_second"], migrations),
    /连续前缀/,
  );
  assert.throws(
    () => assertContinuousPrefix(["001_first", "003_third"], migrations),
    /连续前缀/,
  );
  assert.throws(() => parsePrefix("001_first,001_first"), /重复/);
});

test("报告 digest 可发现字段篡改并拒绝过期报告", () => {
  const report = signReport({
    schemaVersion: 1,
    operation: "baseline",
    generatedAt: "2026-08-07T00:00:00.000Z",
    expiresAt: "2026-08-07T00:15:00.000Z",
    nonce: "nonce",
    identity: { digest: "identity" },
    snapshot: { schemaHash: "schema" },
    candidatePrefix: ["001_first"],
  });
  assert.equal(report.digest, digestReport(report));
  assert.doesNotThrow(() => verifyReportDigest(report, report.digest));
  assert.throws(
    () => verifyReportDigest({ ...report, candidatePrefix: [] }, report.digest),
    /digest/,
  );
  assert.throws(
    () => assertReportFresh(report, Date.parse("2026-08-07T00:16:00.000Z")),
    /过期/,
  );
});

test("数据库身份不包含密码，apply 必须命中显式 allowlist", () => {
  const identity = parseDatabaseIdentity(
    "postgresql://release_user:p%40ss%3Aword@127.0.0.1:55432/release_db?schema=release",
  );
  assert.equal(identity.database, "release_db");
  assert.equal(identity.schema, "release");
  assert.equal(JSON.stringify(identity).includes("p@ss"), false);
  assert.doesNotThrow(() =>
    assertIdentityAllowlisted(identity.digest, `other,${identity.digest}`),
  );
  assert.throws(
    () => assertIdentityAllowlisted(identity.digest, "other"),
    /allowlist/,
  );
});

test("迁移日志脱敏 DSN、令牌、密码和签名查询参数", () => {
  const redacted = redactSensitiveText(
    "postgresql://user:secret@db:5432/app?schema=public Authorization: Bearer abc.def password=hunter2 https://cdn/x?signature=secret&ok=1",
  );
  assert.doesNotMatch(redacted, /user:secret|abc\.def|hunter2|signature=secret/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("repair 仅对 migration ID、数据库 checksum 与本地 checksum 全匹配时授权", () => {
  const checksum =
    "da8ad72c4a6d853fe9bec52bc1dbd0d267a8e43f59a7a768200d5cee2fafe594";
  const report = {
    snapshot: {
      localMigrations: [
        {
          name: "20260428083000_generation_image_options",
          checksum,
        },
      ],
      migrationRows: [
        {
          migrationName: "20260428083000_generation_image_options",
          checksum,
          finishedAt: null,
          rolledBackAt: null,
          logsHash: "logs",
          logsPreview: "safe",
        },
      ],
    },
  };
  assert.equal(buildRepairSuggestions(report)[0].actionable, true);
  report.snapshot.migrationRows[0].checksum = "changed";
  assert.equal(buildRepairSuggestions(report)[0].actionable, false);
});

test("无历史 baseline 与缺失 pre-history migration 被明确区分", () => {
  const rows = [
    {
      migrationName: "002_second",
      finishedAt: "2026-08-07T00:00:00.000Z",
      rolledBackAt: null,
    },
    {
      migrationName: "003_third",
      finishedAt: "2026-08-07T00:00:01.000Z",
      rolledBackAt: null,
    },
  ];
  assert.equal(classifyMigrationHistory([], migrations), "untracked");
  assert.equal(
    classifyMigrationHistory(rows, migrations),
    "missing-prehistory",
  );
  assert.equal(
    classifyMigrationHistory(
      [
        {
          migrationName: "001_first",
          finishedAt: "2026-08-07T00:00:00.000Z",
          rolledBackAt: null,
        },
      ],
      migrations,
    ),
    "tracked-prefix",
  );
  assert.equal(
    classifyMigrationHistory(
      [
        {
          migrationName: "001_first",
          finishedAt: null,
          rolledBackAt: null,
        },
        ...rows,
      ],
      migrations,
    ),
    "failed-prehistory",
  );
});

function emptyImageRollbackReport() {
  const imageSchema = JSON.parse(readFileSync(new URL("../../contracts/media/v1/schema.json", import.meta.url), "utf8"));
  const canvasSchema = JSON.parse(readFileSync(new URL("../../contracts/canvas/v1/schema.json", import.meta.url), "utf8"));
  return {
    active_v1_jobs: 0,
    active_image_reservations: 0,
    canvas_storage_revision: canvasSchema.storageRevision,
    code: "ROLLBACK_UNSAFE",
    image_storage_revision: imageSchema.storageRevision,
    local_image_objects: 0,
    managed_image_assets: 0,
    schema_version: 1,
    status: "unsafe",
    unresolved_handoffs: 0,
    unresolved_image_objects: 0,
    active_image_history_jobs: 0,
    unresolved_image_history_items: 0,
    unresolved_image_observations: 0,
    active_image_history_holds: 0,
  };
}

function preflightRunner(results) {
  const calls = [];
  return {
    calls,
    run: async (stage, options) => {
      calls.push({ stage, options });
      assert.ok(results.length, "unexpected command after fixture results were consumed");
      return results.shift();
    },
  };
}

test("特殊字符 pgx URL 验证接受可连接但禁止旧 Worker 回滚的新图片空库", async () => {
  const env = { DATABASE_URL: `postgresql://fixture:${encodeURIComponent("fixture @:/?#")}@127.0.0.1:1/fixture?schema=public` };
  const scratch = path.resolve("migration-preflight-fixture");
  const deadlineAt = 123456789;
  const runner = preflightRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 2, stdout: `${JSON.stringify(emptyImageRollbackReport())}\n`, stderr: "" },
  ]);
  await verifyPgxUrl(env, scratch, { deadlineAt }, runner.run);
  assert.equal(runner.calls.length, 2);
  const [build, execute] = runner.calls;
  assert.equal(build.stage.executable, "go");
  assert.deepEqual(build.stage.args.slice(0, 4), ["-C", "worker", "build", "-o"]);
  assert.equal(path.dirname(execute.stage.executable), scratch);
  assert.equal(build.stage.args[4], execute.stage.executable);
  assert.deepEqual(execute.stage.args, []);
  for (const { stage, options } of runner.calls) {
    assert.equal(stage.env.DATABASE_URL, env.DATABASE_URL);
    assert.equal(options.deadlineAt, deadlineAt);
  }
});

test("rollback preflight 构建失败不执行旧程序或把错误当作不安全报告", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const runner = preflightRunner([{ code: 1, stdout: "", stderr: "synthetic build failure" }]);
  await assert.rejects(
    verifyPgxUrl({}, path.resolve("migration-preflight-fixture"), { deadlineAt: 1 }, runner.run),
    { exitCode: 7, message: /构建失败/ },
  );
  assert.equal(runner.calls.length, 1);
});

for (const [name, report, code] of [
  ["旧 safe 报告", { ...emptyImageRollbackReport(), code: "ROLLBACK_SAFE", status: "safe" }, 0],
  ["go run 折叠后的退出码", emptyImageRollbackReport(), 1],
  ["错误图片修订", { ...emptyImageRollbackReport(), image_storage_revision: 0 }, 2],
  ["错误画布修订", { ...emptyImageRollbackReport(), canvas_storage_revision: 0 }, 2],
  ["非空图片清单", { ...emptyImageRollbackReport(), managed_image_assets: 1 }, 2],
  ["未决写入", { ...emptyImageRollbackReport(), unresolved_image_objects: 1 }, 2],
  ["未决历史迁移", { ...emptyImageRollbackReport(), active_image_history_jobs: 1 }, 2],
  ["受保护历史项目", { ...emptyImageRollbackReport(), unresolved_image_history_items: 1 }, 2],
  ["未核实观察", { ...emptyImageRollbackReport(), unresolved_image_observations: 1 }, 2],
  ["未解除接管保护", { ...emptyImageRollbackReport(), active_image_history_holds: 1 }, 2],
  ["未完整检查 schema", { schema_version: 1, code: "PREFLIGHT_FAILED", status: "error" }, 5],
  ["新增未审阅字段", { ...emptyImageRollbackReport(), storage_path: "unexpected" }, 2],
]) {
  test(`特殊字符 pgx URL 验证拒绝${name}`, async (context) => {
    context.mock.method(console, "error", () => undefined);
    const runner = preflightRunner([
      { code: 0, stdout: "", stderr: "" },
      { code, stdout: JSON.stringify(report), stderr: "" },
    ]);
    await assert.rejects(
      verifyPgxUrl({}, path.resolve("migration-preflight-fixture"), { deadlineAt: 1 }, runner.run),
      { exitCode: 7, message: /未证明特殊字符 URL/ },
    );
  });
}

test("特殊字符 pgx URL 验证拒绝非 JSON 的退出 2", async () => {
  const runner = preflightRunner([
    { code: 0, stdout: "", stderr: "" },
    { code: 2, stdout: "database unavailable", stderr: "" },
  ]);
  await assert.rejects(
    verifyPgxUrl({}, path.resolve("migration-preflight-fixture"), { deadlineAt: 1 }, runner.run),
    { exitCode: 7, message: /未返回有效检查报告/ },
  );
});
