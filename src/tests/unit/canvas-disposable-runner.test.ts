// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import rootConfig from "../../../vitest.config";
import canvasConfig from "../integration/canvas-contracts/runner-vitest.config";
import workerConfig from "../integration/worker-contracts/runner-vitest.config";
import { workerBaselineChecksums, workerMigrationPlan, WORKER_ADDITIVE_MIGRATIONS } from "../integration/worker-contracts/migration-plan";
import { assertDisposableTestDatabaseUrl, cleanupDisposablePrismaWorkspace, createDisposablePrismaWorkspace, disposableTestEnvironment } from "../../../scripts/lib/disposable-test-environment.mjs";
import { CANVAS_DB_CLEANUP_RESERVE_MS, CANVAS_DB_DEADLINE_MS, CANVAS_DB_TEST_TARGET, CANVAS_DB_VITEST_ARGS } from "../../../scripts/verify-canvas-contracts-db.mjs";
import { runCommand } from "../../../scripts/lib/command-runner.mjs";

const root = process.cwd();
const url = "postgresql://narra_canvas:disposable@127.0.0.1:19001/narra_canvas_full_0123456789abcdef?schema=public&connect_timeout=3";

describe("canvas independent disposable runner safety", () => {
  it("requires random localhost targets, explicit schemas, and a runner username", () => {
    expect(assertDisposableTestDatabaseUrl(url).hostname).toBe("127.0.0.1");
    for (const candidate of [undefined, "", url.replace("127.0.0.1", "db.example.test"), url.replace("narra_canvas_full_0123456789abcdef", "development"), url.replace(":19001", ""), url.replace("schema=public", "schema=other"), `${url}&host=remote`, url.replace("narra_canvas:", "root:")]) expect(() => assertDisposableTestDatabaseUrl(candidate)).toThrow();
  });

  it("rejects ambiguous connection parameters and another runner's username", () => {
    for (const candidate of [
      `${url}&schema=private`, `${url}&connect_timeout=0`, url.replace("connect_timeout=3", "connect_timeout=0"),
      url.replace("&connect_timeout=3", ""), url.replace("narra_canvas:", "worker_contracts:"),
    ]) expect(() => assertDisposableTestDatabaseUrl(candidate), candidate).toThrow();
    expect(assertDisposableTestDatabaseUrl(url.replace("narra_canvas:", "worker_contracts:").replace("narra_canvas_full_", "worker_contracts_")).username).toBe("worker_contracts");
  });

  it("does not inherit DB/provider/.env configuration or hidden child preload hooks", () => {
    const env = disposableTestEnvironment(url, { CANVAS_CONTRACTS_REQUIRE_DB: "1" }, { PATH: "test-path", DATABASE_URL: "real-db", S3_BUCKET: "real-bucket", S3_SECRET_ACCESS_KEY: "real-key", BUILTIN_PROVIDER_API_KEY: "real-provider", APP_URL: "https://real.example", NODE_OPTIONS: "--require=unsafe.cjs", DOTENV_CONFIG_PATH: ".env.production" }) as NodeJS.ProcessEnv;
    expect(env.DATABASE_URL).toBe(url);
    expect(env.TEST_DATABASE_URL).toBe(url);
    expect(env.S3_BUCKET).toBe("");
    expect(env.S3_SECRET_ACCESS_KEY).toBe("");
    expect(env.BUILTIN_PROVIDER_API_KEY).toBe("");
    expect(env.APP_URL).toBeUndefined();
    expect(env.DOTENV_CONFIG_PATH).toBeUndefined();
    expect(env.NODE_OPTIONS).toContain("deny-disposable-env.cjs");
    expect(env.NODE_OPTIONS).not.toContain("unsafe.cjs");
  });

  it("denies exact .env and .env.* before either synchronous or asynchronous reads", async () => {
    const result = await runCommand({ executable: process.execPath, args: ["--input-type=module", "-e", `
      import assert from 'node:assert/strict'; import fs from 'node:fs';
      for (const file of ['.env','.env.production','.env.local']) {
        assert.equal(fs.existsSync(file),false);
        assert.throws(()=>fs.readFileSync(file),error=>error.code==='ENOENT');
        await assert.rejects(fs.promises.readFile(file),error=>error.code==='ENOENT');
      }
      assert.equal(fs.existsSync('package.json'),true);
    `], env: disposableTestEnvironment(url), capture: true, timeoutMs: 5000 });
    expect(result, result.stderr).toMatchObject({ code: 0, timedOut: false });
  });

  it("uses explicit isolated Prisma config and refuses an unowned cleanup target", () => {
    const workspace = createDisposablePrismaWorkspace({ prefix: "narra-canvas-contracts-prisma-" });
    try {
      const config = readFileSync(workspace.configPath, "utf8");
      expect(config).toContain('env("DATABASE_URL")');
      expect(config).not.toMatch(/loadLocalEnv|\.env/);
      expect(cleanupDisposablePrismaWorkspace({ ...workspace, ownerToken: "wrong-owner" })).toBe(false);
      expect(existsSync(workspace.directory)).toBe(true);
      expect(cleanupDisposablePrismaWorkspace({ ...workspace, directory: workspace.safeParent })).toBe(false);
    } finally { expect(cleanupDisposablePrismaWorkspace(workspace)).toBe(true); }
  });

  it("excludes both sentinel suites normally but the independent wrapper selects the real DB suite", () => {
    expect(rootConfig.test?.exclude).toEqual(expect.arrayContaining(["**/worker-contracts-db.test.ts", "**/canvas-contracts-db.test.ts"]));
    expect(canvasConfig.test?.include).toEqual([CANVAS_DB_TEST_TARGET]);
    expect(canvasConfig.test?.exclude).toEqual([]);
    expect(workerConfig.test?.exclude).toEqual([]);
    expect(canvasConfig.envDir).toBe(false);
    expect(CANVAS_DB_VITEST_ARGS).toContain(CANVAS_DB_TEST_TARGET);
    expect(CANVAS_DB_VITEST_ARGS).toContain("--config");
    expect(CANVAS_DB_DEADLINE_MS).toBeGreaterThan(150000);
    expect(CANVAS_DB_CLEANUP_RESERVE_MS).toBeGreaterThanOrEqual(15000);
    const suite = readFileSync(path.join(root, CANVAS_DB_TEST_TARGET), "utf8");
    expect(suite).toContain('CANVAS_CONTRACTS_REQUIRE_DB !== "1"');
    expect(suite).not.toMatch(/describe\.skip|test\.skip|it\.skip/);
    const wrapper = readFileSync(path.join(root, "scripts/verify-canvas-contracts-db.mjs"), "utf8");
    expect(wrapper).toContain('for (const scenario of ["full", "additive"])');
    expect(wrapper).toContain("assertAppliedMigrations");
    expect(wrapper).not.toMatch(/docker.*pull|verify-worker-contracts\.mjs/);
    expect(readFileSync(path.join(root, ".github/workflows/verify.yml"), "utf8")).toContain("run: pnpm verify:canvas-contracts:db");
  });

  it("checks the immutable pre-worker baseline and accepts all later additive migrations", () => {
    const migrationsRoot = path.join(root, "prisma/migrations");
    const names = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const snapshot = readFileSync(path.join(root, "src/tests/integration/worker-contracts/legacy-schema.sql"), "utf8");
    const markers = [...snapshot.matchAll(/^-- WORKER_CONTRACTS_BASELINE_MIGRATION: (\S+)$/gm)].map((match) => match[1]);
    const plan = workerMigrationPlan(names, markers);
    expect(plan.pendingNames).toEqual(expect.arrayContaining([...WORKER_ADDITIVE_MIGRATIONS, "20260831214800_add_user_ban", "20260901120000_add_content_moderation", "20261029090000_canvas_v1"]));
    expect(plan.baselineNames).toEqual(markers);
    const baseline = workerBaselineChecksums(snapshot, plan.baselineNames, (name) => readFileSync(path.join(migrationsRoot, name, "migration.sql")));
    expect(baseline.map((entry) => entry.name)).toEqual(plan.baselineNames);
    const source = "SELECT 1;\n";
    const checksum = createHash("sha256").update(source).digest("hex");
    const receipt = `'${checksum}', CURRENT_TIMESTAMP, 'fixture'`;
    expect(workerBaselineChecksums(receipt, ["fixture"], () => Buffer.from(source.replaceAll("\n", "\r\n")))).toEqual([{ name: "fixture", checksum }]);
    expect(() => workerBaselineChecksums(receipt, ["fixture"], () => Buffer.from("SELECT 2;\n"))).toThrow();
    expect(() => workerMigrationPlan([...names, "20260424000000_unreviewed_prefix"], markers)).toThrow();
    expect(() => workerMigrationPlan(names, [...markers, "20260831214800_add_user_ban"])).toThrow();
    expect(() => workerMigrationPlan(names.filter((name) => name !== WORKER_ADDITIVE_MIGRATIONS[1]), markers)).toThrow();
  });
});
