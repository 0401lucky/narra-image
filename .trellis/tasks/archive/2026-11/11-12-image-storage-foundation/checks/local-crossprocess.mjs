import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand, runStage } from "../../../../scripts/lib/command-runner.mjs";
import { LocalDockerSession } from "../../../../scripts/lib/local-docker-safety.mjs";

const CHECKS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CHECKS, "../../../..");
const session = new LocalDockerSession();
const options = { scope: "images:linux-crossprocess", deadlineAt: Date.now() + 300_000 };
const containers = [];
let exitCode = 0;

async function docker(args, label, timeoutMs = 30_000) {
  const command = session.command(args);
  const result = await runStage({ executable: "docker", ...command, capture: true, label, timeoutMs }, options);
  if (result.stdout.trim() && !args.includes("inspect")) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (result.code !== 0) throw new Error(`${label} failed: ${result.code}`);
  return result.stdout.trim();
}

async function identity(container) {
  const [actual] = JSON.parse(await docker(["container", "inspect", container.id], "Verify exact proof container identity"));
  assert.equal(actual.Id, container.id);
  assert.equal(actual.Name, `/${container.name}`);
  assert.equal(actual.Config.Labels["com.narra.image-io.owner"], session.owner);
}

async function processInContainer(image, nameSuffix, command, variables = []) {
  const container = { name: `narra-image-io-${session.owner}-${nameSuffix}`, id: null };
  containers.push(container);
  container.id = await docker([
    "container", "create", "--pull=never", "--name", container.name,
    "--label", `com.narra.image-io.owner=${session.owner}`, "--network", "none", "--read-only",
    "--user", "0:0", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m", "--mount", `type=bind,source=${session.workspace.directory},target=/proof`,
    ...variables.flatMap((value) => ["--env", value]), image, ...command,
  ], `Create ${nameSuffix}`);
  assert.match(container.id, /^[a-f0-9]{64}$/);
  await identity(container);
  await docker(["container", "start", "--attach", container.id], `Run ${nameSuffix}`, 150_000);
  const [finished] = JSON.parse(await docker(["container", "inspect", container.id], `Check ${nameSuffix} exit status`));
  assert.equal(finished.State.Status, "exited");
  assert.equal(finished.State.ExitCode, 0);
}

try {
  await session.pin(async (args) => {
    const result = await runCommand({ executable: "docker", ...session.command(args), capture: true, timeoutMs: 10_000 });
    if (result.code !== 0) throw new Error("Cannot verify local Docker context");
    return result.stdout.trim();
  });
  const images = {};
  for (const [kind, tag] of Object.entries({ node: "node:24.22.1-alpine", go: "golang:1.25-alpine" })) {
    const [image] = JSON.parse(await docker(["image", "inspect", tag], `Require preinstalled ${tag}`));
    assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
    images[kind] = image.Id;
  }
  session.prepare();
  mkdirSync(path.join(session.workspace.directory, "images"));
  const empty = path.join(session.workspace.directory, "server-only.mjs");
  writeFileSync(empty, "export {};\n", { flag: "wx" });
  const require = createRequire(realpathSync(path.join(ROOT, "node_modules/tsx/package.json")));
  require("esbuild").buildSync({
    entryPoints: [path.join(CHECKS, "local-crossprocess.ts")],
    outfile: path.join(session.workspace.directory, "node-proof.mjs"),
    absWorkingDir: ROOT, tsconfig: path.join(ROOT, "tsconfig.json"),
    bundle: true, platform: "node", format: "esm", target: "node24", alias: { "server-only": empty },
  });
  const goFiles = ["image_contract.go", "canvas_storage_location.go", "image_local_store.go"];
  for (const file of goFiles) copyFileSync(path.join(ROOT, "worker/internal/worker", file), path.join(session.workspace.directory, file));
  copyFileSync(path.join(CHECKS, "local_crossprocess_test.go"), path.join(session.workspace.directory, "local_crossprocess_test.go"));
  await processInContainer(images.go, "build", ["/usr/local/go/bin/go", "test", "-c", "-o", "/proof/go-proof", ...goFiles.map((file) => `/proof/${file}`), "/proof/local_crossprocess_test.go"], ["GOENV=off", "GOTOOLCHAIN=local", "GOWORK=off", "GO111MODULE=off", "GOCACHE=/tmp/go-cache", "CGO_ENABLED=0"]);
  await processInContainer(images.node, "node-write", ["node", "/proof/node-proof.mjs", "initialize"]);
  await processInContainer(images.node, "go-write", ["/proof/go-proof", "-test.v", "-test.timeout=30s"], ["NARRA_LOCAL_IO_PHASE=read-node-write-go"]);
  await processInContainer(images.node, "node-read", ["node", "/proof/node-proof.mjs", "read-after-recreate"]);
  await processInContainer(images.node, "node-delete", ["node", "/proof/node-proof.mjs", "delete-go"]);
  await processInContainer(images.node, "go-delete", ["/proof/go-proof", "-test.v", "-test.timeout=30s"], ["NARRA_LOCAL_IO_PHASE=delete-node"]);
  await processInContainer(images.node, "node-final", ["node", "/proof/node-proof.mjs", "verify-deleted"]);
  console.log(JSON.stringify({ crossProcess: "passed", os: "linux", uid: 0, freshContainers: containers.length,
    storage: "task-owned persistent Docker bind mount", images,
    nodeBundleSha256: createHash("sha256").update(readFileSync(path.join(session.workspace.directory, "node-proof.mjs"))).digest("hex"),
    goBinarySha256: createHash("sha256").update(readFileSync(path.join(session.workspace.directory, "go-proof"))).digest("hex") }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Cross-process proof failed");
  exitCode = 1;
} finally {
  options.deadlineAt = Date.now() + 45_000;
  for (const container of containers.reverse()) {
    if (!container.id) continue;
    try {
      await identity(container);
      await docker(["container", "rm", "--force", container.id], "Remove exact proof container", 10_000);
    } catch (error) { console.error(error.message); exitCode = 8; }
  }
  if (exitCode !== 8 && !session.cleanup()) exitCode = 8;
}
process.exitCode = exitCode;
