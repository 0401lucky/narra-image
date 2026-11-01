import type { ConversationGenerationsPage } from "@/lib/conversations/contracts";
import type { SerializedGeneration } from "@/lib/prisma-mappers";

export function conversationGeneration(id: string, conversationId = "conversation_a", overrides: Partial<SerializedGeneration> = {}): SerializedGeneration {
  return {
    id, conversationId, status: "succeeded", generationType: "text_to_image", providerMode: "built_in",
    count: 1, creditsSpent: 5, prompt: `prompt ${id}`, model: "gpt-image-2", size: "auto", quality: "auto",
    moderation: "auto", outputFormat: "png", outputCompression: null, negativePrompt: null,
    providerChannelId: null, sourceImageUrl: null, sourceImageUrls: [], images: [], videos: [],
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    startedAt: null, completedAt: null, cancelRequestedAt: null, durationMs: null,
    contractVersion: 0, handoffState: null, errorCode: null, errorMessage: null, featuredAt: null,
    aspectRatio: null, durationSeconds: null, ...overrides,
  };
}

export function conversationPage(generations: SerializedGeneration[] = [], nextCursor: string | null = null, conversationId = "conversation_a"): ConversationGenerationsPage {
  return { conversationId, generations, nextCursor };
}
