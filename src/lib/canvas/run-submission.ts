import "server-only";

import { createHash, createHmac } from "node:crypto";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { canvasRunSchema } from "@/lib/validators";
import {
  CANVAS_ERRORS, CanvasContractError, canonicalCanvasJson,
  type CanvasErrorCode, type CanvasRunLookupDtoV1, type CanvasRunTransientFieldsV1, type CanvasRunWireV1, type CanvasRunSubmissionDtoV1,
} from "./contracts";
import { lockOwnedCanvas } from "./documents";
import { canvasErrorResponse, canvasJson, parseCanvasInput } from "./http";
import { lockCanvasRunInputs, readCanvasRunInputs, type CanvasResolvedRunInputs } from "./inputs";
import { getCanvasRun, serializeCanvasRunLookup } from "./runs";
import { canvasTransaction, type CanvasTransaction } from "./transactions";

export type CanvasRunAttempt = { ownerId: string; run: CanvasRunWireV1; intentHash: string; credentialFingerprint: string | null };
export type CanvasRunPreparation = CanvasRunAttempt & { token: string };
type ReservationRow = {
  id: string; state: "PREPARING" | "COMMITTED" | "REJECTED"; preparationToken: string;
  preparationExpiresAt: Date; originalJobId: string | null; liveJobId: string | null; replayed: boolean;
};
type CanvasRunReservation = { kind: "prepared"; preparation: CanvasRunPreparation } | { kind: "replay"; lookup: CanvasRunLookupDtoV1 };

export function fingerprintCanvasRun(run: CanvasRunWireV1, customProvider: CanvasRunTransientFieldsV1["customProvider"], secret: string) {
  const credentialFingerprint = run.parameters.providerMode === "custom" && customProvider
    ? createHmac("sha256", secret).update("narra.canvas.credentials.v1\0").update(canonicalCanvasJson(customProvider)).digest("hex")
    : null;
  const intentHash = createHash("sha256").update(canonicalCanvasJson({ canvasRun: run, credentialFingerprint })).digest("hex");
  return { credentialFingerprint, intentHash };
}

export function createCanvasRunAttempt(ownerId: string, value: CanvasRunWireV1, customProvider: CanvasRunTransientFieldsV1["customProvider"]): CanvasRunAttempt {
  const run = parseCanvasInput(canvasRunSchema, value);
  const { credentialFingerprint, intentHash } = fingerprintCanvasRun(run, customProvider, getEnv().AUTH_SECRET);
  return { ownerId, run, credentialFingerprint, intentHash };
}

async function findMatchingCanvasRun(attempt: CanvasRunAttempt): Promise<CanvasRunLookupDtoV1 | null> {
  const row = await db.canvasRun.findUnique({
    where: { ownerId_runId: { ownerId: attempt.ownerId, runId: attempt.run.runId }, userId: attempt.ownerId },
    select: { canvasId: true, nodeId: true, intentHash: true, credentialFingerprint: true, inputSnapshot: true },
  });
  if (!row) return null;
  if (row.canvasId !== attempt.run.canvasId || row.nodeId !== attempt.run.nodeId || row.intentHash !== attempt.intentHash
    || row.credentialFingerprint !== attempt.credentialFingerprint || canonicalCanvasJson(row.inputSnapshot) !== canonicalCanvasJson(attempt.run)) {
    throw new CanvasContractError("CANVAS_RUN_CONFLICT");
  }
  return getCanvasRun(attempt.ownerId, attempt.run.runId);
}

export async function reserveCanvasRun(attempt: CanvasRunAttempt): Promise<CanvasRunReservation> {
  const { run, credentialFingerprint, intentHash } = attempt;
  const snapshot = canonicalCanvasJson(run);
  let row: ReservationRow;
  try {
    row = await canvasTransaction(async (tx) => {
      const rows = await tx.$queryRaw<ReservationRow[]>`SELECT * FROM canvas_reserve_run(
        ${attempt.ownerId}::text, ${run.canvasId}::uuid, ${run.nodeId}::uuid, ${run.runId}::uuid,
        ${intentHash}::text, ${snapshot}::jsonb, ${credentialFingerprint}::text)`;
      if (!rows[0]) throw new CanvasContractError("CANVAS_INTERNAL_ERROR");
      return rows[0];
    });
  } catch (error) {
    if (error instanceof CanvasContractError && error.code === "CANVAS_NOT_FOUND") {
      // Enqueue and a queued Delete can finish after SQL's initial run read,
      // before its canvas lock. A terminal same-intent run still owns its replay.
      const lookup = await findMatchingCanvasRun(attempt);
      if (lookup && lookup.state !== "PREPARING") return { kind: "replay", lookup };
    }
    throw error;
  }
  if (row.replayed || row.state !== "PREPARING") {
    return { kind: "replay", lookup: await getCanvasRun(attempt.ownerId, run.runId) };
  }
  return { kind: "prepared", preparation: { ownerId: attempt.ownerId, run, token: row.preparationToken, intentHash, credentialFingerprint } };
}

export async function prepareCanvasRunCommit(tx: CanvasTransaction, preparation: CanvasRunPreparation, inputs: CanvasResolvedRunInputs): Promise<CanvasResolvedRunInputs> {
  const { ownerId, run, token, intentHash, credentialFingerprint } = preparation;
  await lockOwnedCanvas(tx, ownerId, run.canvasId);
  const rows = await tx.$queryRaw<Array<{
    canvasId: string; nodeId: string; state: string; preparationToken: string; intentHash: string; credentialFingerprint: string | null;
  }>>`SELECT "canvasId", "nodeId", state, "preparationToken", "intentHash", "credentialFingerprint" FROM "CanvasRun"
    WHERE "ownerId" = ${ownerId}::text AND "userId" = ${ownerId}::text AND "runId" = ${run.runId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row || row.state !== "PREPARING" || row.preparationToken !== token) throw new CanvasContractError("CANVAS_LEASE_LOST");
  if (row.canvasId !== run.canvasId || row.nodeId !== run.nodeId || row.intentHash !== intentHash || row.credentialFingerprint !== credentialFingerprint) throw new CanvasContractError("CANVAS_RUN_CONFLICT");
  await lockCanvasRunInputs(tx, ownerId, run);
  const resolved = await readCanvasRunInputs(ownerId, run, tx);
  if (resolved.sourceImageUrls.length !== inputs.sourceImageUrls.length || resolved.sourceImageUrls.some((url, index) => url !== inputs.sourceImageUrls[index])) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
  const lease = await tx.$queryRaw<Array<{ active: boolean }>>`SELECT EXISTS (SELECT 1 FROM "CanvasRun"
    WHERE "ownerId" = ${ownerId}::text AND "runId" = ${run.runId}::uuid AND state = 'PREPARING'
    AND "preparationToken" = ${token}::uuid AND "preparationExpiresAt" > clock_timestamp()) AS active`;
  if (!lease[0]?.active) throw new CanvasContractError("CANVAS_LEASE_LOST");
  return resolved;
}

export async function commitCanvasRun(tx: CanvasTransaction, preparation: CanvasRunPreparation, jobId: string): Promise<void> {
  const result = await tx.$queryRaw<Array<{ jobId: string }>>`SELECT canvas_commit_run(
    ${preparation.ownerId}::text, ${preparation.run.runId}::uuid, ${preparation.token}::uuid, ${jobId}::text) AS "jobId"`;
  if (result[0]?.jobId !== jobId) throw new CanvasContractError("CANVAS_INTERNAL_ERROR");
}

export async function rejectCanvasRun(preparation: CanvasRunPreparation, code: CanvasErrorCode): Promise<boolean> {
  try {
    return await canvasTransaction(async (tx) => {
      const result = await tx.$queryRaw<Array<{ rejected: boolean }>>`SELECT canvas_reject_run(
        ${preparation.ownerId}::text, ${preparation.run.runId}::uuid, ${preparation.token}::uuid, ${code}::text) AS rejected`;
      return result[0]?.rejected === true;
    });
  } catch {
    // Failure to acknowledge a fenced rejection does not authorize a new run.
    return false;
  }
}

export async function recoverCanvasRunResponse(attempt: CanvasRunAttempt): Promise<Response> {
  try {
    const lookup = await findMatchingCanvasRun(attempt);
    if (lookup) return canvasRunResponse(lookup);
  }
  catch (error) {
    if (error instanceof CanvasContractError && error.code === "CANVAS_RUN_CONFLICT") return canvasErrorResponse(error);
  }
  // A missing/failed read cannot prove an earlier commit did not succeed.
  return canvasRunResponse(serializeCanvasRunLookup({
    ownerId: attempt.ownerId, userId: attempt.ownerId, canvasId: attempt.run.canvasId, nodeId: attempt.run.nodeId,
    runId: attempt.run.runId, state: "PREPARING", originalJobId: null, liveJobId: null, rejectionCode: null,
  }));
}

export function canvasRunResponse(lookup: CanvasRunLookupDtoV1): Response {
  if (lookup.state === "COMMITTED" && lookup.generation) {
    return canvasJson({ generation: lookup.generation, canvasRun: { ...lookup.origin, jobId: lookup.jobId } } satisfies CanvasRunSubmissionDtoV1);
  }
  if (lookup.state === "PREPARING") {
    return canvasJson(lookup, 202, { "Retry-After": String(Math.ceil(lookup.retryAfterMs / 1_000)) });
  }
  return canvasJson(lookup, lookup.state === "COMMITTED" ? CANVAS_ERRORS.CANVAS_JOB_UNAVAILABLE.status : CANVAS_ERRORS.CANVAS_RUN_REJECTED.status);
}
