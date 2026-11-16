import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import { createLocalImageStore, initializeLocalImageVolume } from "@/lib/storage/local-image-store";

const config = { rootDirectory: "/proof/images", volumeId: "3059f1f1-4e28-4f13-bbfa-6e60c62b1f26" };
const bytes = Buffer.from("narra-image-shared-volume-proof\n");
const common = { byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const store = createLocalImageStore(config);
const nodeObject = { ...common, key: "proof/node.png" };
const goObject = { ...common, key: "proof/go.png" };
const phase = process.argv[2];

assert.equal(process.platform, "linux");
assert.equal(process.getuid?.(), 0);
if (phase === "initialize") {
  await initializeLocalImageVolume(config);
  await store.probeWritable();
  await store.put({ ...nodeObject, bytes });
} else if (phase === "read-after-recreate") {
  await store.verify();
  await store.probeWritable();
  assert.deepEqual(await store.read(nodeObject), bytes);
  assert.deepEqual(await store.read(goObject), bytes);
  await assert.rejects(store.put({ ...goObject, bytes }), { code: "LOCAL_IMAGE_OBJECT_EXISTS" });
} else if (phase === "delete-go") {
  assert.equal(await store.delete(goObject), "deleted");
  assert.equal(await store.delete(goObject), "missing");
} else if (phase === "verify-deleted") {
  await assert.rejects(store.read(nodeObject), { code: "LOCAL_IMAGE_NOT_FOUND" });
  await assert.rejects(store.read(goObject), { code: "LOCAL_IMAGE_NOT_FOUND" });
  await store.verify();
} else {
  throw new Error("Unknown fixed cross-process proof phase");
}
console.log(JSON.stringify({ phase, passed: true, os: process.platform, uid: process.getuid?.() }));
