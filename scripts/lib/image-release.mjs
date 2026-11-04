import { createHash } from "node:crypto";

export const RELEASE_REPOSITORY = "0401lucky/narra-image";
export const RELEASE_SOURCE = `https://github.com/${RELEASE_REPOSITORY}`;
export const RELEASE_IMAGES = Object.freeze({ app: "ghcr.io/0401lucky/narra-image-app", worker: "ghcr.io/0401lucky/narra-image-worker" });
export const RELEASE_LICENSE = "AGPL-3.0-only";
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MANIFEST_TYPES = ["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"];
const INDEX_TYPES = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"];
const BODY_LIMIT = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class ImageReleaseError extends Error {
  constructor(code, message, status) { super(`${code}: ${message}`); this.code = code; this.status = status; }
}
function fail(code, message, status) { throw new ImageReleaseError(code, message, status); }
export function assertDigest(value) {
  if (!DIGEST.test(value ?? "")) fail("INVALID_DIGEST", "Expected a sha256 content digest");
  return value;
}
function imagePath(image) {
  if (!Object.values(RELEASE_IMAGES).includes(image)) fail("INVALID_IMAGE", "Only the two repository images may be published");
  return image.slice("ghcr.io/".length);
}
export function assertReleaseContext({ repository, eventName, ref, sha, gates }) {
  if (repository !== RELEASE_REPOSITORY || eventName !== "push" || ref !== "refs/heads/main" || !SHA.test(sha ?? "")) {
    fail("UNTRUSTED_RELEASE", "Publication requires an exact main push in the original repository");
  }
  if (!["verify-ci", "verify-migrations", "verify-e2e"].every((name) => gates?.[name]?.result === "success")) {
    fail("UNVERIFIED_RELEASE", "All three verification jobs must succeed before publication");
  }
  return { sha, tag: `sha-${sha}` };
}

async function readBody(response) {
  if (Number(response.headers.get("content-length")) > BODY_LIMIT) {
    await response.body?.cancel();
    fail("REGISTRY_RESPONSE_SIZE", "Metadata response exceeds 2MiB");
  }
  const chunks = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > BODY_LIMIT) fail("REGISTRY_RESPONSE_SIZE", "Metadata response exceeds 2MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function parseJson(bytes) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Not a metadata object");
    return value;
  }
  catch { fail("REGISTRY_RESPONSE_INVALID", "Expected valid registry metadata JSON"); }
}
async function request(fetcher, url, init = {}, allowBlobRedirect = false) {
  try {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response = await fetcher(url, { ...init, signal, redirect: "manual" });
    if (allowBlobRedirect && [302, 307].includes(response.status)) {
      const location = new URL(response.headers.get("location"));
      if (location.protocol !== "https:" || location.hostname !== "pkg-containers.githubusercontent.com" || location.port || location.username || location.password) {
        fail("REGISTRY_REDIRECT", "Refused an unexpected registry blob redirect");
      }
      await response.body?.cancel();
      // Signed blob URLs must never receive the registry bearer token.
      response = await fetcher(location.href, { signal, redirect: "manual" });
    }
    return { status: response.status, headers: response.headers, bytes: await readBody(response) };
  } catch (error) {
    if (error instanceof ImageReleaseError) throw error;
    fail("REGISTRY_REQUEST_FAILED", "Registry/API request failed or exceeded its 30s deadline");
  }
}
function requireSuccess(response, operation) {
  if (response.status >= 200 && response.status < 300) return;
  fail([401, 403].includes(response.status) ? "REGISTRY_DENIED" : "REGISTRY_HTTP_ERROR", `${operation} returned HTTP ${response.status}`, response.status);
}

export class GhcrRegistry {
  constructor({ actor, token, fetcher = fetch } = {}) {
    if (Boolean(actor) !== Boolean(token)) fail("REGISTRY_CREDENTIALS", "Registry actor and token must be supplied together");
    this.credentials = token ? Buffer.from(`${actor}:${token}`).toString("base64") : null;
    this.fetcher = fetcher;
    this.tokens = new Map();
  }
  async bearer(image) {
    const name = imagePath(image);
    if (!this.tokens.has(name)) {
      const url = new URL("https://ghcr.io/token");
      url.searchParams.set("service", "ghcr.io");
      url.searchParams.set("scope", `repository:${name}:${this.credentials ? "pull,push" : "pull"}`);
      const response = await request(this.fetcher, url.href, { headers: this.credentials ? { Authorization: `Basic ${this.credentials}` } : {} });
      requireSuccess(response, "Registry authentication");
      const token = parseJson(response.bytes).token;
      if (typeof token !== "string" || !token || /[\r\n]/.test(token)) fail("REGISTRY_RESPONSE_INVALID", "Registry did not return a bearer token");
      this.tokens.set(name, token);
    }
    return this.tokens.get(name);
  }
  async get(image, kind, reference, missing = false) {
    const name = imagePath(image);
    if (!["manifests", "blobs"].includes(kind) || !(DIGEST.test(reference) || /^sha-[a-f0-9]{40}$/.test(reference))) fail("INVALID_REFERENCE", "Invalid immutable image reference");
    const response = await request(this.fetcher, `https://ghcr.io/v2/${name}/${kind}/${reference}`, {
      headers: { Authorization: `Bearer ${await this.bearer(image)}`, Accept: [...MANIFEST_TYPES, ...INDEX_TYPES].join(", ") },
    }, kind === "blobs");
    if (missing && response.status === 404) {
      const errors = parseJson(response.bytes).errors;
      if (Array.isArray(errors) && errors.length && errors.every((error) => ["MANIFEST_UNKNOWN", "NAME_UNKNOWN"].includes(error?.code))) return null;
    }
    requireSuccess(response, "Image metadata lookup");
    const digest = hash(response.bytes);
    const advertised = response.headers.get("docker-content-digest");
    if ((advertised && assertDigest(advertised) !== digest) || (DIGEST.test(reference) && reference !== digest)) fail("REGISTRY_DIGEST_MISMATCH", "Registry metadata bytes do not match their digest");
    return { digest, bytes: response.bytes, document: parseJson(response.bytes) };
  }
  async resolve(image, sha, { missing = false } = {}) {
    if (!SHA.test(sha ?? "")) fail("INVALID_SOURCE", "Expected a full source commit SHA");
    const top = await this.get(image, "manifests", `sha-${sha}`, missing);
    if (!top) return null;
    let manifest = top;
    if (INDEX_TYPES.includes(top.document.mediaType)) {
      const entries = top.document.manifests;
      const images = Array.isArray(entries) ? entries.filter((entry) => entry?.platform?.os === "linux" && entry.platform?.architecture === "amd64") : [];
      if (images.length !== 1 || entries.length > 4 || entries.some((entry) => !images.includes(entry) && (entry?.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest" || entry?.platform?.os !== "unknown" || entry?.platform?.architecture !== "unknown"))) {
        fail("INVALID_PLATFORM", "Expected one linux/amd64 image and optional attestations");
      }
      manifest = await this.get(image, "manifests", assertDigest(images[0].digest));
    }
    if (top.document.schemaVersion !== 2 || manifest.document.schemaVersion !== 2 || !MANIFEST_TYPES.includes(manifest.document.mediaType)) fail("INVALID_MANIFEST", "Unsupported image manifest");
    const config = await this.get(image, "blobs", assertDigest(manifest.document.config?.digest));
    const labels = config.document.config?.Labels;
    if (config.document.os !== "linux" || config.document.architecture !== "amd64") fail("INVALID_PLATFORM", "Image configuration is not linux/amd64");
    if (labels?.["org.opencontainers.image.source"] !== RELEASE_SOURCE || labels?.["org.opencontainers.image.revision"] !== sha || labels?.["org.opencontainers.image.licenses"] !== RELEASE_LICENSE) {
      fail("IMAGE_IDENTITY_MISMATCH", "Image source, revision or license labels do not match this release");
    }
    return { image, digest: top.digest, sha, tag: `sha-${sha}`, platform: "linux/amd64", manifest: top.bytes, mediaType: top.document.mediaType };
  }
  async promote(image) {
    const name = imagePath(image.image);
    if (!this.credentials) fail("REGISTRY_CREDENTIALS", "Anonymous clients cannot promote aliases");
    if (![...MANIFEST_TYPES, ...INDEX_TYPES].includes(image.mediaType) || hash(image.manifest) !== assertDigest(image.digest)) fail("INVALID_MANIFEST", "Promotion requires the verified immutable manifest");
    const response = await request(this.fetcher, `https://ghcr.io/v2/${name}/manifests/latest`, {
      method: "PUT", headers: { Authorization: `Bearer ${await this.bearer(image.image)}`, "Content-Type": image.mediaType }, body: image.manifest,
    });
    requireSuccess(response, "Latest promotion");
    if (assertDigest(response.headers.get("docker-content-digest")) !== image.digest) fail("REGISTRY_DIGEST_MISMATCH", "Published alias does not match the fixed source image");
  }
}

export async function currentMainSha(token, fetcher = fetch) {
  if (!token) fail("REGISTRY_CREDENTIALS", "Missing repository job token");
  const response = await request(fetcher, `https://api.github.com/repos/${RELEASE_REPOSITORY}/git/ref/heads/main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "narra-image-release" },
  });
  requireSuccess(response, "Current main lookup");
  const value = parseJson(response.bytes).object?.sha;
  if (!SHA.test(value ?? "")) fail("INVALID_SOURCE", "Main did not resolve to a full commit SHA");
  return value;
}

const publicImage = (image) => ({ image: image.image, tag: image.tag, digest: image.digest, platform: image.platform, reference: `${image.image}@${image.digest}` });
export async function prepareRelease(context, registry) {
  const { sha, tag } = assertReleaseContext(context);
  const images = {};
  for (const [name, image] of Object.entries(RELEASE_IMAGES)) {
    const existing = await registry.resolve(image, sha, { missing: true });
    images[name] = { image, build: !existing, digest: existing?.digest ?? "" };
  }
  return { sha, tag, images };
}

export function publicSetupMessage(image) {
  const name = imagePath(image).split("/")[1];
  return `Anonymous pull is unavailable for ${image}. Open https://github.com/users/0401lucky/packages/container/${name}/settings, check package access and Change visibility > Public, then re-run the failed publication job. Fixed source tags are retained; latest was not promoted.`;
}

export async function finishRelease(context, { registry, anonymous, expected, mainSha, report = () => {} }) {
  const { sha, tag } = assertReleaseContext(context);
  const resolved = [];
  const state = { sha, tag, status: "verifying", images: [], promoted: [] };
  try {
    for (const [name, image] of Object.entries(RELEASE_IMAGES)) {
      const value = await registry.resolve(image, sha);
      if (!value || value.digest !== assertDigest(expected[name])) fail("IMAGE_IDENTITY_MISMATCH", "Source tag changed or is missing after preparation/build");
      resolved.push(value);
    }
    state.images = resolved.map(publicImage);
    for (const image of resolved) {
      let visible;
      try { visible = await anonymous.resolve(image.image, sha); }
      catch (error) {
        if (error.code === "REGISTRY_DENIED" || error.status === 404) fail("PUBLIC_ACCESS_REQUIRED", publicSetupMessage(image.image));
        throw error;
      }
      if (visible?.digest !== image.digest) fail("PUBLIC_DIGEST_MISMATCH", "Anonymous manifest does not match the verified image");
    }
    state.anonymousAccess = true;
    if (await mainSha() !== sha) { state.status = "stale-main-skipped"; await report(state); return state; }
    for (const image of resolved) {
      // A new main push between package writes cannot make a delayed run promote again.
      if (await mainSha() !== sha) fail("STALE_MAIN", "Main changed during alias promotion; fixed tags remain safe to use");
      await registry.promote(image);
      state.promoted.push(image.image);
    }
    state.status = "published";
    await report(state);
    return state;
  } catch (error) {
    state.status = "failed";
    state.error = error instanceof ImageReleaseError ? error.message : "Release failed; fixed image tags are retained";
    await report(state);
    throw error;
  }
}
