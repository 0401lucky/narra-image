// 创作台 UI 选项常量。集中放置便于策略调整和 i18n。
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
} from "@/lib/types";
import type { SizeOption } from "./types";

export const SIZE_OPTIONS: SizeOption[] = [
  { detail: "模型决定", label: "自动", value: "auto" },
  { detail: "1:1", label: "1K 方图", value: "1024x1024" },
  { detail: "3:2", label: "1.5K 横图", value: "1536x1024" },
  { detail: "2:3", label: "1.5K 竖图", value: "1024x1536" },
  { detail: "1:1", label: "2K 方图", value: "2048x2048" },
  { detail: "16:9", label: "2K 横屏", value: "2048x1152" },
  { detail: "9:16", label: "2K 竖屏", value: "1152x2048" },
  { detail: "16:9", label: "4K 横屏", value: "3840x2160" },
  { detail: "9:16", label: "4K 竖屏", value: "2160x3840" },
  { detail: "高级设置", label: "自定义", value: "custom" },
];

export const QUALITY_OPTIONS: Array<{ label: string; value: GenerationQuality }> = [
  { label: "自动", value: "auto" },
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
];

export const OUTPUT_FORMAT_OPTIONS: Array<{ label: string; value: GenerationOutputFormat }> = [
  { label: "PNG", value: "png" },
  { label: "JPEG", value: "jpeg" },
  { label: "WebP", value: "webp" },
];

export const MODERATION_OPTIONS: Array<{ label: string; value: GenerationModeration }> = [
  { label: "自动", value: "auto" },
  { label: "低限制", value: "low" },
];

// 参考图最大数量，与后端 parseGenerateRequest 的 16 张限制保持一致。
export const MAX_REFERENCE_IMAGES = 16;

// 历史图片拖入 Composer 时使用的内部拖拽类型，避免和参考图排序的 text/plain 冲突。
export const HISTORY_IMAGE_DRAG_MIME = "application/x-narra-history-image";

// 渠道返回实际像素相对于请求像素的容忍偏差；超过则视为渠道降级（free 号池/反代静默缩水）。
export const SIZE_DOWNGRADE_TOLERANCE = 0.05;

// 单个 generation 任务的轮询参数。
export const POLL_DELAYS_MS = [1500, 2000, 3000, 5000, 8000];
export const POLL_MAX_ATTEMPTS = 200;

// localStorage 键。如果未来要做 schema 升级，新键名带上 _v2 即可。
export const SESSIONS_STORAGE_KEY = "narra_sessions";
