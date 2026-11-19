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
const { E2EHarness, createE2EConfiguration } = await import(pathToFileURL(path.join(root, "scripts/lib/e2e-safety.mjs")));
const deadlineAt = Date.now() + 1100000;
const harness = new E2EHarness({ projectRoot: root, configuration: createE2EConfiguration(process.env), deadlineAt: deadlineAt - 120000 });
const images = [];
try {
  await harness.preflight();
  await harness.buildImages();
  for (const kind of ["app", "worker"]) {
    const image = harness.configuration.images[kind];
    const result = await harness.checkedDocker(["image", "inspect", "--format", "{{json .}}", image], { label: "Inspect local release image architecture" });
    const info = JSON.parse(result.stdout);
    assert.equal(info.Os, "linux");
    assert.equal(info.Architecture, "amd64");
    assert.equal(info.Id, harness.builtImages.get(image));
    images.push({ kind, image, id: info.Id, os: info.Os, architecture: info.Architecture, owner: harness.configuration.owner });
  }
  await writeFile(path.join(ownerRoot, "image-build-results.json"), JSON.stringify({ images, localBuildOnly: true, registryPush: false, runtimeContainersStarted: false, baseImages: Object.fromEntries(harness.localImages) }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: images.length, localBuildOnly: true, registryPush: false }));
} finally {
  assert.equal(await harness.cleanup(deadlineAt), true, "Owner-verified local build cleanup failed");
}
