import { isGenerationItem } from "@/components/create/generation-item";
import type { GenerationItem } from "@/components/create/types";

import { conversationGeneration } from "./helpers/conversation-fixtures";

const legacy: GenerationItem = {
  id: "opaque:job_1", createdAt: "2026-10-01T00:00:00.000Z", count: 1, creditsSpent: 0,
  status: "succeeded", generationType: "text_to_image", providerMode: "built_in",
  prompt: "Legacy prompt", model: "legacy-model", size: "auto",
  images: [{ id: "opaque:image_1", url: "data:image/png;base64,fixture" }],
};

describe("generation UI DTO guard", () => {
  it("accepts serialized jobs and legacy optional image/video metadata without rewriting them", () => {
    const current = conversationGeneration("current");
    const video = { ...legacy, images: [], generationType: "text_to_video", videos: [{ id: "video_1", url: "https://media.invalid/video.mp4" }] };
    const original = JSON.stringify(legacy);
    expect(isGenerationItem(current)).toBe(true);
    expect(isGenerationItem(legacy)).toBe(true);
    expect(isGenerationItem(video)).toBe(true);
    expect(JSON.stringify(legacy)).toBe(original);
  });

  it.each([
    null, undefined, [], "generation", 1,
  ])("rejects a non-record DTO %j", (value) => {
    expect(isGenerationItem(value)).toBe(false);
  });

  it.each([
    { id: "" }, { id: "  " }, { id: [] }, { conversationId: {} },
    { count: 0 }, { count: 1.5 }, { count: Number.NaN }, { creditsSpent: Number.POSITIVE_INFINITY },
    { createdAt: "not-a-date" }, { updatedAt: "not-a-date" }, { completedAt: {} },
    { status: ["succeeded"] }, { status: "unknown" }, { providerMode: ["custom"] }, { generationType: ["text_to_image"] },
    { prompt: {} }, { model: null }, { size: [] }, { quality: 2 }, { outputFormat: 1 },
    { images: null }, { images: [null] }, { images: [{ id: "image", url: [] }] },
    { images: [{ id: "image", url: "https://media.invalid/a.png", actualSize: {} }] },
    { images: [{ id: "image", url: "https://media.invalid/a.png", actualWidth: Number.NaN }] },
    { videos: {} }, { videos: [null] }, { videos: [{ id: "video", url: "https://media.invalid/a.mp4", posterUrl: {} }] },
    { sourceImageUrl: {} }, { sourceImageUrls: "https://media.invalid/a.png" }, { sourceImageUrls: [null] },
    { negativePrompt: {} }, { errorMessage: {} }, { durationMs: "1" }, { outputCompression: [] },
  ])("rejects malformed UI fields %j", (fields) => {
    expect(isGenerationItem({ ...legacy, ...fields })).toBe(false);
  });
});
