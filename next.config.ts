import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 后端 S3_PUBLIC_BASE_URL、第三方 OAuth 头像（LinuxDo 等）域名都是
    // 运行时配置，构建期不可知，所以这里放开通配。
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    formats: ["image/avif", "image/webp"],
    // 缩略图常用宽度（imageSizes）+ 屏幕宽度档位（deviceSizes）
    // 调用 /_next/image?w=xxx 时，xxx 必须落在这两个集合的并集里。
    imageSizes: [16, 32, 48, 64, 96, 128, 192, 256, 384],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
  },
};

export default nextConfig;
