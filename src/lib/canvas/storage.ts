import "server-only";

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { GetBucketVersioningCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { getEnv } from "@/lib/env";
import { stringifyLogRecord } from "@/lib/logging/redact";
import { CanvasContractError, canvasStorageLocationMaterialV1, type CanvasStorageLocationInputV1 } from "./contracts";

export type CanvasStorageLocation = CanvasStorageLocationInputV1 & { id: string };
export type CanvasStorageAdapter = {
  location: CanvasStorageLocation;
  getBucketVersioning: (signal: AbortSignal) => Promise<{ locationId: string; verified: boolean; status?: string }>;
  putObject: (input: { key: string; bytes: Buffer; mimeType: string; sha256: string; signal: AbortSignal }) => Promise<{ versionId: string | null }>;
  close?: () => void;
};
type StorageEnvironment = Pick<ReturnType<typeof getEnv>, "S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY" | "S3_PUBLIC_BASE_URL">;
type RegisteredLocation = { storageLocation: string; storageEndpoint: string; storageRegion: string; storageBucket: string; storageKey: string };
const STORAGE_TIMEOUT_MS = 30_000;
const VERSIONING_BODY_LIMIT = 16 * 1024;
const S3_XML_NAMESPACE = "http://s3.amazonaws.com/doc/2006-03-01/";

async function readCanvasVersioningBody(body: unknown, signal: AbortSignal): Promise<Buffer> {
  const stream = body instanceof Readable ? body : null;
  const abort = () => { stream?.destroy(); };
  const chunks: Buffer[] = [];
  let length = 0;
  const append = (chunk: unknown) => {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
    length += typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength;
    if (length > VERSIONING_BODY_LIMIT) throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
    if (stream) { for await (const chunk of stream) append(chunk); }
    else append(body);
    if (signal.aborted) throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
    return Buffer.concat(chunks, length);
  } finally {
    signal.removeEventListener("abort", abort);
    stream?.destroy();
  }
}

function isCanvasUnversionedXml(body: Buffer): boolean {
  const xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml)) return false;
  let offset = xml.startsWith("\ufeff") ? 1 : 0;
  const take = (pattern: RegExp) => {
    pattern.lastIndex = offset;
    const match = pattern.exec(xml);
    if (match) offset = pattern.lastIndex;
    return match;
  };
  const skipMisc = () => {
    while (true) {
      take(/[ \t\r\n]*/y);
      if (!xml.startsWith("<!--", offset)) return true;
      const end = xml.indexOf("-->", offset + 4);
      if (end === -1) return false;
      const content = xml.slice(offset + 4, end);
      if (content.includes("--") || content.endsWith("-")) return false;
      offset = end + 3;
    }
  };

  // Recognize only the empty S3 envelope, not arbitrary XML. No entities,
  // directives, CDATA, child elements or non-declaration processing instructions.
  if (xml.startsWith("<?xml", offset) && !take(/<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*\?>/y)) return false;
  if (!skipMisc()) return false;
  const root = take(/<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?VersioningConfiguration)(?=[ \t\r\n/>])/y);
  if (!root) return false;
  const prefix = root[1].includes(":") ? root[1].split(":")[0] : "";
  const namespaces = new Map<string, string>();
  while (true) {
    const separated = take(/[ \t\r\n]+/y);
    if (xml.startsWith(">", offset) || xml.startsWith("/>", offset)) break;
    if (!separated) return false;
    const attribute = take(/xmlns(?::([A-Za-z_][A-Za-z0-9_.-]*))?[ \t\r\n]*=[ \t\r\n]*(?:"([^"<&]*)"|'([^'<&]*)')/y);
    if (!attribute) return false;
    const name = attribute[1] ?? "";
    const value = attribute[2] ?? attribute[3];
    if (namespaces.has(name) || name === "xml" || name === "xmlns" || (value !== S3_XML_NAMESPACE && !(name === "" && value === ""))) return false;
    namespaces.set(name, value);
  }
  if (prefix && namespaces.get(prefix) !== S3_XML_NAMESPACE) return false;
  if (!take(/\/>/y)) {
    if (!take(/>/y) || !skipMisc()) return false;
    const closing = take(/<\/((?:[A-Za-z_][A-Za-z0-9_.-]*:)?VersioningConfiguration)[ \t\r\n]*>/y);
    if (closing?.[1] !== root[1]) return false;
  }
  return skipMisc() && offset === xml.length;
}

export function canvasStorageLocation(input: CanvasStorageLocationInputV1): CanvasStorageLocation {
  const material = canvasStorageLocationMaterialV1(input);
  return { endpoint: new URL(input.endpoint.trim()).origin, region: input.region.trim(), bucket: input.bucket.trim(), id: `s3-v1:${createHash("sha256").update(material, "utf8").digest("hex")}` };
}

export function createCanvasStorageAdapter(environment: StorageEnvironment = getEnv()): CanvasStorageAdapter {
  if (!environment.S3_ENDPOINT || !environment.S3_BUCKET || !environment.S3_ACCESS_KEY_ID || !environment.S3_SECRET_ACCESS_KEY) throw new CanvasContractError("CANVAS_STORAGE_UNAVAILABLE");
  const location = canvasStorageLocation({ endpoint: environment.S3_ENDPOINT, region: environment.S3_REGION, bucket: environment.S3_BUCKET });
  const client = new S3Client({
    endpoint: location.endpoint,
    region: location.region,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: environment.S3_ACCESS_KEY_ID, secretAccessKey: environment.S3_SECRET_ACCESS_KEY },
  });
  return {
    location,
    close: () => client.destroy(),
    async getBucketVersioning(signal) {
      const command = new GetBucketVersioningCommand({ Bucket: location.bucket });
      let wireVerified = false;
      command.middlewareStack.add((next) => async (args) => {
        const output = await next(args);
        const response = output.response;
        if (!response || typeof response !== "object" || !("body" in response) || !("statusCode" in response)) throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
        const body = await readCanvasVersioningBody(response.body, signal);
        if (response.statusCode !== 200 || !isCanvasUnversionedXml(body)) throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
        response.body = body;
        wireVerified = true;
        return output;
      }, { name: "canvasVersioningResponseGuard", step: "deserialize", priority: "low" });
      // SDK decoders can turn empty/wrong-root HTTP 200 bodies into absent Status.
      // The per-command guard must see the bounded wire body before deserialization.
      const result = await client.send(command, { abortSignal: signal });
      return { locationId: location.id, verified: wireVerified && result.$metadata.httpStatusCode === 200, status: result.Status };
    },
    async putObject({ key, bytes, mimeType, sha256, signal }) {
      const result = await client.send(new PutObjectCommand({
        Bucket: location.bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.length,
        ContentType: mimeType,
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        IfNoneMatch: "*",
      }), { abortSignal: signal });
      if (result.$metadata.httpStatusCode !== 200) throw new CanvasContractError("CANVAS_STORAGE_UNAVAILABLE");
      return { versionId: result.VersionId ?? null };
    },
  };
}

export async function boundedCanvasStorageCall<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = STORAGE_TIMEOUT_MS, onLateResult?: (result: T) => Promise<void>): Promise<T> {
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; controller.abort(); reject(new CanvasContractError("CANVAS_STORAGE_UNAVAILABLE")); }, timeoutMs);
  });
  try {
    const original = operation(controller.signal);
    if (onLateResult) {
      // Observe only this original request. A late receipt may strengthen the
      // inventory fence, but may not restart I/O or publish a READY asset.
      void original.then(async (result) => {
        if (!expired) return;
        try { await onLateResult(result); }
        catch { console.error(stringifyLogRecord({ event: "canvas.upload.late_receipt_failed", code: "CANVAS_INTERNAL_ERROR" })); }
      }, () => undefined);
    }
    return await Promise.race([original, timeout]);
  }
  finally { clearTimeout(timer); }
}

export async function verifyCanvasStorageCapability(adapter: CanvasStorageAdapter, expectedLocation: CanvasStorageLocation = adapter.location, timeoutMs = STORAGE_TIMEOUT_MS): Promise<void> {
  try {
    const normalized = canvasStorageLocation(expectedLocation);
    if (normalized.id !== expectedLocation.id || adapter.location.id !== normalized.id || canvasStorageLocation(adapter.location).id !== normalized.id) throw new Error("location mismatch");
    const receipt = await boundedCanvasStorageCall((signal) => adapter.getBucketVersioning(signal), timeoutMs);
    if (!receipt.verified || receipt.locationId !== normalized.id || receipt.status !== undefined) throw new Error("versioning not verified unversioned");
  } catch {
    throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
  }
}

export function canvasAssetUrl(asset: RegisteredLocation, environment: StorageEnvironment = getEnv()): string | null {
  try {
    const location = canvasStorageLocation({ endpoint: asset.storageEndpoint, region: asset.storageRegion, bucket: asset.storageBucket });
    if (location.id !== asset.storageLocation || !asset.storageKey || asset.storageKey.split("/").some((part) => !part || part === "." || part === "..")) return null;
    if (!environment.S3_ENDPOINT || !environment.S3_BUCKET) return null;
    const current = canvasStorageLocation({ endpoint: environment.S3_ENDPOINT, region: environment.S3_REGION, bucket: environment.S3_BUCKET });
    if (current.id !== location.id) return null;
    let base = `${location.endpoint}/${encodeURIComponent(location.bucket)}`;
    if (environment.S3_PUBLIC_BASE_URL) {
      const publicBase = new URL(environment.S3_PUBLIC_BASE_URL);
      if (!["http:", "https:"].includes(publicBase.protocol) || /^[a-z]+:\/\/[^/]*@/i.test(environment.S3_PUBLIC_BASE_URL) || publicBase.search || publicBase.hash) return null;
      base = publicBase.toString().replace(/\/+$/, "");
    }
    return `${base}/${asset.storageKey.split("/").map(encodeURIComponent).join("/")}`;
  } catch { return null; }
}
