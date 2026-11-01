import {
  CANVAS_IMPORT_IMAGE_TYPES,
  CANVAS_LIMITS,
  CanvasContractError,
  type CanvasAssetDtoV1,
  type CanvasLocalReferenceNodeV1,
} from "@/lib/canvas/contracts";

import type { CanvasClientApi } from "./client-api";
import type { CanvasDraftBlobV1 } from "./draft-types";

export type CanvasReferenceCapture = {
  source: CanvasLocalReferenceNodeV1["source"];
  original: CanvasDraftBlobV1 | null;
};
export type CanvasPreviewLease = { url: string; release: () => void };
export type CanvasReferenceRuntimeOptions = {
  api: CanvasClientApi;
  signal: AbortSignal;
  uuid: () => string;
  readOriginal: (blobId: string) => CanvasDraftBlobV1 | undefined;
  onOriginal: (original: CanvasDraftBlobV1) => void;
  onAsset: (asset: CanvasAssetDtoV1) => void;
  alive: () => boolean;
  digest?: (blob: Blob) => Promise<string>;
  objectUrls?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
};

async function sha256(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateCanvasOriginal(blob: Blob): void {
  if (blob.size < 1 || blob.size > CANVAS_LIMITS.importBytes) throw new CanvasContractError("CANVAS_LIMIT_EXCEEDED");
  if (!(CANVAS_IMPORT_IMAGE_TYPES as readonly string[]).includes(blob.type)) throw new CanvasContractError("CANVAS_INVALID_INPUT");
}

export function captureCanvasReference(node: CanvasLocalReferenceNodeV1, originals: ReadonlyMap<string, CanvasDraftBlobV1>): CanvasReferenceCapture {
  const source = { ...node.source };
  const original = source.kind === "local" ? originals.get(source.blobId)
    : [...originals.values()].find((entry) => entry.assetId === source.assetId);
  return { source, original: original ? { ...original } : null };
}

// One promise per immutable original, shared by Save and Run. Only this runtime
// creates preview URLs; callers lease them without owning or removing bytes.
export function createCanvasReferenceRuntime(options: CanvasReferenceRuntimeOptions) {
  const inFlight = new Map<string, Promise<CanvasAssetDtoV1>>();
  const previews = new Map<string, { url: string; consumers: number }>();
  const urls = options.objectUrls ?? URL;
  let disposed = false;
  const alive = () => !disposed && !options.signal.aborted && options.alive();
  const assertAlive = () => {
    if (!alive()) throw new CanvasContractError("CANVAS_DELETED");
  };
  function rememberAsset(asset: CanvasAssetDtoV1) {
    assertAlive();
    options.onAsset(asset);
    if (asset.state === "UPLOADING") throw new CanvasContractError("CANVAS_UPLOAD_PENDING");
    if (asset.state === "QUARANTINED") throw new CanvasContractError("CANVAS_UPLOAD_QUARANTINED");
    if (asset.state !== "READY" || !asset.url) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
    return asset;
  }
  function rememberOriginal(original: CanvasDraftBlobV1) {
    assertAlive();
    options.onOriginal(original);
    return original;
  }
  function checkIdentity(asset: CanvasAssetDtoV1, original: CanvasDraftBlobV1) {
    if (asset.uploadId !== original.uploadId || asset.byteLength !== original.blob.size || asset.mimeType !== original.blob.type
      || (original.sha256 !== null && asset.sha256 !== original.sha256)) throw new CanvasContractError("CANVAS_UPLOAD_CONFLICT");
  }
  async function uploadOriginal(original: CanvasDraftBlobV1): Promise<CanvasAssetDtoV1> {
    assertAlive();
    validateCanvasOriginal(original.blob);
    const hadDigest = original.sha256 !== null;
    const digest = original.sha256 ?? await (options.digest ?? sha256)(original.blob);
    let current = rememberOriginal({ ...original, sha256: digest });
    let asset: CanvasAssetDtoV1 | null = null;
    if (hadDigest) {
      try { asset = await options.api.uploadStatus(current.uploadId, options.signal); }
      catch (error) {
        // A same-ID retry is safe only through the server's upload-once fence.
        // An active/ambiguous registered upload is never replaced by this path.
        if (!(error instanceof CanvasContractError) || error.code !== "CANVAS_INPUT_UNAVAILABLE") throw error;
      }
    }
    assertAlive();
    if (asset && (asset.state === "DELETING" || asset.state === "DELETED")) {
      checkIdentity(asset, current);
      options.onAsset(asset);
      // A lost READY acknowledgement may leave only the upload ID locally.
      // Fresh Save/Run can replace its terminal identity without changing bytes.
      current = rememberOriginal({ ...current, uploadId: options.uuid(), assetId: null });
      asset = null;
    }
    asset ??= await options.api.upload({ uploadId: current.uploadId, blob: current.blob, fileName: current.fileName, sha256: digest }, options.signal);
    checkIdentity(asset, current);
    rememberAsset(asset);
    current = rememberOriginal({ ...current, assetId: asset.id });
    return asset;
  }
  async function resolveCapture(capture: CanvasReferenceCapture): Promise<CanvasAssetDtoV1> {
    assertAlive();
    let original = capture.original ? options.readOriginal(capture.original.blobId) ?? capture.original : null;
    const assetId = original?.assetId ?? (capture.source.kind === "imported" ? capture.source.assetId : null);
    if (assetId) {
      try {
        const asset = await options.api.asset(assetId, options.signal);
        if (asset.id !== assetId) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
        if (original && original.assetId === assetId) checkIdentity(asset, original);
        return rememberAsset(asset);
      } catch (error) {
        if (!(error instanceof CanvasContractError) || error.code !== "CANVAS_INPUT_UNAVAILABLE" || !original) throw error;
        // Expired rootless imports keep their original bytes. A new immutable
        // upload identity is allocated only during fresh Save/Run preparation.
        original = rememberOriginal({ ...original, uploadId: options.uuid(), assetId: null });
      }
    }
    if (!original) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
    return uploadOriginal(original);
  }
  return {
    resolve(capture: CanvasReferenceCapture): Promise<CanvasAssetDtoV1> {
      const key = capture.original?.blobId ?? (capture.source.kind === "imported" ? capture.source.assetId : capture.source.blobId);
      const existing = inFlight.get(key);
      if (existing) return existing;
      const request = resolveCapture(capture).finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
      inFlight.set(key, request);
      return request;
    },
    preview(blobId: string): CanvasPreviewLease | null {
      if (!alive()) return null;
      const original = options.readOriginal(blobId);
      if (!original || typeof urls.createObjectURL !== "function") return null;
      let entry = previews.get(blobId);
      if (!entry) {
        entry = { url: urls.createObjectURL(original.blob), consumers: 0 };
        previews.set(blobId, entry);
      }
      entry.consumers += 1;
      const held = entry;
      let released = false;
      return { url: held.url, release() {
        if (released) return;
        released = true;
        if (previews.get(blobId) !== held) return;
        held.consumers -= 1;
        if (held.consumers === 0) {
          urls.revokeObjectURL(held.url);
          previews.delete(blobId);
        }
      } };
    },
    dispose() {
      disposed = true;
      for (const entry of previews.values()) urls.revokeObjectURL(entry.url);
      previews.clear();
      inFlight.clear();
    },
  };
}

export type CanvasReferenceRuntime = ReturnType<typeof createCanvasReferenceRuntime>;
