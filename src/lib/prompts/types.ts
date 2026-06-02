export type PromptSourceStatus = "IDLE" | "SYNCING" | "SUCCESS" | "FAILED";

export type PromptLibrarySourceOption = {
  id: string;
  itemCount: number;
  name: string;
  slug: string;
};

export type PromptLibraryPrompt = {
  coverUrl: string | null;
  createdAt: string;
  id: string;
  preview: string | null;
  previewUrls: string[];
  prompt: string;
  source: {
    id: string;
    name: string;
    slug: string;
    sourceUrl: string;
  };
  sourceUrl: string;
  tags: string[];
  title: string;
  updatedAt: string;
};

export type PromptLibraryResponse = {
  categories: PromptLibrarySourceOption[];
  items: PromptLibraryPrompt[];
  page: number;
  pageSize: number;
  tags: string[];
  total: number;
};

export type AdminPromptSource = {
  description: string | null;
  id: string;
  isEnabled: boolean;
  itemCount: number;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  name: string;
  parser: string;
  rawBaseUrl: string;
  slug: string;
  sortOrder: number;
  sourceUrl: string;
  status: PromptSourceStatus;
};
