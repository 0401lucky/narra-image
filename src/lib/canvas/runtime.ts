import "server-only";

import { GenerationStatus, Prisma } from "@prisma/client";
import type { z } from "zod";

import { db } from "@/lib/db";
import type { canvasRuntimeResolveSchema } from "@/lib/validators";
import { serializeCanvasAsset } from "./assets";
import { CanvasContractError, type CanvasRuntimeResolveDtoV1 } from "./contracts";
import { canvasGenerationInclude, canvasRunLookupSelect, serializeCanvasGeneration, serializeCanvasRunLookup } from "./runs";

export type CanvasRuntimeResolveInput = z.output<typeof canvasRuntimeResolveSchema>;

export async function resolveCanvasRuntime(ownerId: string, input: CanvasRuntimeResolveInput): Promise<CanvasRuntimeResolveDtoV1> {
  return db.$transaction(async (tx) => {
    const canvas = await tx.canvas.findFirst({
      where: { id: input.canvasId, ownerId, userId: ownerId },
      select: { id: true, deletedAt: true },
    });
    if (!canvas) throw new CanvasContractError("CANVAS_NOT_FOUND");
    if (canvas.deletedAt !== null) throw new CanvasContractError("CANVAS_DELETED");

    const missing: CanvasRuntimeResolveDtoV1["missing"] = [];
    const requestedRuns = [...new Set([...input.runIds, ...input.runBindings.map((binding) => binding.runId)])];
    const runRows = requestedRuns.length ? await tx.canvasRun.findMany({
      where: { ownerId, userId: ownerId, canvasId: input.canvasId, runId: { in: requestedRuns } },
      select: canvasRunLookupSelect,
    }) : [];
    const ownedRuns = new Map(runRows.filter((run) => run.ownerId === ownerId && run.userId === ownerId
      && run.canvasId === input.canvasId && requestedRuns.includes(run.runId)).map((run) => [run.runId, run]));
    const runs = new Map<string, typeof runRows[number]>();
    for (const runId of requestedRuns) {
      const run = ownedRuns.get(runId);
      if (!run) {
        missing.push({ kind: "run", id: runId, code: "CANVAS_RUN_NOT_FOUND" });
      } else if (input.runBindings.some((binding) => binding.runId === runId
        && (run.state !== "COMMITTED" || run.nodeId !== binding.nodeId || run.originalJobId !== binding.jobId))) {
        missing.push({ kind: "run", id: runId, code: "CANVAS_ORIGIN_MISMATCH" });
      } else {
        runs.set(runId, run);
      }
    }

    const requestedJobs = [...new Set([...input.jobIds, ...[...runs.values()].flatMap((run) =>
      run.state === "COMMITTED" && run.originalJobId && run.liveJobId === run.originalJobId ? [run.originalJobId] : [])])];
    const [jobRows, imageRows, assetRows] = await Promise.all([
      requestedJobs.length ? tx.generationJob.findMany({
        where: { id: { in: requestedJobs }, userId: ownerId },
        include: canvasGenerationInclude,
      }) : [],
      input.imageIds.length ? tx.generationImage.findMany({
        where: { id: { in: input.imageIds }, job: { userId: ownerId } },
        select: {
          id: true, jobId: true, url: true, width: true, height: true,
          job: { select: { id: true, userId: true, status: true } },
        },
      }) : [],
      input.assetIds.length ? tx.canvasImportAsset.findMany({
        where: { id: { in: input.assetIds }, ownerId, userId: ownerId, kind: "IMPORT" },
      }) : [],
    ]);
    const jobs = new Map(jobRows.filter((job) => job.userId === ownerId && requestedJobs.includes(job.id)).map((job) => [job.id, job]));
    for (const id of requestedJobs) {
      if (!jobs.has(id)) missing.push({ kind: "job", id, code: "CANVAS_JOB_UNAVAILABLE" });
    }

    const runDtos: CanvasRuntimeResolveDtoV1["runs"] = Object.fromEntries([...runs].map(([id, run]) => {
      const lookup = serializeCanvasRunLookup(run, run.originalJobId ? jobs.get(run.originalJobId) ?? null : null);
      if (lookup.state === "COMMITTED" && lookup.unavailable) missing.push({ kind: "run", id, code: lookup.unavailable });
      return [id, lookup];
    }));

    const images = new Map(imageRows.filter((image) => image.job.userId === ownerId && image.jobId === image.job.id
      && image.job.status === GenerationStatus.SUCCEEDED && image.url && input.imageIds.includes(image.id)).map((image) => [image.id, image]));
    for (const id of input.imageIds) {
      if (!images.has(id)) missing.push({ kind: "image", id, code: "CANVAS_INPUT_UNAVAILABLE" });
    }

    const assets = new Map(assetRows.filter((asset) => asset.ownerId === ownerId && asset.userId === ownerId
      && asset.kind === "IMPORT" && input.assetIds.includes(asset.id)).map((asset) => [asset.id, serializeCanvasAsset(asset)]));
    for (const id of input.assetIds) {
      const asset = assets.get(id);
      if (!asset || asset.state !== "READY" || !asset.url) missing.push({ kind: "asset", id, code: "CANVAS_INPUT_UNAVAILABLE" });
    }

    return {
      canvasId: input.canvasId,
      generations: Object.fromEntries([...jobs].map(([id, job]) => [id, serializeCanvasGeneration(job)])),
      images: Object.fromEntries([...images].map(([id, image]) => [id, {
        id, jobId: image.jobId, url: image.url,
        actualWidth: image.width, actualHeight: image.height,
        actualSize: image.width && image.height ? `${image.width}x${image.height}` : null,
      }])),
      assets: Object.fromEntries(assets),
      runs: runDtos,
      missing,
    };
  }, {
    // Job terminal status and its complete image batch must share one snapshot.
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 3_000,
    timeout: 8_000,
  });
}
