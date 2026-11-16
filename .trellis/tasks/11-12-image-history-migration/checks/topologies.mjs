// Root-only focused entry inside the audited frozen validation workspace.
// The final release gate still runs every default pnpm verify:e2e scenario.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../../../../scripts/verify-e2e.mjs";
import { previousWorkerVerifier } from "./previous-worker.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const owner = JSON.parse(readFileSync(path.join(path.dirname(root), "owner.json"), "utf8"));
assert.equal(owner.kind, "image-storage-foundation-local-v1");
assert.equal(owner.workspace, root);
process.exitCode = await main({ scenarioLabels: ["image-embedded", "image-dedicated"], imageHistoryVerifier: previousWorkerVerifier(path.dirname(root)) });
