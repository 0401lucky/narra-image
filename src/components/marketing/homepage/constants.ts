import type { HomeScene } from "./types";

export const HERO_SCENES = [
  {
    id: "film",
    label: "胶片光影",
    image: "/marketing/home/bookshop-light-v1.png",
    width: 1448,
    height: 1086,
    alt: "旧书店里，黄昏光束穿过百叶窗，照亮暖金色的浮尘",
    lightLabel: "黄金时刻逆光",
    preset: "Editorial · 胶片光影",
    prompt: "黄昏穿过旧书店百叶窗的丁达尔光束，微尘在暖金空气中漂浮，王家卫电影胶片颗粒感，柔和景深，叙事感构图",
  },
  {
    id: "storybook",
    label: "绘本叙事",
    image: "/marketing/home/lantern-fox-v1.png",
    width: 1448,
    height: 1086,
    alt: "小狐狸提着暖黄灯笼走过迷雾森林，水彩纸纹中点缀着星光",
    lightLabel: "手绘水彩肌理",
    preset: "Warm Fable · 绘本笔触",
    prompt: "提着暖黄煤油灯穿过迷雾森林的小狐狸，宫崎骏式温暖手绘水彩质感，星光点缀夜空，细腻纸张纹理",
  },
  {
    id: "oriental",
    label: "东方美学",
    image: "/marketing/home/jiangnan-rain-v2.png",
    width: 1448,
    height: 1086,
    alt: "江南雨巷的檐角滴着雨，远处暖黄灯笼倒映在青石板上",
    lightLabel: "东方水墨留白",
    preset: "Oriental Ink · 东方韵味",
    prompt: "江南雨巷檐角滴落的雨水，远处暖黄灯笼倒映在青石板水面，宋代美学克制留白，电影级冷暖色调对比",
  },
] as const satisfies readonly HomeScene[];

export const HOME_MOTION = {
  typewriterMs: 28,
  countUpMs: 1500,
  capabilityCycleMs: 2200,
  imageDeadlineMs: 12000,
  clipboardFeedbackMs: 2500,
  clipboardDeadlineMs: 5000,
  dustParticles: 32,
  maxPixelRatio: 2,
  revealDuration: 0.75,
  revealOffset: 24,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
} as const;

export const HOME_MEDIA = {
  reduced: "(prefers-reduced-motion: reduce)",
  finePointer: "(hover: hover) and (pointer: fine)",
  fullNavigation: "(min-width: 1360px)",
} as const;

export const HERO_STATS = [
  { id: "works", value: 150000, format: "comma", prefix: "", suffix: "+", label: "累计生成叙事画作" },
  { id: "models", value: 120, format: "integer", prefix: "", suffix: "+", label: "精调光影与胶片模型" },
  { id: "response", value: 4.2, format: "decimal", prefix: "< ", suffix: "s", label: "平均生成响应耗时" },
] as const;

export const CAPABILITIES = [
  { id: "prompt", title: "画笔写意 / 叙事生图", description: "捕捉文字背后的情绪与光影明暗，用多种画幅与镜头语言，为每一帧想象写下故事。" },
  { id: "versions", title: "创作迭代台 / 画布微调", description: "在多轮对话与画布中延伸灵感。参考已有画面继续创作，让构图与细节一步步接近心中所想。" },
  { id: "pet", title: "灵动数字宠物伴途", description: "让桌面小生灵陪你一起等待灵感、庆祝创作。在独自构思的片刻，也有轻盈温暖的陪伴。" },
  { id: "api", title: "开发者 API", description: "通过兼容 OpenAI 风格的图像接口，将影像生成接入自己的应用。调用方式与密钥在 API 控制台查看。" },
] as const;

export const PROMPT_PILLS = ["丁达尔夕阳", "35mm 胶片", "浅景深叙事"] as const;
export const VERSION_STEPS = [
  { title: "v1 初稿", description: "v1 · 线稿构图" },
  { title: "v2 补光", description: "v2 · 局部补光" },
  { title: "v3 终稿", description: "v3 · 胶片终稿" },
] as const;
export const PET_IDEAS = [
  "试试加入暖色侧逆光？",
  "加一点雨后青石板的反光细节吧。",
  "用柔焦镜头突出人物眼神的故事感。",
  "给画面留一处安静的呼吸空间。",
] as const;

export const GITHUB_URL = "https://github.com/0401lucky/narra-image";

export const FOOTER_CREATION_LINKS = [
  { href: "/create", label: "光影创作台" },
  { href: "/prompts", label: "叙事提示词库" },
  { href: "/video", label: "视频创作" },
] as const;

export const FOOTER_EXPLORE_LINKS = [
  { href: "#capabilities", label: "核心能力" },
  { href: "#gallery", label: "社区精选" },
  { href: GITHUB_URL, label: "GitHub 开源项目" },
] as const;
