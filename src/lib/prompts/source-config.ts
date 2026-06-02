export type PromptSourceParser =
  | "gpt-image-2-prompts"
  | "awesome-gpt-image"
  | "awesome-gpt4o-image-prompts"
  | "youmind-gpt-image-2"
  | "youmind-nano-banana-pro"
  | "davidwu-gpt-image2-prompts";

export type DefaultPromptSource = {
  description: string;
  name: string;
  parser: PromptSourceParser;
  rawBaseUrl: string;
  slug: string;
  sortOrder: number;
  sourceUrl: string;
};

export const DEFAULT_PROMPT_SOURCES: DefaultPromptSource[] = [
  {
    description: "EvoLinkAI 整理的 GPT Image 2 API 案例，覆盖广告、角色、海报、电商与 UI 等图像方向。",
    name: "GPT Image 2 Prompts",
    parser: "gpt-image-2-prompts",
    rawBaseUrl: "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main",
    slug: "gpt-image-2-prompts",
    sortOrder: 10,
    sourceUrl: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
  },
  {
    description: "ZeroLu 的中文 GPT Image 案例集合，按视觉类型整理示例图和提示词。",
    name: "Awesome GPT Image",
    parser: "awesome-gpt-image",
    rawBaseUrl: "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main",
    slug: "awesome-gpt-image",
    sortOrder: 20,
    sourceUrl: "https://github.com/ZeroLu/awesome-gpt-image",
  },
  {
    description: "ImgEdify 收集的 GPT-4o 图像提示词案例，包含中英文说明与结果图。",
    name: "Awesome GPT-4o Image Prompts",
    parser: "awesome-gpt4o-image-prompts",
    rawBaseUrl: "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main",
    slug: "awesome-gpt4o-image-prompts",
    sortOrder: 30,
    sourceUrl: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts",
  },
  {
    description: "YouMind OpenLab 的 GPT Image 2 中文提示词精选，适合快速寻找成片方向。",
    name: "YouMind GPT Image 2",
    parser: "youmind-gpt-image-2",
    rawBaseUrl: "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main",
    slug: "youmind-gpt-image-2",
    sortOrder: 40,
    sourceUrl: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2",
  },
  {
    description: "YouMind OpenLab 的 Nano Banana Pro 提示词集合，偏产品、海报与写实创作场景。",
    name: "YouMind Nano Banana Pro",
    parser: "youmind-nano-banana-pro",
    rawBaseUrl: "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main",
    slug: "youmind-nano-banana-pro",
    sortOrder: 50,
    sourceUrl: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
  },
  {
    description: "davidwuw0811-boop 的 GPT Image 2 提示词 JSON 数据源，包含分类、作者和参考图标记。",
    name: "awesome-gpt-image2-prompts",
    parser: "davidwu-gpt-image2-prompts",
    rawBaseUrl: "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main",
    slug: "davidwu-gpt-image2-prompts",
    sortOrder: 60,
    sourceUrl: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts",
  },
];
