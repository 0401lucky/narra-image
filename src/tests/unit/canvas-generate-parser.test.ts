// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: vi.fn() }));

import { CANVAS_LIMITS, CANVAS_RUN_REQUEST_HEADERS, type CanvasRunWireV1 } from "@/lib/canvas/contracts";
import { parseGenerateRequest } from "@/lib/generation/parse-generate-request";
import { canvasRunSchema } from "@/lib/validators";

const id = (value: number) => `aaaaaaaa-0000-4000-8000-${String(value).padStart(12, "0")}`;
const wire = (): CanvasRunWireV1 => canvasRunSchema.parse({
  canvasId: id(1), nodeId: id(2), runId: id(3), input: { prompt: { sourceNodeId: id(4), text: "frozen prompt" }, references: [] },
  parameters: { model: "gpt-image-2", generationType: "text_to_image", count: 4, size: "16:9", quality: "high", outputFormat: "webp", outputCompression: 82 },
});
function request(input: unknown, headers: HeadersInit = CANVAS_RUN_REQUEST_HEADERS) {
  return new Request("https://app.invalid/api/generate", { method: "POST", headers, body: JSON.stringify(input) });
}

describe("opt-in canvas generation transport", () => {
  it("maps the strict frozen projection into the existing normalized generation options", async () => {
    const result = await parseGenerateRequest(request({ canvasRun: wire(), turnstileToken: "fresh-runtime-token" }));
    expect(result).toMatchObject({
      canvasRun: wire(), prompt: "frozen prompt", count: 4, generationType: "text_to_image", providerMode: "built_in",
      model: "gpt-image-2", size: "1824x1024", quality: "high", outputFormat: "webp", outputCompression: 82,
      images: [], image: null, imageUrls: [], turnstileToken: "fresh-runtime-token",
    });
    expect(result.conversationId).toBeUndefined();
    expect(result.replaceGenerationId).toBeUndefined();
    expect(JSON.stringify(result.canvasRun)).not.toContain("fresh-runtime-token");
  });

  it("canonicalizes reference order and keeps owned IDs separate from source URLs", async () => {
    const run = wire();
    run.parameters = { ...run.parameters, count: 1, generationType: "image_to_image", negativePrompt: null, seed: null };
    run.input.references = [
      { sourceNodeId: "result:image_b", kind: "result", imageId: "image_b", jobId: "job_b", ordinal: 2 },
      { sourceNodeId: id(5), kind: "imported", assetId: "asset_a", ordinal: 1 },
    ];
    const result = await parseGenerateRequest(request({ canvasRun: run }));
    expect(result.canvasRun?.input.references.map((reference) => reference.ordinal)).toEqual([1, 2]);
    expect(result).toMatchObject({ count: 1, generationType: "image_to_image", negativePrompt: null, seed: null, imageUrls: [], images: [] });
  });

  it("keeps custom credentials and CAPTCHA exclusively in transient request fields", async () => {
    const run = wire();
    run.parameters.providerMode = "custom";
    const customProvider = { apiKey: "runtime-secret", baseUrl: "https://provider.invalid/v1", model: "gpt-image-2", remember: false };
    const result = await parseGenerateRequest(request({ canvasRun: run, customProvider, turnstileToken: "captcha-secret" }));
    expect(result.customProvider).toMatchObject(customProvider);
    expect(JSON.stringify(result.canvasRun)).not.toMatch(/runtime-secret|captcha-secret|baseUrl|apiKey/);
  });

  it.each(["conversationId", "replaceGenerationId", "prompt", "imageUrls", "referenceImageUrls", "image", "files", "providerMode"])("rejects mixed legacy field %s", async (key) => {
    await expect(parseGenerateRequest(request({ canvasRun: wire(), [key]: "untrusted" }))).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
  });

  it.each(["prompt", "references", "params"])("does not accept the flat local projection field %s as a wire field", async (key) => {
    await expect(parseGenerateRequest(request({ canvasRun: { ...wire(), [key]: "untrusted" } }))).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
  });

  it("requires the explicit header even when a no-header body contains otherwise valid legacy fields", async () => {
    const legacy = { model: "gpt-image-2", prompt: "legacy prompt", canvasRun: wire() };
    await expect(parseGenerateRequest(request(legacy, { "Content-Type": "application/json" }))).rejects.toMatchObject({ code: "CANVAS_RUN_OPT_IN_REQUIRED" });
    const form = new FormData();
    form.append("canvasRun", JSON.stringify(wire()));
    await expect(parseGenerateRequest(form)).rejects.toMatchObject({ code: "CANVAS_RUN_OPT_IN_REQUIRED" });
    await expect(parseGenerateRequest(new Request("https://app.invalid/api/generate", { method: "POST", body: form }))).rejects.toMatchObject({ code: "CANVAS_RUN_OPT_IN_REQUIRED" });
  });

  it.each(["", "0", "true", "2"])("rejects invalid opt-in value %s before consuming the body", async (value) => {
    const body = request({ canvasRun: wire() }, { "Content-Type": "application/json", "X-Narra-Canvas-Run": value });
    await expect(parseGenerateRequest(body)).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
    expect(body.bodyUsed).toBe(false);
  });

  it("rejects opt-in multipart and video instead of falling back to the legacy parser", async () => {
    const form = new FormData();
    form.append("canvasRun", JSON.stringify(wire()));
    await expect(parseGenerateRequest(new Request("https://app.invalid/api/generate", { method: "POST", headers: { "X-Narra-Canvas-Run": "1" }, body: form }))).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
    const run = wire();
    await expect(parseGenerateRequest(request({ canvasRun: { ...run, parameters: { ...run.parameters, generationType: "text_to_video" } } }))).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
  });

  it.each(["x", "x".repeat(8001)])("enforces the existing prompt execution bounds", async (text) => {
    const run = wire();
    run.input.prompt.text = text;
    await expect(parseGenerateRequest(request({ canvasRun: run }))).rejects.toHaveProperty("code");
  });

  it("enforces count one with references and the 16-source cap", async () => {
    const run = wire();
    run.parameters.generationType = "image_to_image";
    run.input.references = [{ sourceNodeId: id(5), ordinal: 1, kind: "imported", assetId: "asset_a" }];
    await expect(parseGenerateRequest(request({ canvasRun: run }))).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
    run.parameters.count = 1;
    run.input.references = Array.from({ length: 17 }, (_, index) => ({ sourceNodeId: id(50 + index), ordinal: index + 1, kind: "imported", assetId: `asset_${index}` }));
    await expect(parseGenerateRequest(request({ canvasRun: run }))).rejects.toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
    run.input.references = run.input.references.slice(0, 16);
    const parsed = await parseGenerateRequest(request({ canvasRun: run }));
    expect(parsed.canvasRun?.input.references).toHaveLength(16);
    expect(parsed).toMatchObject({ count: 1, generationType: "image_to_image" });
  });

  it.each([
    { sourceNodeId: id(5), ordinal: 1, kind: "imported", assetId: "https://untrusted.invalid/image.png" },
    { sourceNodeId: id(5), ordinal: 1, kind: "imported", assetId: "asset_a", url: "data:image/png;base64,AAAA" },
    { sourceNodeId: "result:wrong", ordinal: 1, kind: "result", jobId: "job_a", imageId: "image_a" },
    { sourceNodeId: id(5), ordinal: 1, kind: "local", blobId: id(6), uploadId: id(7) },
  ])("rejects raw URL/blob references and forged result identities", async (reference) => {
    const run = wire();
    await expect(parseGenerateRequest(request({ canvasRun: { ...run, parameters: { ...run.parameters, count: 1, generationType: "image_to_image" }, input: { ...run.input, references: [reference] } } }))).rejects.toHaveProperty("code");
  });

  it("bounds the stream even without Content-Length and cancels oversized transport", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(CANVAS_LIMITS.runBodyBytes + 1)); }, cancel });
    const input = new Request("https://app.invalid/api/generate", { method: "POST", headers: CANVAS_RUN_REQUEST_HEADERS, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    await expect(parseGenerateRequest(input)).rejects.toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
    expect(cancel).toHaveBeenCalled();
  });

  it("keeps the new byte cap off legacy JSON and preserves video parsing", async () => {
    const result = await parseGenerateRequest(request({
      model: "sora-2", prompt: "legacy video prompt", generationType: "text_to_video", durationSeconds: 8, aspectRatio: "16:9",
      ignoredLegacyField: "x".repeat(CANVAS_LIMITS.runBodyBytes + 1),
    }, { "Content-Type": "application/json" }));
    expect(result).toMatchObject({ canvasRun: null, generationType: "text_to_video", durationSeconds: 8, aspectRatio: "16:9" });
  });
});
