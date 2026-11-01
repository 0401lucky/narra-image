import {
  CANVAS_ERRORS,
  CANVAS_RUN_REQUEST_HEADERS,
  CanvasContractError,
  encodeCanvasRunRequestV1,
  isCanvasErrorCode,
  type CanvasAssetDtoV1,
  type CanvasDocumentDtoV1,
  type CanvasMetadataDtoV1,
  type CanvasMetadataPageDtoV1,
  type CanvasRunLookupDtoV1,
  type CanvasRunProjectionV1,
  type CanvasRunSubmissionDtoV1,
  type CanvasRunTransientFieldsV1,
  type CanvasRuntimeResolveDtoV1,
  type CanvasSaveReceiptDtoV1,
  type CanvasSceneV1,
} from "@/lib/canvas/contracts";
import type { SerializedGeneration } from "@/lib/prisma-mappers";
import {
  canvasAssetDtoSchema,
  canvasCanonicalIdSchema,
  canvasClientIdSchema,
  canvasDocumentDtoSchema,
  canvasMetadataDtoSchema,
  canvasMetadataPageDtoSchema,
  canvasRuntimeResolveSchema,
  canvasSaveReceiptDtoSchema,
} from "@/lib/validators";
import type { z } from "zod";

import { STUDIO_READ_TIMEOUT_MS } from "../constants";
import { isGenerationItem } from "../generation-item";
export type CanvasRuntimeRequest = z.output<typeof canvasRuntimeResolveSchema>;
export type CanvasSubmissionResult = CanvasRunSubmissionDtoV1 | CanvasRunLookupDtoV1;
export type CanvasUploadInput = { uploadId: string; blob: Blob; fileName: string; sha256: string };

const CLIENT_TIMEOUT_MS = { request: STUDIO_READ_TIMEOUT_MS, upload: 90_000, submit: 120_000 } as const;

export type CanvasClientApi = {
  list: (cursor: string | null, signal: AbortSignal) => Promise<CanvasMetadataPageDtoV1>;
  read: (canvasId: string, signal: AbortSignal) => Promise<CanvasDocumentDtoV1>;
  create: (id: string, title: string, signal: AbortSignal) => Promise<CanvasMetadataDtoV1>;
  rename: (id: string, title: string, expectedRevision: number, signal: AbortSignal) => Promise<CanvasMetadataDtoV1>;
  save: (id: string, input: { saveId: string; expectedRevision: number; scene: CanvasSceneV1 }, signal: AbortSignal) => Promise<CanvasSaveReceiptDtoV1>;
  delete: (id: string, expectedRevision: number, signal: AbortSignal) => Promise<{ id: string; deleted: true; revision: number }>;
  asset: (id: string, signal: AbortSignal) => Promise<CanvasAssetDtoV1>;
  uploadStatus: (uploadId: string, signal: AbortSignal) => Promise<CanvasAssetDtoV1>;
  upload: (input: CanvasUploadInput, signal: AbortSignal) => Promise<CanvasAssetDtoV1>;
  resolve: (input: CanvasRuntimeRequest, signal: AbortSignal) => Promise<CanvasRuntimeResolveDtoV1>;
  lookup: (runId: string, signal: AbortSignal) => Promise<CanvasRunLookupDtoV1>;
  submit: (projection: CanvasRunProjectionV1, fields: CanvasRunTransientFieldsV1, signal: AbortSignal) => Promise<CanvasSubmissionResult>;
};

export class CanvasTransportError extends Error {
  constructor() {
    super("\u8bf7\u6c42\u7ed3\u679c\u5c1a\u672a\u786e\u8ba4\uff0c\u8bf7\u4fdd\u7559\u8349\u7a3f\u548c\u539f\u64cd\u4f5c\u7f16\u53f7\u540e\u67e5\u8be2");
    this.name = "CanvasTransportError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanvasTransportError();
  return value as Record<string, unknown>;
}

function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CanvasTransportError();
  return result.data;
}

function generation(value: unknown): SerializedGeneration {
  if (!isGenerationItem(value) || !["text_to_image", "image_to_image"].includes(value.generationType)) throw new CanvasTransportError();
  parse(canvasCanonicalIdSchema, value.id);
  for (const image of value.images) parse(canvasCanonicalIdSchema, image.id);
  return value as SerializedGeneration;
}

function runLookup(value: unknown): CanvasRunLookupDtoV1 {
  const item = object(value);
  const origin = object(item.origin);
  parse(canvasClientIdSchema, origin.canvasId);
  parse(canvasClientIdSchema, origin.nodeId);
  parse(canvasClientIdSchema, origin.runId);
  switch (item.state) {
    case "COMMITTED":
      parse(canvasCanonicalIdSchema, item.jobId);
      if (item.generation !== null) {
        if (generation(item.generation).id !== item.jobId || item.unavailable !== null) throw new CanvasTransportError();
      } else if (item.unavailable !== "CANVAS_JOB_UNAVAILABLE") throw new CanvasTransportError();
      break;
    case "PREPARING":
      if (typeof item.retryAfterMs !== "number" || !Number.isFinite(item.retryAfterMs) || item.retryAfterMs < 0) throw new CanvasTransportError();
      break;
    case "REJECTED":
      if (!isCanvasErrorCode(item.code)) throw new CanvasTransportError();
      break;
    default: throw new CanvasTransportError();
  }
  return value as CanvasRunLookupDtoV1;
}

function submission(value: unknown): CanvasSubmissionResult {
  const item = object(value);
  if ("state" in item) return runLookup(value);
  const job = generation(item.generation);
  const origin = object(item.canvasRun);
  parse(canvasClientIdSchema, origin.canvasId);
  parse(canvasClientIdSchema, origin.nodeId);
  parse(canvasClientIdSchema, origin.runId);
  if (origin.jobId !== job.id) throw new CanvasTransportError();
  return value as CanvasRunSubmissionDtoV1;
}

function runtime(value: unknown): CanvasRuntimeResolveDtoV1 {
  const item = object(value);
  parse(canvasClientIdSchema, item.canvasId);
  for (const [id, job] of Object.entries(object(item.generations))) {
    if (generation(job).id !== id) throw new CanvasTransportError();
  }
  for (const [id, image] of Object.entries(object(item.images))) {
    const entry = object(image);
    parse(canvasCanonicalIdSchema, id);
    parse(canvasCanonicalIdSchema, entry.jobId);
    if (entry.id !== id || typeof entry.url !== "string" || !entry.url
      || ![entry.actualWidth, entry.actualHeight].every((size) => size === null || (typeof size === "number" && Number.isFinite(size) && size > 0))
      || !(entry.actualSize === null || typeof entry.actualSize === "string")) throw new CanvasTransportError();
  }
  for (const [id, asset] of Object.entries(object(item.assets))) {
    if (parse(canvasAssetDtoSchema, asset).id !== id) throw new CanvasTransportError();
  }
  for (const [id, run] of Object.entries(object(item.runs))) {
    if (runLookup(run).origin.runId !== id) throw new CanvasTransportError();
  }
  if (!Array.isArray(item.missing)) throw new CanvasTransportError();
  for (const missing of item.missing) {
    const entry = object(missing);
    if (!["job", "image", "asset", "run"].includes(String(entry.kind)) || !isCanvasErrorCode(entry.code)) throw new CanvasTransportError();
    parse(canvasCanonicalIdSchema, entry.id);
  }
  return value as CanvasRuntimeResolveDtoV1;
}

// The only browser transport for canvas commands. Error text always comes from
// our contracts, never raw provider/HTML/exception bodies.
export function createCanvasClientApi(fetcher: typeof fetch = fetch): CanvasClientApi {
  async function request(path: string, init: RequestInit, signal: AbortSignal, lookupStatus = false, timeoutMs: number = CLIENT_TIMEOUT_MS.request): Promise<unknown> {
    if (signal.aborted) throw new CanvasTransportError();
    const controller = new AbortController();
    let rejectAbort: (reason: CanvasTransportError) => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const interrupt = () => {
      controller.abort();
      rejectAbort(new CanvasTransportError());
    };
    signal.addEventListener("abort", interrupt, { once: true });
    const timeout = setTimeout(interrupt, timeoutMs);
    try {
      const read = async () => {
        const response = await fetcher(path, { credentials: "same-origin", cache: "no-store", ...init, signal: controller.signal });
        if (controller.signal.aborted) throw new CanvasTransportError();
        const body = object(await response.json());
        if (controller.signal.aborted) throw new CanvasTransportError();
        return { response, body };
      };
      let response: Response;
      let body: Record<string, unknown>;
      // Bound fetch AND JSON even when they ignore abort. Timeout leaves the
      // original save/run outcome uncertain; only an explicit same-ID retry is safe.
      try { ({ response, body } = await Promise.race([read(), interrupted])); }
      catch { throw new CanvasTransportError(); }
      if (controller.signal.aborted) throw new CanvasTransportError();
      if (!response.ok && !(lookupStatus && [409, 410].includes(response.status) && body.data)) {
        if (isCanvasErrorCode(body.code)) throw new CanvasContractError(body.code);
        if (response.status === 401) throw new CanvasContractError("CANVAS_UNAUTHENTICATED");
        throw new CanvasTransportError();
      }
      if (!("data" in body)) throw new CanvasTransportError();
      return body.data;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", interrupt);
    }
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const canvasPath = (id: string) => `/api/me/canvases/${encodeURIComponent(id)}`;
  const readAsset = async (path: string, signal: AbortSignal) => parse(canvasAssetDtoSchema, object(await request(path, {}, signal)).asset);
  return {
    list: async (cursor, signal) => parse(canvasMetadataPageDtoSchema, await request(`/api/me/canvases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {}, signal)),
    read: async (id, signal) => parse(canvasDocumentDtoSchema, await request(canvasPath(id), {}, signal)),
    create: async (id, title, signal) => parse(canvasMetadataDtoSchema, object(await request("/api/me/canvases", json("POST", { id, title }), signal)).canvas),
    rename: async (id, title, expectedRevision, signal) => parse(canvasMetadataDtoSchema, object(await request(canvasPath(id), json("PATCH", { title, expectedRevision }), signal)).canvas),
    save: async (id, input, signal) => parse(canvasSaveReceiptDtoSchema, await request(`${canvasPath(id)}/snapshot`, json("PUT", input), signal)),
    delete: async (id, expectedRevision, signal) => {
      const data = object(await request(canvasPath(id), json("DELETE", { expectedRevision }), signal));
      if (data.id !== id || data.deleted !== true || !Number.isInteger(data.revision) || Number(data.revision) < expectedRevision) throw new CanvasTransportError();
      return data as { id: string; deleted: true; revision: number };
    },
    asset: (id, signal) => readAsset(`/api/me/canvas-assets/${encodeURIComponent(id)}`, signal),
    uploadStatus: (id, signal) => readAsset(`/api/me/canvas-assets/uploads/${encodeURIComponent(id)}`, signal),
    upload: async ({ uploadId, blob, fileName, sha256 }, signal) => {
      const form = new FormData();
      form.set("uploadId", uploadId);
      form.set("byteLength", String(blob.size));
      form.set("mimeType", blob.type);
      form.set("sha256", sha256);
      form.set("file", blob, fileName);
      return parse(canvasAssetDtoSchema, object(await request("/api/me/canvas-assets", { method: "POST", body: form }, signal, false, CLIENT_TIMEOUT_MS.upload)).asset);
    },
    resolve: async (input, signal) => runtime(await request("/api/me/canvas-runtime/resolve", json("POST", parse(canvasRuntimeResolveSchema, input)), signal)),
    lookup: async (runId, signal) => runLookup(await request(`/api/me/canvas-runs/${encodeURIComponent(runId)}`, {}, signal)),
    submit: async (projection, fields, signal) => submission(await request("/api/generate", {
      method: "POST", headers: CANVAS_RUN_REQUEST_HEADERS, body: JSON.stringify(encodeCanvasRunRequestV1(projection, fields)),
    }, signal, true, CLIENT_TIMEOUT_MS.submit)),
  };
}

export function canvasClientErrorMessage(error: unknown): string {
  return error instanceof CanvasContractError || error instanceof CanvasTransportError
    ? error.message : CANVAS_ERRORS.CANVAS_INTERNAL_ERROR.userMessage;
}
