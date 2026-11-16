import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const BINARY_SHA256 = "f16bec7352122be5b921392313fa0b34db83d01f201bee926e0d2fe9a04a784d";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function previousWorkerVerifier(ownerRoot) {
  const root = realpathSync(ownerRoot);
  const source = path.join(root, "c2-worker-evidence");
  assert.equal(realpathSync(source), source);
  assert(!lstatSync(source).isSymbolicLink());
  const evidence = JSON.parse(readFileSync(path.join(source, "evidence.json"), "utf8"));
  assert.equal(evidence.sourceReceipt, "20261115T135500-previous-worker-linux-4133d8");
  assert.equal(evidence.files["narra-worker"], BINARY_SHA256);
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      assert(!lstatSync(target).isSymbolicLink());
      if (entry.isDirectory()) visit(target);
      else {
        assert(entry.isFile());
        const relative = path.relative(source, target).split(path.sep).join("/");
        if (relative === "evidence.json") continue;
        assert.match(relative, /^(?:narra-worker|contracts\/[a-z0-9_./-]+\.json)$/);
        assert.equal(sha256(readFileSync(target)), evidence.files[relative], `Prior Worker evidence drift: ${relative}`);
        found.push(relative);
      }
    }
  };
  visit(source);
  assert.deepEqual(found.sort(), Object.keys(evidence.files).sort());
  assert.equal(JSON.parse(readFileSync(path.join(source, "contracts/media/v1/maintenance.json"), "utf8")).readerRevision, 2);
  return async ({ harness, project, mode, options, sql }) => {
    await harness.assertDatabase(project, options);
    const service = mode === "embedded" ? "embedded" : "app";
    const container = (await harness.containers(project, options)).find((candidate) => candidate.Config.Labels["com.docker.compose.service"] === service);
    assert(container && container.State.Status === "running");
    const facts = async () => JSON.parse(await sql(`SELECT json_build_object('revision',image_storage_revision(),
      'used',(SELECT "usedBytes"::text FROM "ImageQuota" WHERE scope='images'),
      'reserved',(SELECT "reservedBytes"::text FROM "ImageQuota" WHERE scope='images'),
      'objects',(SELECT count(*) FROM "ImageObject"), 'attempts',(SELECT count(*) FROM "GenerationAttempt"));`));
    const before = await facts();
    assert.equal(before.revision, 3);
    await harness.checkedDocker(["container", "exec", container.Id, "test", "!", "-e", "/tmp/c2-worker-evidence"], { ...options, label: "Require unused prior-Worker fixture path" });
    await harness.checkedDocker(["container", "cp", source, `${container.Id}:/tmp/c2-worker-evidence`], { ...options, timeoutMs: 25_000, label: "Copy only the hash-verified prior Worker and its original contracts" });
    await harness.checkedDocker(["container", "exec", container.Id, "chmod", "0500", "/tmp/c2-worker-evidence/narra-worker"], { ...options, label: "Set executable permission on the exact prior fixture binary" });
    const result = await harness.compose(project, ["exec", "-T", "--workdir", "/tmp/c2-worker-evidence",
      "--env", "WORKER_HTTP_ADDR=127.0.0.1:18082", "--env", "WORKER_RUNTIME_MODE=dedicated", service,
      "/tmp/c2-worker-evidence/narra-worker"], { ...options, timeoutMs: 20_000, label: "Actual revision-2 Worker must refuse the current topology/schema before claiming work" });
    assert.equal(result.code, 1, "Prior Worker did not refuse startup with its own nonzero result");
    const expected = mode === "embedded" ? /TOPOLOGY_CONFLICT|topology_conflict|拓扑冲突/ : /IMAGE_STORAGE_UNAVAILABLE/;
    assert.match(`${result.stdout}\n${result.stderr}`, expected);
    assert.deepEqual(await facts(), before, "Prior Worker changed work or image accounting before its refusal");
    console.log(JSON.stringify({ priorWorker: "rejected", topology: mode, binarySha256: BINARY_SHA256,
      priorReaderRevision: 2, currentReaderRevision: 3, reason: mode === "embedded" ? "TOPOLOGY_CONFLICT" : "IMAGE_SCHEMA_INCOMPATIBLE", unchangedInventory: true }));
  };
}
