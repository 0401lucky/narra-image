#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertFixedTargets, runStage } from "./lib/command-runner.mjs";
import { assertDockerPrerequisites, buildDatabaseUrl, cleanupPostgres, createDatabase, createPostgresResource, runPsql, startPostgres, waitForPostgres } from "./lib/disposable-postgres.mjs";
import { cleanupDisposablePrismaWorkspace, createDisposablePrismaWorkspace, disposableTestEnvironment } from "./lib/disposable-test-environment.mjs";
import { listLocalMigrations } from "./lib/migration-safety.mjs";

export const CANVAS_DB_DEADLINE_MS = 360_000;
export const CANVAS_DB_CLEANUP_RESERVE_MS = 20_000;
export const CANVAS_DB_TEST_TARGET = "src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts";
export const CANVAS_DB_CONFIG_TARGET = "src/tests/integration/canvas-contracts/runner-vitest.config.ts";
export const CANVAS_DB_VITEST_ARGS = ["exec", "vitest", "run", CANVAS_DB_TEST_TARGET, "--config", CANVAS_DB_CONFIG_TARGET, "--reporter=dot", "--testTimeout=15000", "--hookTimeout=15000"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "prisma/migrations");
const CANVAS_MIGRATION = "20261029090000_canvas_v1";
const EXIT = { success: 0, preflight: 2, migration: 3, assertions: 4, cleanup: 8 };

function failure(code, message) { return Object.assign(new Error(message), { exitCode: code }); }

async function checked(command, options, exitCode) {
  const result = await runStage({ ...command, cwd: ROOT, capture: true }, options);
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (result.code !== 0) throw failure(result.code === 124 ? 124 : exitCode, `${command.label} failed (child exit ${result.code})`);
}

async function assertAppliedMigrations(resource, databaseName, expected, options) {
  const result = await runPsql(resource, {
    ...options, databaseName, tuplesOnly: true, label: "Verify complete migration names/checksums",
    command: `SELECT COALESCE(json_agg(json_build_object('name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::json) FROM "_prisma_migrations"`,
  });
  const actual = JSON.parse(result.stdout.trim());
  if (!Array.isArray(actual) || actual.some((entry) => !entry.finished || entry.rolledBack)
    || JSON.stringify(actual.map(({ name, checksum }) => ({ name, checksum }))) !== JSON.stringify(expected)) {
    throw failure(EXIT.migration, "Applied migration set/checksum mismatch; no repair or baseline fallback is permitted");
  }
}

async function prisma(args, configPath, env, options, label) {
  await checked({ label, executable: process.execPath, args: [path.join(ROOT, "node_modules/prisma/build/index.js"), ...args, "--config", configPath], env }, options, EXIT.migration);
}

export async function main() {
  const deadlineAt = Date.now() + CANVAS_DB_DEADLINE_MS;
  const options = { scope: "canvas-contracts:db", deadlineAt: deadlineAt - CANVAS_DB_CLEANUP_RESERVE_MS };
  const resource = createPostgresResource({ prefix: "narra-canvas-contracts-", ownerLabelKey: "com.narra.canvas-contracts.owner", databaseUser: "narra_canvas", image: process.env.CANVAS_CONTRACTS_POSTGRES_IMAGE?.trim() || "postgres:17-alpine" });
  const workspaces = [];
  let exitCode = EXIT.success;
  try {
    assertFixedTargets(ROOT, [CANVAS_DB_TEST_TARGET, CANVAS_DB_CONFIG_TARGET, "src/lib/canvas/schema-probe.ts", "contracts/canvas/v1/schema.json", "node_modules/prisma/build/index.js", "scripts/lib/deny-disposable-env.cjs", `prisma/migrations/${CANVAS_MIGRATION}/migration.sql`], options.scope);
    const migrations = listLocalMigrations(MIGRATIONS);
    const canvasIndex = migrations.findIndex(({ name }) => name === CANVAS_MIGRATION);
    if (canvasIndex < 1) throw failure(EXIT.preflight, "The known canvas migration must follow complete previous history");
    await assertDockerPrerequisites(resource, options);
    await startPostgres(resource, options);
    await waitForPostgres(resource, options);

    const workspace = createDisposablePrismaWorkspace({ prefix: "narra-canvas-contracts-prisma-", parent: process.env.CANVAS_CONTRACTS_TMPDIR?.trim() });
    workspaces.push(workspace);
    const previousPath = path.join(workspace.directory, "previous-migrations");
    mkdirSync(previousPath);
    const lockPath = path.join(MIGRATIONS, "migration_lock.toml");
    if (existsSync(lockPath)) copyFileSync(lockPath, path.join(previousPath, "migration_lock.toml"));
    for (const migration of migrations.slice(0, canvasIndex)) {
      const target = path.join(previousPath, migration.name);
      mkdirSync(target);
      copyFileSync(path.join(MIGRATIONS, migration.name, "migration.sql"), path.join(target, "migration.sql"));
    }
    const previous = createDisposablePrismaWorkspace({ prefix: "narra-canvas-contracts-prisma-", parent: workspace.safeParent, migrationsPath: previousPath });
    workspaces.push(previous);

    for (const scenario of ["full", "additive"]) {
      const databaseName = `narra_canvas_${scenario}_${randomBytes(8).toString("hex")}`;
      await createDatabase(resource, databaseName, options);
      const env = disposableTestEnvironment(buildDatabaseUrl(resource, databaseName), {
        CANVAS_CONTRACTS_REQUIRE_DB: "1", CANVAS_CONTRACTS_OWNER_TOKEN: resource.ownerToken, CANVAS_CONTRACTS_SCENARIO: scenario,
      });
      if (scenario === "full") {
        await prisma(["generate"], workspace.configPath, env, options, "Generate isolated Prisma client (no local .env)");
        await prisma(["validate"], workspace.configPath, env, options, "Validate additive Prisma schema");
      } else {
        await prisma(["migrate", "deploy"], previous.configPath, env, options, "Deploy complete previous history including ban/moderation tail");
        await assertAppliedMigrations(resource, databaseName, migrations.slice(0, canvasIndex), options);
        await runPsql(resource, { ...options, databaseName, label: "Seed retained legacy job/image before canvas migration", command: `
          INSERT INTO "User" (id,email,credits,"updatedAt") VALUES ('canvas_legacy_owner','canvas_legacy@example.test',100,CURRENT_TIMESTAMP);
          INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"updatedAt") VALUES ('canvas_legacy_job','canvas_legacy_owner','BUILT_IN','gpt-image-2','legacy prompt','auto',1,CURRENT_TIMESTAMP);
          INSERT INTO "GenerationImage" (id,"jobId",url) VALUES ('canvas_legacy_image','canvas_legacy_job','https://legacy.invalid/retained.png');` });
      }
      await prisma(["migrate", "deploy"], workspace.configPath, env, options, `${scenario}: deploy canvas/full history without repair`);
      await assertAppliedMigrations(resource, databaseName, migrations, options);
      await runPsql(resource, { ...options, databaseName, label: "Bind disposable database sentinel to this runner", command: `CREATE TABLE "_canvas_contracts_owner" (token UUID PRIMARY KEY); INSERT INTO "_canvas_contracts_owner" VALUES ('${resource.ownerToken}');` });
      await checked({ label: `${scenario}: real canvas DB contracts and fake storage`, executable: "pnpm", args: CANVAS_DB_VITEST_ARGS, env }, options, EXIT.assertions);
    }
  } catch (error) {
    exitCode = error.exitCode ?? EXIT.preflight;
    console.error(error instanceof Error ? error.message : "Canvas DB verification failed");
  } finally {
    const containerCleaned = await cleanupPostgres(resource, { ...options, deadlineAt });
    const directoriesCleaned = workspaces.reverse().map(cleanupDisposablePrismaWorkspace).every(Boolean);
    if (!containerCleaned || !directoriesCleaned) exitCode = EXIT.cleanup;
  }
  return exitCode;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) process.exitCode = await main();
