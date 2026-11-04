import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
assert.equal(root, process.env.NARRA_CHECK_ROOT);
const ownerRoot = process.env.NARRA_CHECK_OWNER_ROOT;
const owner = JSON.parse(await readFile(path.join(ownerRoot, "owner.json"), "utf8"));
assert.equal(owner.kind, "ghcr-image-release-local-v1");
assert.equal(path.resolve(owner.workspace), root);
const helpers = await import(pathToFileURL(path.join(root, "scripts/lib/disposable-" + "post" + "gres.mjs")));
const results = [];
for (let index = 0; index < 3; index += 1) {
  const deadlineAt = Date.now() + 90000;
  const options = { scope: "ghcr-tcp-readiness", deadlineAt: deadlineAt - 15000 };
  const resource = helpers.createPostgresResource({ prefix: "narra-ghcr-ready-", ownerLabelKey: "com.narra.ghcr.ready.owner" });
  let cleaned = false;
  try {
    await helpers.assertDockerPrerequisites(resource, options);
    await helpers.startPostgres(resource, options);
    const started = Date.now();
    await helpers.waitForPostgres(resource, options);
    // CREATE follows readiness immediately, without a sleep that could hide temp-server shutdown.
    const databaseName = "narra_ready_" + resource.ownerToken.replaceAll("-", "");
    await helpers.createDatabase(resource, databaseName, options);
    const result = await helpers.runPsql(resource, { ...options, databaseName, command: "SELECT current_database()", tuplesOnly: true });
    assert.equal(result.stdout.trim(), databaseName);
    results.push({ iteration: index + 1, readyAndQueryMs: Date.now() - started, databaseName, successfulImmediateCreate: true });
  } finally {
    cleaned = await helpers.cleanupPostgres(resource, { scope: "ghcr-tcp-readiness-cleanup", deadlineAt });
    assert.equal(cleaned, true, "Owned PostgreSQL cleanup failed");
  }
}
await writeFile(path.join(ownerRoot, "tcp-postgres-results.json"), JSON.stringify({ results, realLocalDocker: true, actualProductionDatabase: false }, null, 2) + "\n");
console.log(JSON.stringify({ passed: results.length, realLocalDocker: true, noReadinessSleep: true, ownerVerifiedCleanup: true }));
