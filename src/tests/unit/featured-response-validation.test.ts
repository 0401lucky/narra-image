import { featuredCursorResponseSchema, featuredPageResponseSchema, featuredWorkResponseSchema, workLikeResponseSchema } from "@/lib/validators";

import { createGalleryWork, galleryCursor, galleryPage } from "./helpers/gallery-fixtures";

describe("central featured response validation", () => {
  it("defaults only an absent public flag to false and retains the full allowed text", () => {
    const { showPromptPublic, ...old } = createGalleryWork("old");
    expect(showPromptPublic).toBe(true);
    const parsed = featuredWorkResponseSchema.parse(old);
    expect(parsed.showPromptPublic).toBe(false);
    expect(parsed.prompt).toBe(old.prompt);
    expect(featuredWorkResponseSchema.safeParse({ ...old, showPromptPublic: "true" }).success).toBe(false);
    expect(featuredWorkResponseSchema.safeParse({ ...old, showPromptPublic: null }).success).toBe(false);
  });

  it("projects only the shared featured DTO fields, never negative prompts or review data", () => {
    const work = createGalleryWork("public", { prompt: "作者未公开提示词" });
    const result = featuredWorkResponseSchema.parse({ ...work, negativePrompt: "private", reviewer: { email: "private" } });
    expect(result).toEqual(work);
    expect(Object.keys(result).sort()).toEqual(Object.keys(work).sort());
  });

  it.each(["", "contains space", "cursor/unsafe", "cursor?query", "a".repeat(2049), null, 12])("rejects an invalid opaque cursor %s", (cursor) => {
    expect(featuredCursorResponseSchema.safeParse(cursor).success).toBe(false);
  });

  it("retains opaque cursor bytes and requires consistent hasMore/cursor values", () => {
    const cursor = galleryCursor(1);
    expect(featuredPageResponseSchema.parse(galleryPage([], cursor)).nextCursor).toBe(cursor);
    expect(featuredPageResponseSchema.safeParse({ items: [], hasMore: true, nextCursor: null }).success).toBe(false);
    expect(featuredPageResponseSchema.safeParse({ items: [], hasMore: false, nextCursor: cursor }).success).toBe(false);
  });

  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"])("rejects unusable like counts: %s", (likeCount) => {
    expect(workLikeResponseSchema.safeParse({ data: { likeCount, liked: true } }).success).toBe(false);
    expect(featuredWorkResponseSchema.safeParse(createGalleryWork("work", { likeCount: likeCount as number })).success).toBe(false);
  });
});
