#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runStage } from "../../../../scripts/lib/command-runner.mjs";
import {
  assertDockerPrerequisites, buildDatabaseUrl, cleanupPostgres, createDatabase,
  createPostgresResource, runPsql, startPostgres, waitForPostgres,
} from "../../../../scripts/lib/disposable-postgres.mjs";
import {
  cleanupDisposablePrismaWorkspace, createDisposablePrismaWorkspace, disposableTestEnvironment,
} from "../../../../scripts/lib/disposable-test-environment.mjs";
import { listLocalMigrations } from "../../../../scripts/lib/migration-safety.mjs";

const CHECKS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CHECKS, "../../../..");
const includeSchemaDiff = process.argv.includes("--schema-diff");
const includeCanvas = process.argv.includes("--canvas") || includeSchemaDiff;
const includeLatest = process.argv.includes("--latest");
const catalogOnly = process.argv.includes("--catalog-only");
let target = includeCanvas ? "20261112100000_canvas_image_storage" : "20261112090000_image_storage";
const deadlineAt = Date.now() + 360_000;
const options = { scope: "image-storage:db-smoke", deadlineAt: deadlineAt - 20_000 };
const resource = createPostgresResource({
  prefix: "narra-image-core-", ownerLabelKey: "com.narra.image-storage.owner",
  databaseUser: "narra_canvas", image: "postgres:17-alpine",
});
const scratch = [];
let exitCode = 0;

try {
  const allMigrations = listLocalMigrations(path.join(ROOT, "prisma/migrations"));
  if (includeLatest) target = allMigrations.at(-1)?.name;
  const targetIndex = allMigrations.findIndex(({ name }) => name === target);
  if (targetIndex < 0) throw new Error("Image storage migration is missing from the captured snapshot");
  const selected = allMigrations.slice(0, targetIndex + 1);
  await assertDockerPrerequisites(resource, options);
  await startPostgres(resource, options);
  await waitForPostgres(resource, options);
  const holder = createDisposablePrismaWorkspace({ prefix: "narra-canvas-contracts-prisma-" });
  scratch.push(holder);
  const selectedPath = path.join(holder.directory, "image-migrations");
  mkdirSync(selectedPath);
  const lock = path.join(ROOT, "prisma/migrations/migration_lock.toml");
  if (existsSync(lock)) copyFileSync(lock, path.join(selectedPath, "migration_lock.toml"));
  for (const migration of selected) {
    const destination = path.join(selectedPath, migration.name);
    mkdirSync(destination);
    copyFileSync(path.join(ROOT, "prisma/migrations", migration.name, "migration.sql"), path.join(destination, "migration.sql"));
  }
  const prisma = createDisposablePrismaWorkspace({ prefix: "narra-canvas-contracts-prisma-", parent: holder.safeParent, migrationsPath: selectedPath });
  scratch.push(prisma);
  const databaseName = `narra_canvas_full_${randomBytes(8).toString("hex")}`;
  await createDatabase(resource, databaseName, options);
  const env = disposableTestEnvironment(buildDatabaseUrl(resource, databaseName), { CANVAS_CONTRACTS_REQUIRE_DB: "1" });
  const migrated = await runStage({
    label: "Deploy complete history through image storage core only",
    executable: process.execPath,
    args: [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", prisma.configPath],
    cwd: ROOT, env, capture: true, timeoutMs: 120_000,
  }, options);
  if (migrated.stdout.trim()) console.log(migrated.stdout.trim());
  if (migrated.stderr.trim()) console.error(migrated.stderr.trim());
  if (migrated.code !== 0) throw new Error(`Migration failed: ${migrated.code}`);
  const applied = await runPsql(resource, {
    ...options, databaseName, tuplesOnly: true, label: "Confirm exact applied migrations and checksums",
    command: `SELECT COALESCE(json_agg(json_build_object('name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::json) FROM "_prisma_migrations"`,
  });
  const actual = JSON.parse(applied.stdout.trim());
  if (actual.some(({ finished, rolledBack }) => !finished || rolledBack)
    || JSON.stringify(actual.map(({ name, checksum }) => ({ name, checksum }))) !== JSON.stringify(selected)) {
    throw new Error("Applied image smoke migration history does not match captured source");
  }
  if (includeSchemaDiff) {
    const difference = await runStage({
      label: "Compare the fully migrated disposable database with the Prisma schema",
      executable: process.execPath,
      args: [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "diff",
        "--from-config-datasource", "--to-schema", path.join(ROOT, "prisma/schema.prisma"),
        "--config", prisma.configPath, "--exit-code"],
      cwd: ROOT, env, capture: true, timeoutMs: 60_000,
    }, options);
    if (difference.stdout.trim()) console.log(difference.stdout.trim());
    if (difference.stderr.trim()) console.error(difference.stderr.trim());
    if (difference.code !== 0) throw new Error(`Prisma schema difference: ${difference.code}`);
  }
  await runPsql(resource, {
    ...options, databaseName, label: "Bind image smoke database ownership sentinel",
    command: `CREATE TABLE "_image_storage_smoke_owner" (token UUID PRIMARY KEY); INSERT INTO "_image_storage_smoke_owner" VALUES ('${resource.ownerToken}');`,
  });
  const ownerRoot = path.dirname(ROOT);
  const owner = JSON.parse(readFileSync(path.join(ownerRoot, "owner.json"), "utf8"));
  if (owner.kind !== "image-storage-foundation-local-v1" || owner.workspace !== ROOT) throw new Error("Snapshot output owner mismatch");
  for (const kind of includeCanvas ? ["media", "canvas"] : ["media"]) {
    const schemaPath = path.join(ROOT, "contracts", kind, "v1/schema.json");
    if (!existsSync(schemaPath)) continue;
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    if (typeof schema.catalogQuery !== "string") throw new Error("Schema catalogue query missing");
    const catalogQuery = kind === "canvas"
      ? `SELECT COALESCE(json_agg(row_to_json(captured)), '[]'::json) FROM (${schema.catalogQuery.trim().replace(/;\s*$/, "")}) AS captured`
      : schema.catalogQuery;
    const catalog = await runPsql(resource, { ...options, databaseName, tuplesOnly: true, label: `${kind}: capture effective PostgreSQL catalogue`, command: catalogQuery });
    const objects = JSON.parse(catalog.stdout.trim());
    if (!Array.isArray(objects) || objects.length === 0) throw new Error("Empty effective catalogue");
    const fileName = `${Date.now()}-${kind}-catalog-${randomBytes(3).toString("hex")}.json`;
    const capturePath = path.join(ownerRoot, "receipts", fileName);
    const bytes = JSON.stringify(objects, null, 2) + "\n";
    writeFileSync(capturePath, bytes, { flag: "wx" });
    console.log(JSON.stringify({ catalog: kind, path: capturePath, objects: objects.length, sha256: createHash("sha256").update(bytes).digest("hex"), migrations: selected }));
  }
  if (!catalogOnly) {
    const result = await runPsql(resource, {
      ...options, databaseName, label: "Real image quota, references and write-state smoke",
      input: `DO $$ BEGIN IF current_database() !~ '^narra_canvas_full_[a-f0-9]{16}$' OR NOT EXISTS (SELECT 1 FROM "_image_storage_smoke_owner" WHERE token = '${resource.ownerToken}'::uuid) THEN RAISE EXCEPTION 'image smoke owner mismatch'; END IF; END $$;\n`
        + readFileSync(path.join(CHECKS, "image-data-smoke.sql"), "utf8"),
    });
    console.log(result.stdout.trim());
    if (includeCanvas) {
      const canvasResult = await runPsql(resource, {
        ...options, databaseName, label: "Canvas LOCAL protocol and reference bridge smoke",
        input: `DO $$ BEGIN IF current_database() !~ '^narra_canvas_full_[a-f0-9]{16}$' OR NOT EXISTS (SELECT 1 FROM "_image_storage_smoke_owner" WHERE token = '${resource.ownerToken}'::uuid) THEN RAISE EXCEPTION 'image smoke owner mismatch'; END IF; END $$;\n`
          + readFileSync(path.join(CHECKS, "canvas-image-smoke.sql"), "utf8"),
      });
      console.log(canvasResult.stdout.trim());
    }
  }
  console.log(JSON.stringify({ imageStorageSmoke: catalogOnly ? "not-run" : "passed", catalogueCaptured: true, migration: target, migrationCount: selected.length, productionAccess: false }));
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : "Image storage smoke failed");
} finally {
  const containerCleaned = await cleanupPostgres(resource, { ...options, deadlineAt });
  const directoriesCleaned = scratch.reverse().map(cleanupDisposablePrismaWorkspace).every(Boolean);
  if (!containerCleaned || !directoriesCleaned) exitCode = 8;
}

process.exitCode = exitCode;
