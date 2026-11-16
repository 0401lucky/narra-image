import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand, runStage } from "../../../../scripts/lib/command-runner.mjs";
import { LocalDockerSession } from "../../../../scripts/lib/local-docker-safety.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ownerRoot = path.dirname(root);
const owner = JSON.parse(readFileSync(path.join(ownerRoot, "owner.json"), "utf8"));
assert.equal(owner.kind, "image-storage-foundation-local-v1");
assert.equal(owner.workspace, root);
const manifest = JSON.parse(readFileSync(path.join(ownerRoot, "source-manifest.json"), "utf8"));
const session = new LocalDockerSession();
const options = { scope: "image-history:linux-tests", deadlineAt: Date.now() + 240_000 };
const name = `narra-history-tests-${session.owner}`;
let containerId;
let exitCode = 0;
const hash = (data) => createHash("sha256").update(data).digest("hex");

async function docker(args, label, timeoutMs = 10_000) {
  const result = await runStage({ executable: "docker", ...session.command(args), label, timeoutMs, capture: true }, options);
  if (result.code !== 0) throw new Error(`${label} failed (${result.code}): ${result.stderr}`);
  return result.stdout.trim();
}

async function inspectOwned() {
  const [record] = JSON.parse(await docker(["container", "inspect", containerId], "Verify exact Linux test container"));
  assert.equal(record.Id, containerId);
  assert.equal(record.Name, `/${name}`);
  assert.equal(record.Config.Labels["com.narra.history-tests.owner"], session.owner);
  assert.equal(record.HostConfig.NetworkMode, "none");
  assert.equal(record.HostConfig.ReadonlyRootfs, true);
  const requestedMounts = record.HostConfig.Mounts;
  assert.equal(requestedMounts?.length, 1);
  assert.equal(requestedMounts[0].Type, "bind");
  assert.equal(requestedMounts[0].Source, session.workspace.directory);
  assert.equal(requestedMounts[0].Target, "/proof");
  assert.equal(requestedMounts[0].ReadOnly, true);
  const mount = record.Mounts.find((entry) => entry.Destination === "/proof");
  assert(mount && mount.Type === "bind" && mount.RW === false);
  assert(record.Mounts.every((entry) => entry === mount || (entry.Type === "tmpfs" && entry.Destination === "/tmp")));
  return record;
}

try {
  await session.pin(async (args) => {
    const result = await runCommand({ executable: "docker", ...session.command(args), capture: true, timeoutMs: 10_000 });
    if (result.code !== 0) throw new Error("Cannot pin local Docker endpoint");
    return result.stdout.trim();
  });
  const [image] = JSON.parse(await docker(["image", "inspect", "node:24.22.1-alpine"], "Require preinstalled Linux image"));
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(image.Os, "linux");
  assert.equal(image.Architecture, "amd64");
  session.prepare();
  for (const [relative, entry] of Object.entries(manifest.files)) {
    if (!relative.startsWith("contracts/") || !relative.endsWith(".json")) continue;
    assert.equal(hash(readFileSync(path.join(root, relative))), entry.sha256);
    const target = path.join(session.workspace.directory, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, relative), target);
  }
  const binary = path.join(session.workspace.directory, "image-history-tests");
  // This entry is run only by isolated.py; its inherited environment is the
  // launcher's credential allowlist, including the pinned Go module caches.
  const built = await runStage({
    executable: "go", args: ["test", "-c", "-trimpath", "-o", binary, "./cmd/image-history"],
    cwd: path.join(root, "worker"), env: { ...process.env, GOOS: "linux", GOARCH: "amd64", CGO_ENABLED: "0" },
    label: "Build the complete Linux image-history command test binary", timeoutMs: 150_000, capture: true,
  }, options);
  if (built.code !== 0) throw new Error(`Linux test compilation failed (${built.code}): ${built.stderr}`);
  const binarySha256 = hash(readFileSync(binary));
  containerId = await docker(["container", "create", "--pull=never", "--name", name,
    "--label", `com.narra.history-tests.owner=${session.owner}`, "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "512m", "--pids-limit", "128",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m", "--mount", `type=bind,source=${session.workspace.directory},target=/proof,readonly`,
    "--workdir", "/proof", image.Id, "/proof/image-history-tests", "-test.v", "-test.timeout=45s"], "Create isolated Linux history tests");
  assert.match(containerId, /^[a-f0-9]{64}$/);
  await inspectOwned();
  console.log(await docker(["container", "start", "--attach", containerId], "Run actual inotify dry-run and command tests", 60_000));
  const completed = await inspectOwned();
  assert.equal(completed.State.Status, "exited");
  assert.equal(completed.State.ExitCode, 0);
  console.log(JSON.stringify({ linuxHistoryCommandTests: "passed", binarySha256, image: image.Id,
    actualFilesystemMutationObserver: "inotify", network: "none", businessCredentials: false }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Linux history command tests failed");
  exitCode = 1;
} finally {
  options.deadlineAt = Date.now() + 30_000;
  try {
    if (containerId) {
      await inspectOwned();
      await docker(["container", "rm", "--force", containerId], "Remove the exact owned Linux test container");
    }
    if (!session.cleanup()) exitCode = 8;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Linux test cleanup failed");
    exitCode = 8;
  }
}
process.exitCode = exitCode;
