-- Additive: 生成媒体持久化形态元数据（可空，历史行保持 NULL）
-- B64: data URL fallback（仅开发/测试） | S3: 对象存储 | UPSTREAM: 上游直连（仅历史）
ALTER TABLE "GenerationImage" ADD COLUMN "mediaStorage" TEXT;
ALTER TABLE "GenerationImage" ADD COLUMN "storageKey" TEXT;

ALTER TABLE "GeneratedVideo" ADD COLUMN "mediaStorage" TEXT;
ALTER TABLE "GeneratedVideo" ADD COLUMN "storageKey" TEXT;
