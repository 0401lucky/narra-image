#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const XML_NAMESPACE = "http://s3.amazonaws.com/doc/2006-03-01/";
const VERSIONING_STATES = new Set(["unversioned", "enabled", "suspended", "denied", "unknown"]);
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const UNVERSIONED_XML = `<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration xmlns="${XML_NAMESPACE}"/>`;
const FIXTURE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP438DwHwAGgAJ/EEwb4QAAAABJRU5ErkJggg==";
export function canvasFixtureBytes() { return Buffer.from(FIXTURE_PNG, "base64"); }
export const APP_HTTP_LIMITS = Object.freeze({ requestBytes: 256 * 1024, bodyBytes: 128 * 1024, responseBytes: 1024 * 1024, timeoutMs: 10_000 });

function permittedAppRoute(route, method) {
  const id = "[A-Za-z0-9_.:-]{1,128}";
  return (method === "GET" && (route === "/create" || route === "/api/readyz" || route === "/api/me/canvases"
    || new RegExp(`^/api/me/(?:canvases|canvas-assets|canvas-runs)/${id}$`).test(route)
    || new RegExp(`^/api/me/canvas-assets/uploads/${id}$`).test(route)))
    || (method === "POST" && ["/api/me/canvases", "/api/me/canvas-assets", "/api/me/canvas-runtime/resolve", "/api/generate"].includes(route))
    || (["PATCH", "DELETE"].includes(method) && new RegExp(`^/api/me/canvases/${id}$`).test(route))
    || (method === "PUT" && new RegExp(`^/api/me/canvases/${id}/snapshot$`).test(route));
}

export function validateCanvasAppRequest(value, owner) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "bodyBase64,headers,method,owner,path"
    || !/^[a-f0-9-]{36}$/.test(owner ?? "") || value.owner !== owner
    || typeof value.path !== "string" || /[\\%?#\x00-\x20\x7f]/.test(value.path)
    || value.path.split("/").some((part) => part === "." || part === "..")
    || !permittedAppRoute(value.path, value.method)) throw new Error("Only owned, allowlisted local app requests are permitted");
  if (!value.headers || typeof value.headers !== "object" || Array.isArray(value.headers)
    || Object.entries(value.headers).some(([name, header]) => !["cookie", "content-type", "x-narra-canvas-run"].includes(name)
      || typeof header !== "string" || header.length > 8192 || /[\x00-\x1f\x7f]/.test(header))
    || (value.path === "/api/generate" && value.headers["x-narra-canvas-run"] !== "1")) throw new Error("Unsafe app request headers");
  if (typeof value.bodyBase64 !== "string" || value.bodyBase64.length > Math.ceil(APP_HTTP_LIMITS.bodyBytes / 3) * 4
    || Buffer.from(value.bodyBase64, "base64").toString("base64") !== value.bodyBase64
    || Buffer.from(value.bodyBase64, "base64").length > APP_HTTP_LIMITS.bodyBytes
    || (value.method === "GET" && value.bodyBase64 !== "")) throw new Error("App request body exceeds the fixture bound or is malformed");
  if (Buffer.byteLength(JSON.stringify(value)) > APP_HTTP_LIMITS.requestBytes) throw new Error("App request envelope exceeds the fixture bound");
  return value;
}

export async function encodeCanvasAppRequest(owner, route, options = {}) {
  if (!permittedAppRoute(route, options.method ?? "GET") || /[\\%?#\x00-\x20\x7f]/.test(route)
    || route.split("/").some((part) => part === "." || part === "..")) throw new Error("Only allowlisted local app paths are permitted");
  const request = new Request(`http://127.0.0.1:3000${route}`, options);
  const value = { owner, path: route, method: request.method, headers: Object.fromEntries(request.headers), bodyBase64: Buffer.from(await request.arrayBuffer()).toString("base64") };
  return JSON.stringify(validateCanvasAppRequest(value, owner));
}

export async function performCanvasAppRequest(value, owner) {
  validateCanvasAppRequest(value, owner);
  const response = await fetch(`http://127.0.0.1:3000${value.path}`, {
    method: value.method, headers: value.headers, redirect: "error", signal: AbortSignal.timeout(APP_HTTP_LIMITS.timeoutMs),
    ...(value.bodyBase64 ? { body: Buffer.from(value.bodyBase64, "base64") } : {}),
  });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > APP_HTTP_LIMITS.responseBytes) throw new Error("App response exceeds the fixture bound");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, contentType: response.headers.get("content-type"), body };
}

function requestError(status, code) { return Object.assign(new Error(code), { status, code }); }

function reply(response, status, body = "", headers = {}) {
  response.writeHead(status, { "cache-control": "no-store", ...headers });
  response.end(body);
}

function errorReply(response, status, code) {
  reply(response, status, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>Isolated E2E fixture request rejected</Message></Error>`, {
    "content-type": "application/xml", "connection": "close",
  });
}

function readBody(request, maximum) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const fail = (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      request.resume();
      reject(error);
    };
    if (request.headers["content-length"] && (!/^\d+$/.test(request.headers["content-length"]) || Number(request.headers["content-length"]) > maximum)) {
      fail(requestError(413, "EntityTooLarge"));
    }
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maximum) { fail(requestError(413, "EntityTooLarge")); return; }
      chunks.push(chunk);
    });
    request.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
    request.once("error", () => fail(requestError(400, "InvalidRequest")));
    request.once("aborted", () => fail(requestError(400, "InvalidRequest")));
  });
}

function objectRoute(rawUrl, bucket) {
  const [rawPath, rawQuery = ""] = rawUrl.split("?", 2);
  if (!rawPath.startsWith("/") || rawPath.length > 2048) throw requestError(400, "InvalidURI");
  let parts;
  // SDK bucket operations may add a trailing slash; object keys are never
  // normalized, so this exception applies only to the exact bucket root.
  const routePath = rawPath === `/${bucket}/` ? rawPath.slice(0, -1) : rawPath;
  try { parts = routePath.slice(1).split("/").map((part) => decodeURIComponent(part)); }
  catch { throw requestError(400, "InvalidURI"); }
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\/\x00-\x1f\x7f]/.test(part))) throw requestError(400, "InvalidURI");
  if (parts.shift() !== bucket) throw requestError(404, "NoSuchBucket");
  return { key: parts.join("/"), query: new URLSearchParams(rawQuery) };
}

/**
 * In-memory S3 protocol fixture, not an S3 server or signature verifier.
 * Only one random bucket and the runner's fake access key are accepted.
 */
export function createCanvasObjectStore({
  bucket, accessKey, controlToken, maxObjectBytes = 8 * 1024 * 1024,
  maxTotalBytes = 32 * 1024 * 1024, maxObjects = 32,
}) {
  if (!/^narra-e2e-[a-f0-9-]{16,64}$/.test(bucket) || !/^e2e-[a-f0-9]{32}$/.test(accessKey) || !/^[A-Za-z0-9_-]{32,128}$/.test(controlToken)) {
    throw new Error("The object fixture requires random runner-only bucket, access key and control token");
  }
  for (const limit of [maxObjectBytes, maxTotalBytes, maxObjects]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid fixture memory bound");
  }
  const objects = new Map();
  const counters = { versioning: 0, put: 0, head: 0, get: 0, delete: 0 };
  let bytesStored = 0;
  let versioning = "unversioned";
  let failDeletes = false;
  let inflight = 0;

  const handler = async (request, response) => {
    if (++inflight > 8) { inflight--; request.resume(); errorReply(response, 503, "SlowDown"); return; }
    try {
      const rawUrl = request.url ?? "";
      if (rawUrl.startsWith("/__e2e/")) {
        if (!LOOPBACK.has(request.socket.remoteAddress)) throw requestError(403, "AccessDenied");
        if (rawUrl === "/__e2e/health" && request.method === "GET") { reply(response, 200, "ok"); return; }
        if (request.headers["x-narra-e2e-token"] !== controlToken) throw requestError(403, "AccessDenied");
        if (rawUrl === "/__e2e/control" && request.method === "POST") {
          let control;
          try { control = JSON.parse((await readBody(request, 1024)).toString("utf8")); }
          catch (error) { if (error.status) throw error; throw requestError(400, "InvalidRequest"); }
          if (!control || typeof control !== "object" || Array.isArray(control)
            || Object.keys(control).some((key) => !["versioning", "failDeletes"].includes(key))
            || (control.versioning !== undefined && !VERSIONING_STATES.has(control.versioning))
            || (control.failDeletes !== undefined && typeof control.failDeletes !== "boolean")) throw requestError(400, "InvalidRequest");
          if (control.versioning !== undefined) versioning = control.versioning;
          if (control.failDeletes !== undefined) failDeletes = control.failDeletes;
        } else if (rawUrl !== "/__e2e/status" || request.method !== "GET") throw requestError(405, "MethodNotAllowed");
        reply(response, 200, JSON.stringify({ versioning, failDeletes, objectCount: objects.size, bytesStored, counters }), { "content-type": "application/json" });
        return;
      }

      const authorization = request.headers.authorization ?? "";
      if (!authorization.startsWith("AWS4-HMAC-SHA256 ") || !authorization.includes(`Credential=${accessKey}/`)) throw requestError(403, "AccessDenied");
      const { key, query } = objectRoute(rawUrl, bucket);
      if (!key && request.method === "GET" && query.has("versioning") && [...query.keys()].every((key) => ["versioning", "x-id"].includes(key))) {
        counters.versioning++;
        if (versioning === "denied") throw requestError(403, "AccessDenied");
        const body = versioning === "unversioned" ? UNVERSIONED_XML
          : versioning === "unknown" ? "<Error><Code>UnsupportedOperation</Code></Error>"
            : `<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration xmlns="${XML_NAMESPACE}"><Status>${versioning === "enabled" ? "Enabled" : "Suspended"}</Status></VersioningConfiguration>`;
        reply(response, 200, body, { "content-type": "application/xml" });
        return;
      }
      // There is deliberately no bucket/prefix listing, bucket deletion,
      // multipart upload, copy, or version-delete operation.
      if (!key || [...query.keys()].some((key) => key !== "x-id")) throw requestError(405, "MethodNotAllowed");
      const existing = objects.get(key);
      if (request.method === "PUT") {
        const bytes = await readBody(request, maxObjectBytes);
        if (request.headers["if-none-match"] === "*" && objects.has(key)) throw requestError(412, "PreconditionFailed");
        const previous = objects.get(key);
        if ((!previous && objects.size >= maxObjects) || bytesStored - (previous?.bytes.length ?? 0) + bytes.length > maxTotalBytes) throw requestError(507, "InsufficientStorage");
        const digest = createHash("sha256").update(bytes).digest("base64");
        if (request.headers["x-amz-checksum-sha256"] && request.headers["x-amz-checksum-sha256"] !== digest) throw requestError(400, "BadDigest");
        const etag = `"${createHash("md5").update(bytes).digest("hex")}"`;
        objects.set(key, { bytes, etag, type: request.headers["content-type"] ?? "application/octet-stream" });
        bytesStored += bytes.length - (previous?.bytes.length ?? 0);
        counters.put++;
        reply(response, 200, "", { etag, "x-amz-checksum-sha256": digest });
      } else if (request.method === "HEAD" || request.method === "GET") {
        counters[request.method === "HEAD" ? "head" : "get"]++;
        if (!existing) throw requestError(404, "NoSuchKey");
        reply(response, 200, request.method === "HEAD" ? "" : existing.bytes, {
          "content-type": existing.type, "content-length": String(existing.bytes.length), etag: existing.etag,
        });
      } else if (request.method === "DELETE") {
        counters.delete++;
        if (failDeletes) throw requestError(503, "ServiceUnavailable");
        if (existing) { objects.delete(key); bytesStored -= existing.bytes.length; }
        reply(response, 204);
      } else throw requestError(405, "MethodNotAllowed");
    } catch (error) {
      if (!response.headersSent) errorReply(response, error.status ?? 500, error.code ?? "InternalError");
      else response.destroy();
    } finally { inflight--; }
  };

  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 5_000, headersTimeout: 5_000, connectionsCheckingInterval: 1_000 }, handler);
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function readFixtureResponse(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(3_000) });
  let text = "";
  for await (const chunk of response.body ?? []) {
    text += Buffer.from(chunk).toString("utf8");
    if (Buffer.byteLength(text, "utf8") > 32 * 1024) throw new Error("Fixture probe response too large");
  }
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

/** @param {string[]} [args] @param {Record<string, string | undefined>} [source] */
export async function fixtureMain(args = process.argv.slice(2), source = process.env) {
  if (args[0] === "app-http") {
    if (args.length !== 1 || source.E2E_FIXTURE_APP_HTTP !== "1" || !/^[a-f0-9-]{36}$/.test(source.E2E_OWNER_TOKEN ?? "")) throw new Error("App HTTP requires the runner-owned internal container");
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => process.stdin.destroy(new Error("App request input timed out")), APP_HTTP_LIMITS.timeoutMs);
    timer.unref();
    try {
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > APP_HTTP_LIMITS.requestBytes) throw new Error("App request envelope exceeds the fixture bound");
        chunks.push(chunk);
      }
    } finally { clearTimeout(timer); }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    console.log(JSON.stringify(await performCanvasAppRequest(value, source.E2E_OWNER_TOKEN)));
    return;
  }
  if (args[0] === "probe") {
    const target = new URL(args[1]);
    if (target.protocol !== "http:" || target.username || target.password || target.search || target.hash
      || !["127.0.0.1", "worker"].includes(target.hostname) || target.port !== "8081" || target.pathname !== "/readyz") {
      throw new Error("Only an internal Worker readiness GET is allowed");
    }
    console.log(JSON.stringify(await readFixtureResponse(target)));
    return;
  }
  if (args[0] === "control") {
    const state = args[1];
    if (state !== "status" && !VERSIONING_STATES.has(state) && !["fail-deletes", "allow-deletes"].includes(state)) throw new Error("Unknown fixture control");
    const result = await readFixtureResponse(`http://127.0.0.1:9090/__e2e/${state === "status" ? "status" : "control"}`, {
      method: state === "status" ? "GET" : "POST",
      headers: { "x-narra-e2e-token": source.E2E_STORE_TOKEN, "content-type": "application/json" },
      ...(state === "status" ? {} : { body: JSON.stringify(VERSIONING_STATES.has(state) ? { versioning: state } : { failDeletes: state === "fail-deletes" }) }),
    });
    if (result.status !== 200) throw new Error("Fixture control rejected");
    console.log(JSON.stringify(result.body));
    return;
  }
  if (args[0] === "objects") {
    const [method, encodedKeys] = args.slice(1);
    if (args.length !== 3 || !["put", "head"].includes(method)
      || source.E2E_FIXTURE_CONTAINER !== "1" || !/^[a-f0-9-]{36}$/.test(source.E2E_OWNER_TOKEN ?? "")
      || !/^narra-e2e-[a-f0-9-]{16,64}$/.test(source.E2E_STORE_BUCKET ?? "")
      || !/^e2e-[a-f0-9]{32}$/.test(source.E2E_STORE_ACCESS_KEY ?? "")) throw new Error("Object operations require the runner-owned fixture");
    const keys = JSON.parse(encodedKeys);
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 32 || new Set(keys).size !== keys.length
      || keys.some((key) => typeof key !== "string" || !/^[a-zA-Z0-9_./-]{1,512}$/.test(key)
        || key.split("/").some((part) => !part || part === "." || part === "..")
        || (method === "put" && !new RegExp(`^e2e/${source.E2E_OWNER_TOKEN}/[a-f0-9-]{36}\\.png$`).test(key)))) {
      throw new Error("Only explicit bounded fixture keys are allowed");
    }
    const bytes = canvasFixtureBytes();
    const results = [];
    for (const key of keys) {
      // Seeding is deliberately not a signature conformance test. Runtime
      // Node/Go requests still exercise their real SDKs against this fixture.
      const result = await readFixtureResponse(`http://127.0.0.1:9090/${source.E2E_STORE_BUCKET}/${key}`, {
        method: method.toUpperCase(),
        headers: {
          authorization: `AWS4-HMAC-SHA256 Credential=${source.E2E_STORE_ACCESS_KEY}/20261030/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=fixture`,
          ...(method === "put" ? { "content-type": "image/png", "if-none-match": "*", "x-amz-checksum-sha256": createHash("sha256").update(bytes).digest("base64") } : {}),
        },
        ...(method === "put" ? { body: bytes } : {}),
      });
      if (method === "put" && result.status !== 200) throw new Error(`Fixture object seed failed (${result.status})`);
      results.push({ key, status: result.status });
    }
    console.log(JSON.stringify(results));
    return;
  }
  if (args.length) throw new Error("Unknown object-store fixture command");
  if (source.E2E_FIXTURE_CONTAINER !== "1" || !/^[a-f0-9-]{36}$/.test(source.E2E_OWNER_TOKEN ?? "")) {
    throw new Error("Listening is restricted to the runner-owned internal Compose fixture");
  }
  const server = createCanvasObjectStore({ bucket: source.E2E_STORE_BUCKET, accessKey: source.E2E_STORE_ACCESS_KEY, controlToken: source.E2E_STORE_TOKEN });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(9090, "0.0.0.0", resolve); });
  console.log("[canvas-object-store] isolated in-memory fixture listening");
  const close = () => { server.close(); server.closeAllConnections(); };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try { await fixtureMain(); }
  catch (error) { console.error(`[canvas-object-store] ${error.message}`); process.exitCode = 1; }
}
