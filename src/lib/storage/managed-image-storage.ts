import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Prisma } from "@prisma/client";

import { getEnv, type RuntimeEnvironment } from "@/lib/env";
import {
  IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, ImageStorageError, imageLocalLocation,
  imagePublicUrl, imageS3Location, imageOutputBudget,
  type ImageLocation, type ImageLocationInput, type ImagePurpose,
  type ImageReservation, type ImageWriteTicket, type ManagedImage,
} from "./image-contract";
import { ImageRepository } from "./image-repository";
import { createLocalImageStore } from "./local-image-store";
import { IMAGE_STORAGE_REVISION, IMAGE_READER_REVISION, IMAGE_MAINTENANCE_REVISION, IMAGE_READ_TIMEOUT_MS } from "./image-maintenance-types";
import { reserveImageWithCleanup } from "./image-quota-cleanup";
import { managedImagePublicToken } from "./image-optimizer";

const IMAGE_IO_TIMEOUT_MS = 30_000;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
};

export type ImageReadyCapability = {
  version: 1; schema: "ready"; provider: "S3" | "LOCAL"; locationId: string;
  storageRevision: number; readerRevision: number; executorRevision: number; maintenance: "running";
};

export function isManagedImageStorageEnabled(environment: RuntimeEnvironment = getEnv()): boolean {
  return environment.IMAGE_STORAGE_MANAGED_ENABLED === true;
}

/** A raster header is required before publishing on our own origin. */
export function detectManagedImageMime(bytes: Buffer): string {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new ImageStorageError("IMAGE_INVALID_INPUT");
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString("ascii", 12, 16) === "IHDR") return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp"
    && ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))) return "image/avif";
  throw new ImageStorageError("IMAGE_INVALID_INPUT");
}

export function managedImageLocation(environment: RuntimeEnvironment = getEnv()): ImageLocationInput {
  if (environment.IMAGE_STORAGE_BACKEND === "local") return imageLocalLocation(environment.IMAGE_STORAGE_VOLUME_ID);
  if (!environment.S3_ENDPOINT || !environment.S3_BUCKET || !environment.S3_ACCESS_KEY_ID || !environment.S3_SECRET_ACCESS_KEY) {
    throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
  }
  return imageS3Location({ endpoint: environment.S3_ENDPOINT, region: environment.S3_REGION, bucket: environment.S3_BUCKET, publicBaseUrl: environment.S3_PUBLIC_BASE_URL });
}

function localStore(location: Pick<ImageLocation, "id" | "provider" | "volumeId">, environment: RuntimeEnvironment) {
  if (location.provider !== "LOCAL" || !location.volumeId || location.volumeId !== environment.IMAGE_STORAGE_VOLUME_ID
    || imageLocalLocation(location.volumeId).id !== location.id) throw new ImageStorageError("IMAGE_LOCATION_CONFLICT");
  return createLocalImageStore({ rootDirectory: environment.IMAGE_STORAGE_PATH, volumeId: location.volumeId });
}

function s3Client(location: Pick<ImageLocation, "provider" | "endpoint" | "region" | "bucket">, environment: RuntimeEnvironment) {
  if (location.provider !== "S3" || !location.endpoint || !location.region || !location.bucket
    || !environment.S3_ACCESS_KEY_ID || !environment.S3_SECRET_ACCESS_KEY) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
  return new S3Client({
    endpoint: location.endpoint, region: location.region, forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: environment.S3_ACCESS_KEY_ID, secretAccessKey: environment.S3_SECRET_ACCESS_KEY },
  });
}

export async function verifyLocalImageStorage(environment: RuntimeEnvironment = getEnv()): Promise<{ volumeId: string; locationId: string }> {
  try { return await localStore(imageLocalLocation(environment.IMAGE_STORAGE_VOLUME_ID), environment).probeWritable(); }
  catch (error) { throw error instanceof ImageStorageError ? error : new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE", { cause: error }); }
}

export async function verifyManagedImageStorage(): Promise<ImageReadyCapability> {
  const environment = getEnv();
  if (!isManagedImageStorageEnabled(environment)) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
  await new ImageRepository().verifySchema();
  const location = managedImageLocation(environment);
  if (location.provider === "LOCAL") await verifyLocalImageStorage(environment);
  else {
    const client = s3Client(location, environment);
    try {
      const result = await client.send(new HeadBucketCommand({ Bucket: location.bucket! }), { abortSignal: AbortSignal.timeout(2_000) });
      if (result.$metadata.httpStatusCode !== 200) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    } finally { client.destroy(); }
  }
  return { version: 1, schema: "ready", provider: location.provider, locationId: location.id,
    storageRevision: IMAGE_STORAGE_REVISION, readerRevision: IMAGE_READER_REVISION,
    executorRevision: IMAGE_MAINTENANCE_REVISION, maintenance: "running" };
}

export async function reserveManagedImageOutputs(input: { ownerId: string; intentKey: string; count: number }): Promise<ImageReservation | null> {
  if (!isManagedImageStorageEnabled()) return null;
  await verifyManagedImageStorage();
  const repository = new ImageRepository();
  return reserveImageWithCleanup({ repository, ...input, neededBytes: imageOutputBudget(input.count), reserve: () => repository.reserveOutputs(input) });
}

export async function bindManagedImageOutputs(tx: Prisma.TransactionClient, reservation: ImageReservation | null, ownerId: string, jobId: string) {
  if (reservation) await new ImageRepository(tx).bindReservation({ reservationId: reservation.id, token: reservation.token, ownerId, jobId });
}

export async function closeManagedImageReservation(reservation: ImageReservation | null): Promise<void> {
  if (reservation) await new ImageRepository().closeReservation({ reservationId: reservation.id, token: reservation.token });
}

export type PreparedManagedImageWrite = {
  bytes: Buffer;
  location: ImageLocation;
  reservation: ImageReservation;
  ticket: ImageWriteTicket;
  url: string;
};

export async function prepareManagedImageWrite(input: {
  bytes: Buffer; ownerId: string; purpose: ImagePurpose; originId?: string; assetId?: string;
  key?: string; intentKey?: string; leaseSeconds?: number;
}): Promise<PreparedManagedImageWrite> {
  const environment = getEnv();
  if (!isManagedImageStorageEnabled(environment)) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
  const bytes = Buffer.from(input.bytes);
  const mimeType = detectManagedImageMime(bytes);
  if (!IMAGE_MIME_TYPES.includes(mimeType)) throw new ImageStorageError("IMAGE_INVALID_INPUT");
  const repository = new ImageRepository();
  const location = await repository.registerLocation(managedImageLocation(environment));
  const reservationInput = {
    ownerId: input.ownerId, intentKey: input.intentKey ?? `input:${randomUUID()}`,
    byteLength: bytes.length, leaseSeconds: input.leaseSeconds,
  };
  const reservation = await reserveImageWithCleanup({ repository, ownerId: input.ownerId, intentKey: reservationInput.intentKey,
    neededBytes: BigInt(bytes.length), reserve: () => repository.reserveInput(reservationInput) });
  let ticket: ImageWriteTicket | undefined;
  try {
    ticket = await repository.beginObject({
      reservationId: reservation.id, token: reservation.token, slot: 0, locationId: location.id,
      key: input.key ?? `images/${randomUUID()}.${MIME_EXTENSIONS[mimeType]}`,
      byteLength: bytes.length, mimeType, sha256: createHash("sha256").update(bytes).digest("hex"),
      purpose: input.purpose, originId: input.originId, assetId: input.assetId,
    });
    const url = imagePublicUrl(environment.APP_URL, ticket.asset.publicToken);
    await repository.registerAlias({ assetId: ticket.asset.id, url });
    return { bytes, location, reservation, ticket, url };
  } catch (error) {
    // A returned first grant plus no attempted IO proves NOT_WRITTEN. An
    // uncertain beginObject commit without its receipt remains accounted.
    if (ticket?.writeGranted) await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken,
      outcome: "NOT_WRITTEN", errorCode: "IMAGE_STORAGE_UNAVAILABLE" }).catch(() => undefined);
    await repository.closeReservation({ reservationId: reservation.id, token: reservation.token }).catch(() => undefined);
    throw error;
  }
}

export async function putManagedImageObject(input: {
  location: ImageLocation; key: string; bytes: Buffer; mimeType: string; sha256: string; signal?: AbortSignal;
}): Promise<{ versionId: string | null }> {
  const environment = getEnv();
  const signal = input.signal ?? AbortSignal.timeout(IMAGE_IO_TIMEOUT_MS);
  if (input.bytes.length === 0 || input.bytes.length > MAX_IMAGE_BYTES || !IMAGE_MIME_TYPES.includes(input.mimeType)) {
    throw new ImageStorageError("IMAGE_INVALID_INPUT");
  }
  if (input.location.provider === "LOCAL") {
    await localStore(input.location, environment).put({ key: input.key, bytes: input.bytes, byteLength: input.bytes.length, sha256: input.sha256, signal });
    return { versionId: null };
  }
  const client = s3Client(input.location, environment);
  try {
    const result = await client.send(new PutObjectCommand({
      Bucket: input.location.bucket!, Key: input.key, Body: input.bytes, ContentLength: input.bytes.length,
      ContentType: input.mimeType, ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"), IfNoneMatch: "*",
    }), { abortSignal: signal });
    if (result.$metadata.httpStatusCode !== 200) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    return { versionId: result.VersionId ?? null };
  } finally { client.destroy(); }
}

export async function completeManagedImageWrite(prepared: PreparedManagedImageWrite, options: { rejectVersioned?: boolean; signal?: AbortSignal } = {}) {
  const repository = new ImageRepository();
  const { ticket } = prepared;
  if (!ticket.writeGranted) {
    if (ticket.asset.state === "AVAILABLE" && ticket.object.state === "READY") return prepared.url;
    throw new ImageStorageError("IMAGE_WRITE_CONFLICT");
  }
  let attempted = false;
  let versionId: string | null = null;
  try {
    if (options.signal?.aborted) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    attempted = true;
    const result = await putManagedImageObject({
      location: prepared.location, key: ticket.object.key, bytes: prepared.bytes,
      mimeType: ticket.object.mimeType, sha256: ticket.object.sha256, signal: options.signal,
    });
    versionId = result.versionId;
    if (options.rejectVersioned && versionId) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    const receipt = await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED", versionId });
    if (!receipt.accepted || receipt.asset.state !== "AVAILABLE" || receipt.object.state !== "READY") throw new ImageStorageError("IMAGE_WRITE_CONFLICT");
    return prepared.url;
  } catch (error) {
    await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken,
      outcome: attempted ? "UNKNOWN" : "NOT_WRITTEN", versionId, errorCode: "IMAGE_STORAGE_UNAVAILABLE" }).catch(() => undefined);
    throw error instanceof ImageStorageError ? error : new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE", { cause: error });
  } finally {
    await repository.closeReservation({ reservationId: prepared.reservation.id, token: prepared.reservation.token }).catch(() => undefined);
  }
}

export async function abandonPreparedImageWrite(prepared: PreparedManagedImageWrite, definitelyNotWritten: boolean): Promise<void> {
  if (!prepared.ticket.writeGranted) return;
  const repository = new ImageRepository();
  await repository.finishObject({ objectId: prepared.ticket.object.id, writeToken: prepared.ticket.object.writeToken,
    outcome: definitelyNotWritten ? "NOT_WRITTEN" : "UNKNOWN", errorCode: "IMAGE_STORAGE_UNAVAILABLE" });
  await repository.closeReservation({ reservationId: prepared.reservation.id, token: prepared.reservation.token });
}

export async function persistManagedImageBytes(bytes: Buffer, ownerId: string): Promise<string> {
  return completeManagedImageWrite(await prepareManagedImageWrite({ bytes, ownerId, purpose: "REFERENCE" }));
}

export async function resolveManagedImageUrl(url: string): Promise<ManagedImage | null> {
  const repository = new ImageRepository();
  const token = managedImagePublicToken(url, getEnv().APP_URL);
  if (token) {
    const image = await repository.getByToken(token);
    if (!image) throw new ImageStorageError("IMAGE_UNAVAILABLE");
    return image;
  }
  // Disabling new managed writes cannot make existing aliases unreadable.
  // Database failures propagate; they are not evidence of an external URL.
  return repository.resolveUrl(url);
}

function imageReadFailure(error: unknown): ImageStorageError {
  if (error instanceof ImageStorageError && error.code !== "IMAGE_LOCATION_CONFLICT") return error;
  if (error && typeof error === "object") {
    if ("code" in error && error.code === "LOCAL_IMAGE_NOT_FOUND") return new ImageStorageError("IMAGE_UNAVAILABLE", { cause: error });
    const metadata = "$metadata" in error ? error.$metadata : null;
    if ("name" in error && (error.name === "NoSuchKey" || error.name === "NotFound")
      && metadata && typeof metadata === "object" && "httpStatusCode" in metadata && metadata.httpStatusCode === 404) {
      return new ImageStorageError("IMAGE_UNAVAILABLE", { cause: error });
    }
  }
  return new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE", { cause: error });
}

async function protectManagedImageRead(image: ManagedImage, signal: AbortSignal) {
  if (signal.aborted) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  const lease = await new ImageRepository().beginRead({ assetId: image.asset.id });
  if (!lease) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  // Keep the IO deadline strictly inside the database's deletion fence,
  // including time spent waiting for the descriptor response.
  const timeout = Math.min(IMAGE_READ_TIMEOUT_MS, Date.parse(lease.readExpiresAt) - Date.now() - 5_000);
  if (!Number.isFinite(timeout) || timeout <= 0 || signal.aborted) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  return { image: lease.image, signal: AbortSignal.any([signal, AbortSignal.timeout(Math.floor(timeout))]) };
}

export async function readManagedImage(image: ManagedImage, signal: AbortSignal = AbortSignal.timeout(IMAGE_READ_TIMEOUT_MS)): Promise<Buffer> {
  const protectedRead = await protectManagedImageRead(image, signal);
  return readManagedImageBytes(protectedRead.image, protectedRead.signal);
}

async function readManagedImageBytes(image: ManagedImage, signal: AbortSignal): Promise<Buffer> {
  const { asset, object, location } = image;
  if (asset.state !== "AVAILABLE" || !object || object.state !== "READY" || !location) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  const length = Number(object.byteLength);
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_IMAGE_BYTES || object.sha256 !== asset.sha256) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  const environment = getEnv();
  if (location.provider === "LOCAL") {
    try { return await localStore(location, environment).read({ key: object.key, byteLength: length, sha256: object.sha256, signal }); }
    catch (error) { throw imageReadFailure(error); }
  }
  const client = s3Client(location, environment);
  let body: Readable | undefined;
  const abort = () => { body?.destroy(new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE")); };
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: location.bucket!, Key: object.key, VersionId: object.versionId ?? undefined }), { abortSignal: signal });
    if (!response.Body || (response.ContentLength !== undefined && response.ContentLength !== length)) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    if (!(response.Body instanceof Readable)) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    body = response.Body;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (signal.aborted) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
      if (!(chunk instanceof Uint8Array)) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
      size += chunk.byteLength;
      if (size > length) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks, size);
    if (size !== length || createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    return bytes;
  } catch (error) {
    throw imageReadFailure(error);
  } finally { signal.removeEventListener("abort", abort); body?.destroy(); client.destroy(); }
}

export async function headManagedImage(image: ManagedImage, signal: AbortSignal): Promise<void> {
  const protectedRead = await protectManagedImageRead(image, signal);
  image = protectedRead.image;
  signal = protectedRead.signal;
  const { asset, object, location } = image;
  if (asset.state !== "AVAILABLE" || object?.state !== "READY" || !location) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  const length = Number(object.byteLength);
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_IMAGE_BYTES) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  const environment = getEnv();
  if (location.provider === "LOCAL") {
    try { await localStore(location, environment).head({ key: object.key, byteLength: length, sha256: object.sha256, signal }); }
    catch (error) { throw imageReadFailure(error); }
    return;
  }
  const client = s3Client(location, environment);
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: location.bucket!, Key: object.key, VersionId: object.versionId ?? undefined }), { abortSignal: signal });
    if (result.ContentLength !== length) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
  } catch (error) { throw imageReadFailure(error); }
  finally { client.destroy(); }
}

export async function openManagedImage(image: ManagedImage, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const protectedRead = await protectManagedImageRead(image, signal);
  image = protectedRead.image;
  signal = protectedRead.signal;
  const { asset, object, location } = image;
  if (asset.state !== "AVAILABLE" || object?.state !== "READY" || !location) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  if (location.provider === "LOCAL") {
    try {
      const reader = await localStore(location, getEnv()).open({ key: object.key, byteLength: Number(object.byteLength), sha256: object.sha256, signal });
      return Readable.toWeb(reader.stream) as ReadableStream<Uint8Array>;
    } catch (error) { throw imageReadFailure(error); }
  }
  // S3's reader remains strictly bounded and verifies the complete checksum.
  const bytes = await readManagedImageBytes(image, signal);
  return new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });
}
