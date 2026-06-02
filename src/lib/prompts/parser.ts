import type { PromptSourceParser } from "@/lib/prompts/source-config";

export type PromptFetchSource = {
  parser: string;
  rawBaseUrl: string;
  slug: string;
};

export type FetchedPrompt = {
  coverUrl?: string | null;
  preview?: string | null;
  previewUrls: string[];
  prompt: string;
  remoteId: string;
  sortOrder: number;
  tags: string[];
  title: string;
};

type ReadRemoteFile = (filePath: string) => Promise<string>;

const GPT_IMAGE_2_CASE_FILES = [
  "README.md",
  "cases/ad-creative.md",
  "cases/character.md",
  "cases/comparison.md",
  "cases/ecommerce.md",
  "cases/portrait.md",
  "cases/poster.md",
  "cases/ui.md",
];

type GptImage2Data = {
  records?: Array<{
    added_at?: string;
    category?: string;
    image_dir?: string;
    title?: string;
    tweet_url?: string;
  }>;
};

type DavidWuPrompt = {
  author?: string;
  category?: string;
  category_cn?: string;
  id?: number;
  image?: string;
  needs_ref?: boolean;
  note?: string;
  prompt?: string;
  source?: string;
  title_cn?: string;
  title_en?: string;
};

export async function parseRemotePrompts(source: PromptFetchSource, readFile: ReadRemoteFile) {
  const parser = source.parser as PromptSourceParser;
  switch (parser) {
    case "gpt-image-2-prompts":
      return parseGptImage2Prompts(source, readFile);
    case "awesome-gpt-image":
      return parseAwesomeGptImage(source, readFile);
    case "awesome-gpt4o-image-prompts":
      return parseAwesomeGpt4oImagePrompts(source, readFile);
    case "youmind-gpt-image-2":
      return parseYouMindPrompts(source, readFile, "gpt-image-2");
    case "youmind-nano-banana-pro":
      return parseYouMindPrompts(source, readFile, "nano-banana-pro");
    case "davidwu-gpt-image2-prompts":
      return parseDavidWuGptImage2Prompts(source, readFile);
    default:
      throw new Error(`未知提示词解析器：${source.parser}`);
  }
}

async function parseGptImage2Prompts(source: PromptFetchSource, readFile: ReadRemoteFile) {
  const metadata = parseJson<GptImage2Data>(await readFile("data/ingested_tweets.json"));
  const promptByTweetUrl = new Map<string, string>();

  for (const filePath of GPT_IMAGE_2_CASE_FILES) {
    collectGptImage2Cases(promptByTweetUrl, await readFile(filePath));
  }

  return (metadata.records ?? [])
    .map((record, index): FetchedPrompt | null => {
      const tweetUrl = record.tweet_url?.trim();
      const prompt = tweetUrl ? promptByTweetUrl.get(tweetUrl)?.trim() : "";
      const title = record.title?.trim();
      if (!prompt || !title || !record.image_dir) return null;

      const coverUrl = absoluteRemoteUrl(source.rawBaseUrl, `${record.image_dir}/output.jpg`);
      return {
        coverUrl,
        preview: markdownPreview([coverUrl]),
        previewUrls: [coverUrl],
        prompt,
        remoteId: `tweet-${stableRemoteId(tweetUrl || `${index + 1}`)}`,
        sortOrder: index + 1,
        tags: tagsFromCategory(record.category ?? ""),
        title,
      };
    })
    .filter((item): item is FetchedPrompt => item !== null);
}

function collectGptImage2Cases(target: Map<string, string>, markdown: string) {
  const casePattern =
    /### Case \d+: \[[^\]]+]\(([^)]+)\)[\s\S]*?\*\*Prompt:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/g;

  for (const match of markdown.matchAll(casePattern)) {
    const url = match[1]?.trim();
    const prompt = match[2]?.trim();
    if (url && prompt) target.set(url, prompt);
  }
}

async function parseAwesomeGptImage(source: PromptFetchSource, readFile: ReadRemoteFile) {
  const markdown = await readFile("README.zh-CN.md");
  const prompts: FetchedPrompt[] = [];

  for (const section of splitBeforeHeading(markdown, "## ")) {
    const sectionTags = tagsFromHeading(firstMatch(section, /^##\s+(.+)$/m));
    for (const block of splitBeforeHeading(section, "### ")) {
      const heading = firstMatch(block, /^###\s+(.+)$/m);
      const title = markdownLinkText(heading).trim();
      const prompt = firstMatch(block, /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/).trim();
      if (!title || !prompt) continue;

      const previewUrls = extractMarkdownImages(source.rawBaseUrl, block);
      prompts.push({
        coverUrl: previewUrls[0] ?? null,
        preview: markdownPreview(previewUrls),
        previewUrls,
        prompt,
        remoteId: `${source.slug}-${pad(prompts.length + 1)}`,
        sortOrder: prompts.length + 1,
        tags: sectionTags,
        title,
      });
    }
  }

  return prompts;
}

async function parseAwesomeGpt4oImagePrompts(source: PromptFetchSource, readFile: ReadRemoteFile) {
  const markdown = await readFile("README.zh-CN.md");
  const prompts: FetchedPrompt[] = [];

  for (const block of splitBeforeHeading(markdown, "### ")) {
    const title = firstMatch(block, /^###\s+(.+)$/m).trim();
    const prompt = firstMatch(block, /-\s+\*\*提示词文本：\*\*\s*`([\s\S]*?)`/).trim();
    if (!title || !prompt) continue;

    const previewUrls = extractMarkdownImages(source.rawBaseUrl, block);
    prompts.push({
      coverUrl: previewUrls[0] ?? null,
      preview: markdownPreview(previewUrls),
      previewUrls,
      prompt,
      remoteId: `${source.slug}-${pad(prompts.length + 1)}`,
      sortOrder: prompts.length + 1,
      tags: ["gpt4o"],
      title,
    });
  }

  return prompts;
}

async function parseYouMindPrompts(source: PromptFetchSource, readFile: ReadRemoteFile, modelTag: string) {
  const markdown = await readFile("README_zh.md");
  const prompts: FetchedPrompt[] = [];

  for (const block of splitBeforeHeading(markdown, "### ")) {
    const title = firstMatch(block, /^###\s+No\.\s*\d+:\s*(.+)$/m).trim();
    const prompt = firstMatch(block, /#### [\s\S]*?提示词\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/).trim();
    if (!title || !prompt) continue;

    const previewUrls = extractMarkdownImages(source.rawBaseUrl, block);
    prompts.push({
      coverUrl: previewUrls[0] ?? null,
      preview: markdownPreview(previewUrls),
      previewUrls,
      prompt,
      remoteId: `${source.slug}-${pad(prompts.length + 1)}`,
      sortOrder: prompts.length + 1,
      tags: youMindTags(title, modelTag),
      title,
    });
  }

  return prompts;
}

async function parseDavidWuGptImage2Prompts(source: PromptFetchSource, readFile: ReadRemoteFile) {
  const data = parseJson<DavidWuPrompt[]>(await readFile("prompts.json"));

  return data
    .map((item, index): FetchedPrompt | null => {
      const title = (item.title_cn || item.title_en || "").trim();
      const prompt = item.prompt?.trim();
      if (!title || !prompt) return null;

      const coverUrl = absoluteRemoteUrl(source.rawBaseUrl, item.image ?? "");
      const preview = [
        item.title_en?.trim(),
        item.note?.trim(),
        coverUrl ? `![](${coverUrl})` : "",
      ].filter(Boolean).join("\n\n");

      return {
        coverUrl: coverUrl || null,
        preview,
        previewUrls: coverUrl ? [coverUrl] : [],
        prompt,
        remoteId: `${source.slug}-${pad(item.id ?? index + 1)}`,
        sortOrder: index + 1,
        tags: davidWuTags(item),
        title,
      };
    })
    .filter((item): item is FetchedPrompt => item !== null);
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("提示词源 JSON 解析失败");
  }
}

function splitBeforeHeading(markdown: string, prefix: string) {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of markdown.split("\n")) {
    if (line.startsWith(prefix) && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function firstMatch(value: string, pattern: RegExp) {
  return pattern.exec(value)?.[1] ?? "";
}

function markdownLinkText(value: string) {
  return value.replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
}

function extractMarkdownImages(baseUrl: string, block: string) {
  const seen = new Set<string>();
  const images: string[] = [];
  const patterns = [/<img[^>]+src=["']([^"']+)["']/g, /!\[[^\]]*]\(([^)]+)\)/g];

  for (const pattern of patterns) {
    for (const match of block.matchAll(pattern)) {
      const image = absoluteRemoteUrl(baseUrl, stripMarkdownUrl(match[1] ?? ""));
      if (image && !seen.has(image)) {
        seen.add(image);
        images.push(image);
      }
    }
  }

  return images;
}

function stripMarkdownUrl(value: string) {
  return value.trim().replace(/^<|>$/g, "").split(/\s+/)[0] ?? "";
}

function absoluteRemoteUrl(baseUrl: string, path: string) {
  const image = path.trim();
  if (!image || image.startsWith("data:")) return "";
  if (/^https?:\/\//i.test(image)) return image;

  const normalized = image.replace(/^\.?\//, "");
  return `${baseUrl.replace(/\/$/, "")}/${normalized}`;
}

function markdownPreview(images: string[]) {
  return images.filter(Boolean).map((image) => `![](${image})`).join("\n\n");
}

function tagsFromCategory(category: string) {
  return splitTags(category.replace(/\s+Cases$/i, ""), /\s*(?:&|and)\s*/i);
}

function tagsFromHeading(heading: string) {
  return splitTags(heading.replace(/[^\w\u4e00-\u9fa5/&、与 ]/g, ""), /\s*(?:\/|&|、|与)\s*/);
}

function youMindTags(title: string, modelTag: string) {
  const [prefix] = title.split(" - ");
  return uniqueTags([modelTag, ...tagsFromHeading(prefix ?? "")]);
}

function davidWuTags(item: DavidWuPrompt) {
  const tags = splitTags(
    [item.category_cn, item.category, item.author, item.source].filter(Boolean).join("/"),
    /\//,
  );
  if (item.needs_ref) tags.push("需要参考图");
  return uniqueTags(tags);
}

function splitTags(value: string, pattern: RegExp) {
  return uniqueTags(
    value
      .split(pattern)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  );
}

function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags)).slice(0, 12);
}

function stableRemoteId(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "item";
}

function pad(value: number) {
  return String(value).padStart(3, "0");
}
