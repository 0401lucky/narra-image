import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getSensitiveWordsSnapshot,
  matchSensitiveWords,
  SENSITIVE_CATEGORIES,
  SENSITIVE_CATEGORY_LABELS,
} from "@/lib/moderation/sensitive-words";

describe("敏感词库", () => {
  it("英文短语按词边界命中", () => {
    const hits = matchSensitiveWords("generate explicit sex content");
    expect(hits).toContainEqual({ category: "NSFW", word: "explicit sex" });
  });

  it("英文词不误杀子串（词边界）", () => {
    // \banal\b 不命中 analysis 里的子串；\bporn\b 不命中 pornstar
    expect(matchSensitiveWords("a statistical analysis")).not.toContainEqual({
      category: "NSFW",
      word: "anal",
    });
    expect(matchSensitiveWords("pornstar biography")).not.toContainEqual({
      category: "NSFW",
      word: "porn",
    });
  });

  it("高危词词形变体同样命中", () => {
    expect(matchSensitiveWords("pornographic comic of a catgirl")).toContainEqual({
      category: "NSFW",
      word: "pornographic",
    });
    expect(matchSensitiveWords("she was raped by the villain")).toContainEqual({
      category: "NSFW",
      word: "raped",
    });
    expect(matchSensitiveWords("porno style render")).toContainEqual({
      category: "NSFW",
      word: "porno",
    });
  });

  it("crack 作为普通词不误杀，crack cocaine 作为毒品词命中", () => {
    expect(matchSensitiveWords("how to crack the code puzzle")).toEqual([]);
    expect(matchSensitiveWords("a crack appeared in the vase")).toEqual([]);
    expect(matchSensitiveWords("sells crack cocaine")).toContainEqual({
      category: "ILLEGAL",
      word: "crack cocaine",
    });
  });

  it("中文子串命中", () => {
    const hits = matchSensitiveWords("一张色情图片");
    expect(hits).toContainEqual({ category: "NSFW", word: "色情" });
  });

  it("prompt 与 negativePrompt 一并检查", () => {
    const hits = matchSensitiveWords("平静的风景", "禁止出现 gore 场面");
    expect(hits).toContainEqual({ category: "VIOLENCE", word: "gore" });
  });

  it("艺术/常态词不误杀", () => {
    const safeTexts = [
      "naked portrait in studio",
      "nude art museum exhibition",
      "blood moon over the lake",
      "erotic poetry reading",
      "classic oil painting of a woman",
    ];
    for (const text of safeTexts) {
      expect(matchSensitiveWords(text), text).toEqual([]);
    }
  });

  it("按类别返回命中", () => {
    expect(matchSensitiveWords("nigger")).toContainEqual({
      category: "HATE",
      word: "nigger",
    });
    expect(matchSensitiveWords("cocaine")).toContainEqual({
      category: "ILLEGAL",
      word: "cocaine",
    });
    expect(matchSensitiveWords("碎尸现场")).toContainEqual({
      category: "VIOLENCE",
      word: "碎尸",
    });
  });

  it("空输入返回空", () => {
    expect(matchSensitiveWords(null, undefined, "")).toEqual([]);
  });

  it("快照覆盖全部类别且有词与中文标签", () => {
    const snapshot = getSensitiveWordsSnapshot();
    expect(snapshot).toHaveLength(SENSITIVE_CATEGORIES.length);
    for (const item of snapshot) {
      expect(item.count).toBeGreaterThan(0);
      expect(item.words.length).toBe(item.count);
      expect(SENSITIVE_CATEGORY_LABELS[item.category]).toBeTruthy();
    }
  });
});