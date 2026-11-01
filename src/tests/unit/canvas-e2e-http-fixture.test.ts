// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_HTTP_LIMITS, canvasFixtureBytes, encodeCanvasAppRequest, fixtureMain, performCanvasAppRequest, validateCanvasAppRequest } from "../../../scripts/fixtures/canvas-object-store.mjs";
import { createE2EConfiguration } from "../../../scripts/lib/e2e-safety.mjs";

const owner = createE2EConfiguration({}).owner;
function request() { return { owner, path: "/api/readyz", method: "GET", headers: {} as Record<string, string>, bodyBase64: "" }; }

afterEach(() => { vi.restoreAllMocks(); });

describe("owned internal E2E app HTTP transport", () => {
  it.each([
    "http://external.invalid/api/readyz", "//external.invalid/api/readyz", "/api/readyz?url=https://external.invalid",
    "/api/me/canvases/../users", "/api/me/canvases/%2e%2e", "/api/me/canvases/..", "/api/me/canvases\\other",
    "/api/admin/users", "/v1/images/generations", "/api/readyz#other",
  ])("rejects an unsafe destination before creating any request: %s", async (route) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(encodeCanvasAppRequest(owner, route)).rejects.toThrow(/allowlisted/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires exact owner, fields, method and the canvas opt-in header", () => {
    expect(() => validateCanvasAppRequest({ ...request(), owner: "foreign" }, owner)).toThrow(/owned/);
    expect(() => validateCanvasAppRequest({ ...request(), method: "CONNECT" }, owner)).toThrow(/allowlisted/);
    expect(() => validateCanvasAppRequest({ ...request(), url: "https://external.invalid" }, owner)).toThrow(/allowlisted/);
    expect(() => validateCanvasAppRequest({ ...request(), path: "/api/generate", method: "POST" }, owner)).toThrow(/headers/);
    expect(validateCanvasAppRequest({ ...request(), path: "/api/generate", method: "POST", headers: { "x-narra-canvas-run": "1" } }, owner)).toBeTruthy();
  });

  it.each([{ host: "external.invalid" }, { cookie: "session=one\r\nHost: external.invalid" }, { cookie: "x".repeat(8193) }, { authorization: "Bearer foreign" }])("rejects injected/unbounded headers: %j", (headers) => {
    expect(() => validateCanvasAppRequest({ ...request(), headers }, owner)).toThrow(/headers/);
  });

  it("bounds body and envelope decoding and never accepts a GET body", async () => {
    const value = { ...request(), path: "/api/me/canvases", method: "POST" };
    expect(() => validateCanvasAppRequest({ ...value, bodyBase64: "not base64!" }, owner)).toThrow(/malformed/);
    expect(() => validateCanvasAppRequest({ ...value, bodyBase64: Buffer.alloc(APP_HTTP_LIMITS.bodyBytes + 1).toString("base64") }, owner)).toThrow(/bound/);
    expect(() => validateCanvasAppRequest({ ...request(), bodyBase64: "eA==" }, owner)).toThrow(/malformed/);
    await expect(encodeCanvasAppRequest(owner, "/api/me/canvases", { method: "POST", body: "x".repeat(APP_HTTP_LIMITS.bodyBytes + 1) })).rejects.toThrow(/bound/);
    await expect(fixtureMain(["app-http"], {})).rejects.toThrow(/runner-owned/);
  });

  it("carries session and exact original bytes only in the bounded stdin envelope", async () => {
    const form = new FormData();
    const bytes = canvasFixtureBytes();
    form.set("file", new Blob([bytes], { type: "image/png" }), "original.png");
    const encoded = await encodeCanvasAppRequest(owner, "/api/me/canvas-assets", { method: "POST", headers: { cookie: "narra_session=test-only" }, body: form });
    const value = JSON.parse(encoded);
    expect(value.headers.cookie).toBe("narra_session=test-only");
    expect(value.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(Buffer.byteLength(encoded)).toBeLessThan(APP_HTTP_LIMITS.requestBytes);
    const recovered = await new Response(Buffer.from(value.bodyBase64, "base64"), { headers: { "content-type": value.headers["content-type"] } }).formData();
    expect(Buffer.from(await (recovered.get("file") as File).arrayBuffer())).toEqual(bytes);
  });

  it("fetches only fixed container loopback with redirects rejected and a shared body deadline", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"status":"ready"}', { headers: { "content-type": "application/json" } }));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    expect(await performCanvasAppRequest(request(), owner)).toEqual({ status: 200, contentType: "application/json", body: { status: "ready" } });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:3000/api/readyz", expect.objectContaining({ method: "GET", redirect: "error", signal: expect.any(AbortSignal) }));
    expect(timeout).toHaveBeenCalledWith(APP_HTTP_LIMITS.timeoutMs);
  });

  it("rejects oversized response streams rather than buffering their full body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(APP_HTTP_LIMITS.responseBytes + 1)));
    await expect(performCanvasAppRequest(request(), owner)).rejects.toThrow(/response.*bound/);
  });

  it("propagates request/body aborts without converting them into a successful HTTP result", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => new Response(new ReadableStream({
      start(stream) { options?.signal?.addEventListener("abort", () => stream.error(new DOMException("Timed out", "AbortError")), { once: true }); },
    })));
    const pending = performCanvasAppRequest(request(), owner);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
