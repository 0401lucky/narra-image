import type { SerializedConversation, SerializedGeneration } from "@/lib/prisma-mappers";

export type ConversationGenerationsPage = {
  conversationId: string;
  generations: SerializedGeneration[];
  nextCursor: string | null;
};

// Studio navigation carries counts, not every historical generation identifier.
export type StudioConversationSummary = Omit<SerializedConversation, "generationIds"> & {
  generationCount: number;
};
