import type { VideoAspectRatio, VideoResolution } from "./types";

export const VIDEO_DURATION_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "4 秒", value: 4 },
  { label: "8 秒", value: 8 },
  { label: "12 秒", value: 12 },
];

export const VIDEO_ASPECT_OPTIONS: Array<{ label: string; value: VideoAspectRatio }> = [
  { label: "横屏 16:9", value: "16:9" },
  { label: "竖屏 9:16", value: "9:16" },
  { label: "方形 1:1", value: "1:1" },
];

export const VIDEO_RESOLUTION_OPTIONS: Array<{ label: string; value: VideoResolution }> = [
  { label: "720p", value: "720p" },
  { label: "1080p", value: "1080p" },
];

// 比例 + 清晰度 → 渠道接受的像素 size 字符串。
const VIDEO_SIZE_MAP: Record<VideoAspectRatio, Record<VideoResolution, string>> = {
  "16:9": { "720p": "1280x720", "1080p": "1920x1080" },
  "9:16": { "720p": "720x1280", "1080p": "1080x1920" },
  "1:1": { "720p": "720x720", "1080p": "1080x1080" },
};

export function resolveVideoSize(aspectRatio: VideoAspectRatio, resolution: VideoResolution): string {
  return VIDEO_SIZE_MAP[aspectRatio]?.[resolution] ?? "1280x720";
}
