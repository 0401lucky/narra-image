import { getPublicEnv } from "@/lib/public-env";

/**
 * 把远程原图 URL 包装成 Next.js Image Optimization 端点 URL。
 *
 * 调用 /_next/image 时，Next.js 会按 width 输出 AVIF/WebP，并按
 * Cache-Control 缓存。原图（OAuth 头像、S3 上传）原样下发会非常浪费带宽。
 *
 * @param src     原图 URL；data:/blob: 直接原样返回
 * @param width   目标宽度，必须命中 next.config 的 imageSizes/deviceSizes
 * @param quality 0-100，默认 75
 */
const LEGACY_IMAGE_HOST = "image.204152.xyz";
const DEFAULT_OPTIMIZER_BYPASS_HOSTS = [LEGACY_IMAGE_HOST];

export function normalizeImageUrl(src: string): string {
  // Only this verified CDN is upgraded; custom bypass hosts may be HTTP-only.
  const httpHost = /^http:\/\/([^/?#]+)/i.exec(src)?.[1];
  return httpHost?.toLowerCase() === LEGACY_IMAGE_HOST
    ? src.replace(/^http:/i, "https:")
    : src;
}

function getOptimizerBypassHosts() {
  const configured = getPublicEnv().NEXT_PUBLIC_IMAGE_OPTIMIZER_BYPASS_HOSTS
    ?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return configured && configured.length > 0
    ? configured
    : DEFAULT_OPTIMIZER_BYPASS_HOSTS;
}

function shouldBypassOptimizer(src: string) {
  try {
    const url = new URL(src);
    return getOptimizerBypassHosts().includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function getThumbUrl(
  src: string | null | undefined,
  width: number,
  quality = 75,
): string {
  if (!src) return "";
  // 本地预览（用户刚选的文件）和 base64 不需要走优化
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  // 已经是 /_next/image 的不要重复包
  if (src.startsWith("/_next/image")) return src;
  const imageSrc = normalizeImageUrl(src);
  // 部分自建 CDN 域名会解析到内网或保留地址，Next Image 会拒绝代理。
  // 对这些域名直接使用原图 URL，避免创作台结果图变成破图。
  if (shouldBypassOptimizer(imageSrc)) return imageSrc;

  const params = new URLSearchParams({
    url: imageSrc,
    w: String(width),
    q: String(quality),
  });
  return `/_next/image?${params.toString()}`;
}

/**
 * 生成响应式 srcset 字符串，配合 <img sizes> 让浏览器根据视口和 DPR
 * 自己挑合适的档位，避免移动端高 DPR 屏拉糊、桌面大屏拉浪费。
 * Omit the srcset attribute when the result is empty.
 *
 * @param widths 必须命中 next.config 的 imageSizes/deviceSizes，否则 Next 会拒绝
 */
export function getThumbSrcSet(
  src: string | null | undefined,
  widths: number[],
  quality = 75,
): string {
  if (!src) return "";
  if (src.startsWith("data:") || src.startsWith("blob:")) return "";
  if (shouldBypassOptimizer(src)) return "";
  return widths.map((w) => `${getThumbUrl(src, w, quality)} ${w}w`).join(", ");
}
