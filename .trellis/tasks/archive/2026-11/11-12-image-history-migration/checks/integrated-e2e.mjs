// Run every default release scenario, adding actual prior-Worker proof to the
// image scenarios. No default scenario or assertion is replaced or skipped.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../../../../scripts/verify-e2e.mjs";
import { runStage } from "../../../../scripts/lib/command-runner.mjs";
import { previousWorkerVerifier } from "./previous-worker.mjs";
import { buildWithCachedDependencies, buildWorkerWithDependencyRetries } from "./cached-dependencies.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const owner = JSON.parse(readFileSync(path.join(path.dirname(root), "owner.json"), "utf8"));
assert.equal(owner.kind, "image-storage-foundation-local-v1");
assert.equal(owner.workspace, root);
process.exitCode = await main({
  imageHistoryVerifier: previousWorkerVerifier(path.dirname(root)),
  run: async (command, options) => {
    if (command.label === "Build owned app image") return buildWithCachedDependencies(command, options, runStage, root);
    if (command.label === "Build owned worker image") return buildWorkerWithDependencyRetries(command, options, runStage, root);
    return runStage(command, options);
  },
});
