// @vitest-environment node

import { describe, expect, it } from "vitest";

import { imageByteLength, imageObjectSchema } from "@/lib/storage/image-contract";
import history from "../../../contracts/media/v1/history.json";

const id = "11223344-5566-4788-99aa-bbccddeeff00";
const observationId = "22334455-6677-4899-aabb-ccddeeff0011";
const stamp = "2026-11-15T00:00:00.000Z";
function observed() {
  return {
    id, assetId: id, provenance: "OBSERVED", sourceObservationId: observationId, reconciliationObservationId: null,
    reservationId: null, slot: null, writeToken: null, writeExpiresAt: null,
    locationId: `local-v1:${id}`, physicalNamespace: `local:${id}`, key: "old/image.png", byteLength: "10", mimeType: "image/png", sha256: "a".repeat(64),
    state: "READY", putOutcome: "NOT_APPLICABLE", versionId: null, accounted: true, needsReconciliation: false,
    deleteToken: null, deleteExpiresAt: null, deleteOutcome: "NOT_STARTED", deleteAttempts: 0, nextDeleteAt: null, deletedAt: null,
    lastErrorCode: null, createdAt: stamp, updatedAt: stamp,
  };
}

describe("history object provenance boundary", () => {
  it("requires the observed branch to have exact null write fields and a source observation", () => {
    expect(history.provenances).toEqual(["WRITE", "OBSERVED"]);
    expect(imageObjectSchema.parse(observed())).toMatchObject({ provenance: "OBSERVED", reservationId: null, writeExpiresAt: null, putOutcome: "NOT_APPLICABLE" });
    for (const patch of [{ reservationId: id }, { slot: 0 }, { writeToken: id }, { writeExpiresAt: stamp }, { sourceObservationId: null }, { putOutcome: "CONFIRMED" }]) {
      expect(imageObjectSchema.safeParse({ ...observed(), ...patch }).success).toBe(false);
    }
    const missing: Record<string, unknown> = observed(); delete missing.writeToken;
    expect(imageObjectSchema.safeParse(missing).success).toBe(false);
  });

  it("preserves UNKNOWN after a separate positive reconciliation instead of fabricating a successful PUT", () => {
    const reconciled = { ...observed(), provenance: "WRITE", sourceObservationId: null, reservationId: id, slot: 0,
      writeToken: id, writeExpiresAt: stamp, putOutcome: "UNKNOWN", reconciliationObservationId: observationId };
    expect(imageObjectSchema.parse(reconciled)).toMatchObject({ state: "READY", putOutcome: "UNKNOWN", writeExpiresAt: stamp, reconciliationObservationId: observationId });
    expect(imageObjectSchema.safeParse({ ...reconciled, reconciliationObservationId: null }).success).toBe(false);
    expect(imageObjectSchema.safeParse({ ...reconciled, needsReconciliation: true }).success).toBe(false);
  });

  it("decodes real oversized historical bytes while keeping new upload and READY bounds", () => {
    const large = { ...observed(), byteLength: "6000000000", state: "UNKNOWN", needsReconciliation: true };
    expect(imageObjectSchema.parse(large).byteLength).toBe("6000000000");
    expect(imageObjectSchema.safeParse({ ...large, state: "READY", needsReconciliation: false }).success).toBe(false);
    expect(() => imageByteLength(large.byteLength)).toThrowError();
  });

  it("keeps pre-existing confirmed S3 version receipts readable without allowing a versioned observed READY object", () => {
    const legacy = { ...observed(), provenance: "WRITE", sourceObservationId: null, reservationId: id, slot: 0,
      writeToken: id, writeExpiresAt: stamp, putOutcome: "CONFIRMED", versionId: "legacy-version" };
    expect(imageObjectSchema.parse(legacy).versionId).toBe("legacy-version");
    expect(imageObjectSchema.safeParse({ ...observed(), versionId: "legacy-version" }).success).toBe(false);
  });
});
