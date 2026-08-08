import assert from "node:assert/strict";
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
