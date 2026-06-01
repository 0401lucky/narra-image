# 视频工作区 · 后端生成链路 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后端能端到端异步生成视频——前端提交视频任务 → 创建 `GenerationJob`（PENDING）→ Go Worker 调用 OpenAI 兼容视频接口（提交→轮询→取结果）→ 落库 `GeneratedVideo` → 前端轮询拿到结果。

**Architecture:** 扩展现有 `GenerationJob` + Go Worker，不新建独立子系统。视频「提交→轮询→取结果」完全在单次 Worker 任务内完成，任务保持 `PROCESSING` 直到 Worker 内部轮询结束；前端沿用现有 `GET /api/me/generations/{id}` 轮询，零改动。视频接口形态集中在一个适配层 `worker/internal/worker/video.go`，联调时只改这里。

**Tech Stack:** Next.js 16 + Prisma 7（`prisma db push`）+ zod 4 + vitest 4（前端/Node 侧）；Go + pgx + aws-sdk-go-v2 + 标准 `testing`/`httptest`（Worker 侧）。包管理器 pnpm。

**范围拆分（来自 spec §13 的 Scope Check）：** spec 横跨数据层、API、Worker、前端、作品广场五个子系统。本计划只覆盖**后端生成链路（阶段 1-3）**，完成后视频可经 API + Worker 端到端生成并落库、可被现有轮询取到。后续：
- **计划二**（阶段 4）：`/video` 前端工作区页面与组件。
- **计划三**（阶段 5-6）：作品广场视频接入（`WorkLike` 改造、showcase/审核/点赞、打磨）。

**本计划不做：** `WorkLike` 改造与 `GeneratedVideo.likes` 关系（属点赞功能，留计划三）；任何前端页面/组件；后台渠道编辑表单的「视频积分单价」输入框（属计划二/三的前端面，本计划仅在数据层与 env 落地 `videoCreditCost`）。

---

## 文件结构

**修改：**
- `prisma/schema.prisma` — 枚举扩展、`GenerationJob` 视频字段、新增 `GeneratedVideo`、`User` 反向关系、`ProviderChannel.videoCreditCost`
- `src/lib/types.ts` — `GenerationType` 联合类型加视频两种
- `src/lib/prisma-mappers.ts` — `toPrismaGenerationType`/`fromPrismaGenerationType`/`SerializedGeneration`/`serializeGeneration`
- `src/lib/validators.ts` — `generateSchema` 加 `generationType` 视频分支 + `durationSeconds`/`aspectRatio`
- `src/lib/generation/parse-generate-request.ts` — 两条解析路径透传 `durationSeconds`/`aspectRatio`
- `src/lib/env.ts` — 加 `BUILTIN_PROVIDER_VIDEO_CREDIT_COST`
- `src/lib/credits.ts` — 加 `resolveCreditCost`（按 `generationType` 取价）
- `src/lib/providers/built-in-provider.ts` — `ResolvedChannel.videoCreditCost` + 各函数返回
- `src/app/api/generate/route.ts` — 视频计费分支 + `job.create` 透传视频字段 + `include.videos`
- `worker/internal/worker/worker.go` — `GenerationJob` struct 字段、`claimJob` 列、`processJob` 分叉、新增 `completeVideoJob`
- `worker/internal/worker/storage.go` — 新增 `PersistVideo`
- `worker/internal/worker/config.go` — 视频配置项

**创建：**
- `worker/internal/worker/video.go` — 视频客户端适配层 + `generateVideo`
- `worker/internal/worker/video_test.go` — 视频客户端契约 + `generateVideo` 分支测试

**测试（修改）：**
- `src/tests/unit/generation-serialization.test.ts`
- `src/tests/unit/parse-generate-request.test.ts`
- `src/tests/unit/credits.test.ts`
- `worker/internal/worker/config_test.go`

---

## Task 1: Prisma 数据模型 — 视频枚举与表

**Files:**
- Modify: `prisma/schema.prisma`

> schema 改动是声明式，无单元测试；验证 = `prisma generate` 成功 + `tsc` 不报错。本仓库用 `prisma db push`（见 `schema.prisma` 内 `BuiltInProviderConfig` 注释「避免 prisma db push 数据丢失」与 `package.json` 的 `db:push`）。新增字段全部可空或带默认值，`db push` 安全无数据丢失。

- [ ] **Step 1: 扩展 `GenerationType` 枚举**

`prisma/schema.prisma:26-29`，把：

```prisma
enum GenerationType {
  TEXT_TO_IMAGE
  IMAGE_TO_IMAGE
}
```

改为：

```prisma
enum GenerationType {
  TEXT_TO_IMAGE
  IMAGE_TO_IMAGE
  TEXT_TO_VIDEO
  IMAGE_TO_VIDEO
}
```

- [ ] **Step 2: 给 `GenerationJob` 加视频字段与反向关系**

`prisma/schema.prisma`，在 `GenerationJob` 模型内 `sourceImageUrls String[] @default([])`（约 318 行）之后、`count` 之前加两个字段；并在 `images GenerationImage[]`（约 331 行）之后加 `videos` 反向关系：

```prisma
  sourceImageUrls         String[]               @default([])
  durationSeconds         Int?
  aspectRatio             String?
  count                   Int
```

```prisma
  images                  GenerationImage[]
  videos                  GeneratedVideo[]
```

- [ ] **Step 3: 新增 `GeneratedVideo` 模型**

`prisma/schema.prisma` 末尾（`GenerationImage` 模型之后）追加。注意：本计划**不含** `likes WorkLike[]` 关系（留计划三连同 `WorkLike` 改造一起加）：

```prisma
model GeneratedVideo {
  id               String         @id @default(cuid())
  jobId            String
  url              String
  posterUrl        String?
  width            Int?
  height           Int?
  durationSeconds  Int?
  showcaseStatus   ShowcaseStatus @default(PRIVATE)
  showPromptPublic Boolean        @default(false)
  submittedAt      DateTime?
  featuredAt       DateTime?
  reviewedAt       DateTime?
  reviewNote       String?
  reviewedById     String?
  createdAt        DateTime       @default(now())
  job              GenerationJob  @relation(fields: [jobId], references: [id], onDelete: Cascade)
  reviewedBy       User?          @relation("ReviewedVideos", fields: [reviewedById], references: [id], onDelete: SetNull)

  @@index([showcaseStatus, featuredAt(sort: Desc), id(sort: Desc)])
  @@index([jobId, createdAt])
  @@index([createdAt(sort: Desc), id(sort: Desc)])
}
```

- [ ] **Step 4: 给 `User` 加 `reviewedVideos` 反向关系**

`prisma/schema.prisma`，`User` 模型内 `reviewedWorks GenerationImage[] @relation("ReviewedWorks")`（约 67 行）之后加：

```prisma
  reviewedWorks        GenerationImage[]    @relation("ReviewedWorks")
  reviewedVideos       GeneratedVideo[]     @relation("ReviewedVideos")
```

- [ ] **Step 5: 给 `ProviderChannel` 加 `videoCreditCost`**

`prisma/schema.prisma`，`ProviderChannel` 模型内 `creditCost Int @default(5)`（约 176 行）之后加：

```prisma
  creditCost      Int      @default(5)
  videoCreditCost Int      @default(20)
```

- [ ] **Step 6: 同步数据库 schema 并重新生成 client**

Run: `pnpm db:push && pnpm db:generate`
Expected: `db push` 输出 `Your database is now in sync with your Prisma schema.`；`generate` 输出 `Generated Prisma Client`。

- [ ] **Step 7: 类型自检（确认新 schema 不破坏现有代码）**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（新增枚举值与可空字段不破坏既有引用）。

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(video): 扩展 Prisma 数据模型支持视频生成"
```

---

## Task 2: TS 类型与序列化扩展

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/prisma-mappers.ts`
- Test: `src/tests/unit/generation-serialization.test.ts`

- [ ] **Step 1: 写失败测试 — 视频任务序列化输出 `videos` 与视频参数**

`src/tests/unit/generation-serialization.test.ts`，在现有 `it(...)` 之后、`describe` 闭合 `});` 之前插入新用例：

```ts
  it("返回视频结果和视频参数，供视频工作区展示", () => {
    const result = serializeGeneration({
      count: 1,
      completedAt: new Date("2026-04-23T08:01:15.000Z"),
      createdAt: new Date("2026-04-23T08:00:00.000Z"),
      creditsSpent: 20,
      errorMessage: null,
      featuredAt: null,
      featuredById: null,
      generationType: "TEXT_TO_VIDEO",
      id: "job_v1",
      images: [],
      videos: [
        {
          createdAt: new Date("2026-04-23T08:01:00.000Z"),
          durationSeconds: 8,
          featuredAt: null,
          height: 720,
          id: "video_1",
          jobId: "job_v1",
          posterUrl: "https://example.com/poster.jpg",
          reviewNote: null,
          reviewedAt: null,
          reviewedById: null,
          showcaseStatus: "PRIVATE",
          showPromptPublic: false,
          submittedAt: null,
          url: "https://example.com/result.mp4",
          width: 1280,
        },
      ],
      aspectRatio: "16:9",
      durationSeconds: 8,
      model: "sora-2",
      negativePrompt: null,
      prompt: "海浪拍打礁石的慢镜头",
      providerMode: ProviderMode.BUILT_IN,
      size: "1280x720",
      sourceImageUrls: [],
      startedAt: new Date("2026-04-23T08:00:02.000Z"),
      status: GenerationStatus.SUCCEEDED,
      updatedAt: new Date("2026-04-23T08:02:00.000Z"),
      userId: "user_1",
    } as never);

    expect(result.generationType).toBe("text_to_video");
    expect(result.aspectRatio).toBe("16:9");
    expect(result.durationSeconds).toBe(8);
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toEqual({
      durationSeconds: 8,
      height: 720,
      id: "video_1",
      posterUrl: "https://example.com/poster.jpg",
      url: "https://example.com/result.mp4",
      width: 1280,
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/tests/unit/generation-serialization.test.ts`
Expected: FAIL — 新用例报错（`result.videos` 为 `undefined`、`result.aspectRatio` 不存在）。

- [ ] **Step 3: 扩展 `GenerationType` 联合类型**

`src/lib/types.ts:2`，把：

```ts
export type GenerationType = "text_to_image" | "image_to_image";
```

改为：

```ts
export type GenerationType = "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video";
```

- [ ] **Step 4: 改 `toPrismaGenerationType` / `fromPrismaGenerationType` 处理四种类型**

`src/lib/prisma-mappers.ts:148-162`，把两个函数整体替换为：

```ts
export function toPrismaGenerationType(generationType: UiGenerationType) {
  switch (generationType) {
    case "image_to_image":
      return GenerationType.IMAGE_TO_IMAGE;
    case "text_to_video":
      return GenerationType.TEXT_TO_VIDEO;
    case "image_to_video":
      return GenerationType.IMAGE_TO_VIDEO;
    default:
      return GenerationType.TEXT_TO_IMAGE;
  }
}
```

```ts
export function fromPrismaGenerationType(generationType: GenerationType): UiGenerationType {
  switch (generationType) {
    case GenerationType.IMAGE_TO_IMAGE:
      return "image_to_image";
    case GenerationType.TEXT_TO_VIDEO:
      return "text_to_video";
    case GenerationType.IMAGE_TO_VIDEO:
      return "image_to_video";
    default:
      return "text_to_image";
  }
}
```

- [ ] **Step 5: 给 `SerializedGeneration` 加视频字段**

`src/lib/prisma-mappers.ts`，在 `SerializedGeneration` 类型里：把 `generationType` 一行（约 26 行）改宽，并新增 `aspectRatio`/`durationSeconds`/`videos`。在 `generationType` 行替换、并在 `images: [...]` 块之后加视频字段：

```ts
  generationType: "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video";
```

在 `id: string;`（约 27 行）之后、`images:` 之前加：

```ts
  aspectRatio: string | null;
  durationSeconds: number | null;
```

在 `images: Array<{...}>;` 块之后加：

```ts
  videos: Array<{
    durationSeconds: number | null;
    height: number | null;
    id: string;
    posterUrl: string | null;
    url: string;
    width: number | null;
  }>;
```

- [ ] **Step 6: 改 `serializeGeneration` 的入参类型并输出视频**

`src/lib/prisma-mappers.ts`，在文件顶部 `import { ... type GenerationImage, type GenerationJob ... }`（约 1-11 行）中加入 `type GeneratedVideo`：

```ts
  type GeneratedVideo,
  type GenerationImage,
```

把 `serializeGeneration` 签名（约 256-258 行）改为：

```ts
export function serializeGeneration(
  job: GenerationJob & { images: GenerationImage[]; videos?: GeneratedVideo[] },
): SerializedGeneration {
```

在 `serializeGeneration` 的 `return { ... }` 对象里，紧跟 `generationType,`（约 298 行）之后加 `aspectRatio`/`durationSeconds`，并在 `images: job.images.map(...)` 块之后加 `videos`：

```ts
    generationType,
    aspectRatio:
      "aspectRatio" in job && typeof job.aspectRatio === "string" ? job.aspectRatio : null,
    durationSeconds:
      "durationSeconds" in job && typeof job.durationSeconds === "number"
        ? job.durationSeconds
        : null,
```

```ts
    videos:
      "videos" in job && Array.isArray(job.videos)
        ? job.videos.map((video) => ({
            durationSeconds:
              typeof video.durationSeconds === "number" ? video.durationSeconds : null,
            height: typeof video.height === "number" ? video.height : null,
            id: video.id,
            posterUrl: typeof video.posterUrl === "string" ? video.posterUrl : null,
            url: video.url,
            width: typeof video.width === "number" ? video.width : null,
          }))
        : [],
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm exec vitest run src/tests/unit/generation-serialization.test.ts`
Expected: PASS（含原有图片用例与新视频用例）。

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/prisma-mappers.ts src/tests/unit/generation-serialization.test.ts
git commit -m "feat(video): 序列化层支持视频类型与 videos 输出"
```

---

## Task 3: zod 校验与请求解析 — 视频分支

**Files:**
- Modify: `src/lib/validators.ts`
- Modify: `src/lib/generation/parse-generate-request.ts`
- Test: `src/tests/unit/parse-generate-request.test.ts`

- [ ] **Step 1: 写失败测试 — 文生视频(JSON) 与 图生视频(form-data) 解析**

`src/tests/unit/parse-generate-request.test.ts`，在 `describe` 闭合 `});` 之前插入：

```ts
  it("解析 JSON 文生视频请求并保留时长与比例", async () => {
    const request = new Request("https://example.com/api/generate", {
      body: JSON.stringify({
        aspectRatio: "16:9",
        durationSeconds: 8,
        generationType: "text_to_video",
        model: "sora-2",
        prompt: "海浪拍打礁石的慢镜头",
        providerMode: "built_in",
        size: "1280x720",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    const result = await parseGenerateRequest(request);

    expect(result.generationType).toBe("text_to_video");
    expect(result.durationSeconds).toBe(8);
    expect(result.aspectRatio).toBe("16:9");
    expect(result.size).toBe("1280x720");
  });

  it("解析 form-data 图生视频请求并提取首帧参考图", async () => {
    const formData = new FormData();
    formData.append("aspectRatio", "9:16");
    formData.append("durationSeconds", "4");
    formData.append("generationType", "image_to_video");
    formData.append("model", "sora-2");
    formData.append("prompt", "让这张照片里的人物挥手");
    formData.append("providerMode", "built_in");
    formData.append("size", "720x1280");
    formData.append("image", new File(["fake-image"], "frame.png", { type: "image/png" }));

    const result = await parseGenerateRequest(formData);

    expect(result.generationType).toBe("image_to_video");
    expect(result.durationSeconds).toBe(4);
    expect(result.aspectRatio).toBe("9:16");
    expect(result.image?.name).toBe("frame.png");
    expect(result.images).toHaveLength(1);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/tests/unit/parse-generate-request.test.ts`
Expected: FAIL — `generationType: "text_to_video"` 不在枚举内（zod 抛错），且 `result.durationSeconds` 为 `undefined`。

- [ ] **Step 3: 扩展 `generateSchema`**

`src/lib/validators.ts:61-81`，把 `generateSchema` 的 `generationType` 一行改宽，并在 `seed` 之后、`size` 之前加 `durationSeconds`/`aspectRatio`：

把（约 64 行）：

```ts
  generationType: z.enum(["text_to_image", "image_to_image"]).default("text_to_image"),
```

改为：

```ts
  generationType: z
    .enum(["text_to_image", "image_to_image", "text_to_video", "image_to_video"])
    .default("text_to_image"),
```

在 `seed: z.number().int().positive().optional().nullable(),`（约 73 行）之后加：

```ts
  durationSeconds: z.number().int().min(1).max(60).optional().nullable(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().nullable(),
```

> 时长用宽松的 `1..60` 范围而非硬编码 4/8/12 档位——档位受渠道能力限制、联调后由前端控制（spec §14）。`size` 复用现有 `generationSizeSchema`，`"1280x720"` 等合法像素值可直接通过 `normalizeGenerationSize`。

- [ ] **Step 4: form-data 解析路径透传视频参数**

`src/lib/generation/parse-generate-request.ts`，在 `parseFormData` 内 `generateSchema.parse({...})` 的对象里（约 80-92 行），`generationType` 一行下方加两项；并把 `generationType` 默认值从 `"image_to_image"` 保持不变（form-data 仍主要用于带参考图的图生场景）。在 `generateSchema.parse({` 对象内加：

```ts
      generationType: toNullableString(formData.get("generationType")) || "image_to_image",
      durationSeconds: toNullableNumber(formData.get("durationSeconds")),
      aspectRatio: toNullableString(formData.get("aspectRatio")),
```

> JSON 路径无需改动：`generateSchema.parse({ ...json, ... })` 已展开整个 `json`，`durationSeconds`/`aspectRatio` 会被 schema 自动解析；返回对象 `{ ...body }` 已含这两个字段。form-data 路径因显式构造对象，必须手动补上。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run src/tests/unit/parse-generate-request.test.ts`
Expected: PASS（原有用例 + 两个视频用例）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/validators.ts src/lib/generation/parse-generate-request.ts src/tests/unit/parse-generate-request.test.ts
git commit -m "feat(video): 提交校验支持视频类型与时长/比例参数"
```

---

## Task 4: 计费 — 视频积分单价

**Files:**
- Modify: `src/lib/credits.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/providers/built-in-provider.ts`
- Test: `src/tests/unit/credits.test.ts`

- [ ] **Step 1: 写失败测试 — 按生成类型取价**

`src/tests/unit/credits.test.ts`，在顶部 import 加入 `resolveCreditCost`：

```ts
import {
  calculateGenerationCost,
  hasEnoughCredits,
  resolveCreditCost,
  shouldChargeCredits,
} from "@/lib/credits";
```

在 `describe` 闭合前插入：

```ts
  it("视频生成类型取视频单价，图片类型取图片单价", () => {
    expect(
      resolveCreditCost({ generationType: "text_to_video", imageCreditCost: 5, videoCreditCost: 20 }),
    ).toBe(20);
    expect(
      resolveCreditCost({ generationType: "image_to_video", imageCreditCost: 5, videoCreditCost: 20 }),
    ).toBe(20);
    expect(
      resolveCreditCost({ generationType: "text_to_image", imageCreditCost: 5, videoCreditCost: 20 }),
    ).toBe(5);
    expect(
      resolveCreditCost({ generationType: "image_to_image", imageCreditCost: 5, videoCreditCost: 20 }),
    ).toBe(5);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/tests/unit/credits.test.ts`
Expected: FAIL — `resolveCreditCost is not a function`（导入失败）。

- [ ] **Step 3: 实现 `resolveCreditCost`**

`src/lib/credits.ts`，顶部 import 加上 `GenerationType` 类型：

```ts
import type { GenerationType, ProviderMode } from "@/lib/types";
```

在文件末尾追加：

```ts
type ResolveCreditCostInput = {
  generationType: GenerationType;
  imageCreditCost: number;
  videoCreditCost: number;
};

export function isVideoGenerationType(generationType: GenerationType) {
  return generationType === "text_to_video" || generationType === "image_to_video";
}

export function resolveCreditCost({
  generationType,
  imageCreditCost,
  videoCreditCost,
}: ResolveCreditCostInput) {
  return isVideoGenerationType(generationType) ? videoCreditCost : imageCreditCost;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/tests/unit/credits.test.ts`
Expected: PASS。

- [ ] **Step 5: env 加 `BUILTIN_PROVIDER_VIDEO_CREDIT_COST`**

`src/lib/env.ts:12`，在 `BUILTIN_PROVIDER_CREDIT_COST` 一行后加：

```ts
  BUILTIN_PROVIDER_CREDIT_COST: z.coerce.number().int().positive().default(5),
  BUILTIN_PROVIDER_VIDEO_CREDIT_COST: z.coerce.number().int().positive().default(20),
```

- [ ] **Step 6: `ResolvedChannel` 与各渠道函数带上 `videoCreditCost`**

`src/lib/providers/built-in-provider.ts`：

(a) `ResolvedChannel` 类型（约 8-16 行）在 `creditCost: number;` 后加：

```ts
  creditCost: number;
  videoCreditCost: number;
```

(b) `getActiveChannels` 的 env fallback 对象（约 34-43 行）在 `creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,` 后加：

```ts
        creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,
        videoCreditCost: env.BUILTIN_PROVIDER_VIDEO_CREDIT_COST,
```

(c) `getActiveChannels` 的 DB 映射对象（约 47-57 行）在 `creditCost: ch.creditCost,` 后加：

```ts
      creditCost: ch.creditCost,
      videoCreditCost: ch.videoCreditCost,
```

(d) `getChannelById` 的 env fallback 对象（约 72-80 行）在 `creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,` 后加：

```ts
      creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,
      videoCreditCost: env.BUILTIN_PROVIDER_VIDEO_CREDIT_COST,
```

(e) `getChannelById` 的 DB 映射对象（约 86-94 行）在 `creditCost: ch.creditCost,` 后加：

```ts
    creditCost: ch.creditCost,
    videoCreditCost: ch.videoCreditCost,
```

(f) `getBuiltInProviderConfig` 的 env fallback（约 150-158 行）在 `creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,` 后加：

```ts
      creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,
      videoCreditCost: env.BUILTIN_PROVIDER_VIDEO_CREDIT_COST,
```

(g) `getBuiltInProviderConfig` 的 channel 分支（约 161-169 行）在 `creditCost: first.creditCost,` 后加：

```ts
    creditCost: first.creditCost,
    videoCreditCost: first.videoCreditCost,
```

> `getChannelsForAdmin`（不解密、供后台列表）本计划不改——后台「视频积分单价」输入框属前端范围，留计划二/三。

- [ ] **Step 7: 类型自检**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 8: Commit**

```bash
git add src/lib/credits.ts src/lib/env.ts src/lib/providers/built-in-provider.ts src/tests/unit/credits.test.ts
git commit -m "feat(video): 新增视频积分单价与按类型取价"
```

---

## Task 5: 提交 API — 视频计费与字段落库

**Files:**
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/app/api/me/generations/[id]/route.ts`
- Modify: `src/app/api/me/generations/route.ts`

> 本仓库未对这些 route 写单测（`src/tests/unit/` 仅测纯函数 `parseGenerateRequest`），route 是装配层。其逻辑分支已由 Task 3（解析）+ Task 4（`resolveCreditCost` 纯函数）覆盖。本 Task 验证 = `tsc` 通过 + 全量测试不回归；端到端真实生成在 Task 9 完成后联调。
> 轮询端点 `[id]` 与历史列表端点必须 `include videos`，否则 `serializeGeneration` 永远输出 `videos: []`，前端拿不到生成好的视频——这是端到端打通的必要环节。

- [ ] **Step 1: 引入 `resolveCreditCost` 并按类型计价**

`src/app/api/generate/route.ts`：

(a) 顶部 import（约 6 行）：

```ts
import { calculateGenerationCost, hasEnoughCredits, resolveCreditCost } from "@/lib/credits";
```

(b) `channelId` 分支构造的 `builtInProvider` 对象（约 32-40 行）加 `videoCreditCost`：

```ts
      builtInProvider = {
        apiKey: channel.apiKey,
        baseUrl: channel.baseUrl,
        creditCost: channel.creditCost,
        videoCreditCost: channel.videoCreditCost,
        id: channel.id,
        model: channel.defaultModel,
        models: channel.models,
        name: channel.name,
      };
```

(c) 把 `cost` 计算（约 45-48 行）替换为按类型取价：

```ts
    const builtInCreditCost = resolveCreditCost({
      generationType: body.generationType,
      imageCreditCost: builtInProvider.creditCost,
      videoCreditCost: builtInProvider.videoCreditCost,
    });

    const cost = calculateGenerationCost({
      builtInCreditCost,
      providerMode: body.providerMode,
    });
```

(d) `hasEnoughCredits` 调用（约 50-59 行）把 `builtInCreditCost: builtInProvider.creditCost` 改为 `builtInCreditCost`：

```ts
      !hasEnoughCredits({
        builtInCreditCost,
        credits: user.credits,
        providerMode: body.providerMode,
      })
```

- [ ] **Step 2: `job.create` 透传视频字段并 include videos**

`src/app/api/generate/route.ts`，`tx.generationJob.create` 的 `data` 内（约 123-154 行），在 `generationType: toPrismaGenerationType(body.generationType),` 之后加视频字段：

```ts
          generationType: toPrismaGenerationType(body.generationType),
          durationSeconds: body.durationSeconds ?? null,
          aspectRatio: body.aspectRatio ?? null,
```

并把 `include`（约 155-157 行）改为同时取 videos：

```ts
        include: {
          images: true,
          videos: true,
        },
```

> 创建瞬间 `videos` 为空数组，`serializeGeneration` 据此输出 `videos: []`；Worker 完成后写入，前端轮询拿到。

- [ ] **Step 3: 两个读取端点同步 `include videos`**

`src/app/api/me/generations/[id]/route.ts` 的 `db.generationJob.findFirst`（约 20-27 行）把 `include` 改为：

```ts
    include: {
      images: {
        orderBy: { createdAt: "asc" },
      },
      videos: {
        orderBy: { createdAt: "asc" },
      },
    },
```

`src/app/api/me/generations/route.ts` 的 `db.generationJob.findMany`（约 15-24 行）同样把 `include` 改为：

```ts
    include: {
      images: {
        orderBy: { createdAt: "asc" },
      },
      videos: {
        orderBy: { createdAt: "asc" },
      },
    },
```

- [ ] **Step 4: 类型自检**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 全量测试不回归**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/generate/route.ts "src/app/api/me/generations/[id]/route.ts" src/app/api/me/generations/route.ts
git commit -m "feat(video): 提交接口按类型计费、落库视频参数，读取端点含视频"
```

---

## Task 6: Worker — `GenerationJob` 字段与领取查询

**Files:**
- Modify: `worker/internal/worker/worker.go`

> Go 侧改动先确保领取的任务携带视频参数（时长/比例），为 Task 7-8 铺路。验证 = `go build` + `go test` 不回归。

- [ ] **Step 1: `GenerationJob` struct 加字段**

`worker/internal/worker/worker.go:26-48`，在 struct 内 `Size String` 之后加：

```go
	Size                    string
	DurationSeconds         sql.NullInt32
	AspectRatio             sql.NullString
```

- [ ] **Step 2: `claimJob` 的 RETURNING 与 Scan 加两列**

`worker/internal/worker/worker.go`，`claimJob` 内 SQL 的 `RETURNING` 列表末尾（约 220 行，`job."sourceImageUrls"` 之后）加：

```sql
  job."sourceImageUrls",
  job."durationSeconds",
  job."aspectRatio"
```

并在 `row.Scan(...)`（约 224-246 行）末尾 `&job.SourceImageURLs,` 之后加：

```go
		&job.SourceImageURLs,
		&job.DurationSeconds,
		&job.AspectRatio,
```

- [ ] **Step 3: 编译与回归测试**

Run: `cd worker && go build ./... && go test ./...`
Expected: 编译通过；现有测试 PASS。

- [ ] **Step 4: Commit**

```bash
git add worker/internal/worker/worker.go
git commit -m "feat(video): worker 领取任务携带时长与比例字段"
```

---

## Task 7: Worker — 视频客户端适配层与 `generateVideo`

**Files:**
- Create: `worker/internal/worker/video.go`
- Create: `worker/internal/worker/video_test.go`
- Modify: `worker/internal/worker/storage.go`

> 视频接口形态按 OpenAI Video API 默认契约（spec §5）：`POST /videos` 创建、`GET /videos/{id}` 轮询、`GET /videos/{id}/content` 取 mp4。所有端点与字段集中在本文件，联调时只改这里。

- [ ] **Step 1: 写失败测试 — 用 httptest 模拟 create→poll→content**

创建 `worker/internal/worker/video_test.go`：

```go
package worker

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGenerateVideoPollsUntilCompletedAndPersists(t *testing.T) {
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/videos":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "vid_123", "status": "queued"})
		case r.Method == http.MethodGet && r.URL.Path == "/videos/vid_123/content":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("fake-mp4-bytes"))
		case r.Method == http.MethodGet && r.URL.Path == "/videos/vid_123":
			polls++
			status := "in_progress"
			if polls >= 2 {
				status = "completed"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "vid_123", "status": status})
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer server.Close()

	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	job := GenerationJob{
		ID:             "job_v1",
		UserID:         "user_1",
		GenerationType: "TEXT_TO_VIDEO",
		Model:          "sora-2",
		Prompt:         "海浪慢镜头",
		Size:           "1280x720",
	}
	provider := ProviderConfig{APIKey: "test-key", BaseURL: server.URL, Model: "sora-2"}

	result, err := generateVideo(context.Background(), storage, job, provider, time.Millisecond)
	if err != nil {
		t.Fatalf("generateVideo returned error: %v", err)
	}
	if !strings.HasPrefix(result.URL, "data:video/mp4;base64,") {
		t.Fatalf("unexpected video url: %s", result.URL)
	}
	if polls < 2 {
		t.Fatalf("expected at least 2 polls, got %d", polls)
	}
}

func TestGenerateVideoReturnsErrorOnFailedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/videos":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "vid_err", "status": "queued"})
		case r.Method == http.MethodGet && r.URL.Path == "/videos/vid_err":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "vid_err", "status": "failed"})
		default:
			http.Error(w, "unexpected path", http.StatusNotFound)
		}
	}))
	defer server.Close()

	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	job := GenerationJob{ID: "job_e", GenerationType: "TEXT_TO_VIDEO", Model: "sora-2", Prompt: "x", Size: "1280x720"}
	provider := ProviderConfig{APIKey: "k", BaseURL: server.URL, Model: "sora-2"}

	_, err := generateVideo(context.Background(), storage, job, provider, time.Millisecond)
	if err == nil {
		t.Fatal("expected error on failed status, got nil")
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd worker && go test ./internal/worker/ -run TestGenerateVideo`
Expected: FAIL — 编译错误 `undefined: generateVideo`、`undefined: VideoResult`、`undefined: PersistVideo`。

- [ ] **Step 3: storage.go 加 `PersistVideo`**

`worker/internal/worker/storage.go`，在 `PersistImage` 方法（约 64-95 行）之后插入：

```go
func (s *Storage) PersistVideo(ctx context.Context, userID string, data []byte) (string, error) {
	if s.client != nil && s.cfg.S3Bucket != "" {
		fileName := fmt.Sprintf("%s/%s.mp4", userID, randomHex(16))
		_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
			Body:        bytes.NewReader(data),
			Bucket:      aws.String(s.cfg.S3Bucket),
			ContentType: aws.String("video/mp4"),
			Key:         aws.String(fileName),
		})
		if err != nil {
			return "", err
		}

		if s.cfg.S3PublicBaseURL != "" {
			return strings.TrimRight(s.cfg.S3PublicBaseURL, "/") + "/" + fileName, nil
		}
		return strings.TrimRight(s.cfg.S3Endpoint, "/") + "/" + s.cfg.S3Bucket + "/" + fileName, nil
	}

	if s.cfg.EnableLocalImageFallback {
		return fmt.Sprintf("data:video/mp4;base64,%s", base64.StdEncoding.EncodeToString(data)), nil
	}

	return "", errors.New("当前没有可用的视频存储配置")
}
```

> 复用 `PersistImage` 的 S3/fallback 结构。本地 fallback 的 base64 data URL 仅用于无 S3 的开发环境；生产应配置 S3（spec §11）。

- [ ] **Step 4: 创建 video.go**

创建 `worker/internal/worker/video.go`：

```go
package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// VideoResult 是一次视频生成的产物，写入 GeneratedVideo。
type VideoResult struct {
	URL             string
	PosterURL       string
	Width           *int
	Height          *int
	DurationSeconds *int
}

type videoCreateResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type videoStatusResponse struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Progress *int   `json:"progress,omitempty"`
}

// generateVideo 在单次任务内完成「提交→轮询→取结果」。pollInterval 由调用方传入
// （生产取 cfg.VideoPollInterval，测试取极小值）。整体受 ctx 的 JobTimeout 约束。
func generateVideo(ctx context.Context, storage *Storage, job GenerationJob, provider ProviderConfig, pollInterval time.Duration) (VideoResult, error) {
	model := job.Model
	if strings.TrimSpace(model) == "" {
		model = provider.Model
	}

	videoID, err := createVideo(ctx, job, provider, model)
	if err != nil {
		return VideoResult{}, err
	}

	if err := pollVideo(ctx, provider, videoID, pollInterval); err != nil {
		return VideoResult{}, err
	}

	data, err := fetchVideoContent(ctx, provider, videoID)
	if err != nil {
		return VideoResult{}, err
	}

	url, err := storage.PersistVideo(ctx, job.UserID, data)
	if err != nil {
		return VideoResult{}, err
	}

	result := VideoResult{URL: url}
	if job.DurationSeconds.Valid {
		seconds := int(job.DurationSeconds.Int32)
		result.DurationSeconds = &seconds
	}
	if width, height := parseAspectSize(job.Size); width > 0 && height > 0 {
		result.Width = &width
		result.Height = &height
	}
	return result, nil
}

func createVideo(ctx context.Context, job GenerationJob, provider ProviderConfig, model string) (string, error) {
	body := map[string]any{
		"model":  model,
		"prompt": job.Prompt,
	}
	if job.DurationSeconds.Valid {
		body["seconds"] = strconv.Itoa(int(job.DurationSeconds.Int32))
	}
	if job.Size != "" && job.Size != "auto" {
		body["size"] = job.Size
	}
	if job.GenerationType == "IMAGE_TO_VIDEO" {
		sourceImages, err := loadSourceImages(ctx, job.SourceImageURLs)
		if err != nil {
			return "", err
		}
		if len(sourceImages) == 0 {
			return "", errors.New("图生视频缺少首帧/参考图")
		}
		body["input_reference"] = imageDataURL(sourceImages[0])
	}

	responseBody, err := postJSON(ctx, endpoint(provider.BaseURL, "/videos"), provider.APIKey, body, nil)
	if err != nil {
		return "", err
	}
	var created videoCreateResponse
	if err := json.Unmarshal(responseBody, &created); err != nil {
		return "", err
	}
	if created.ID == "" {
		return "", errors.New("视频渠道未返回任务 id")
	}
	return created.ID, nil
}

func pollVideo(ctx context.Context, provider ProviderConfig, videoID string, pollInterval time.Duration) error {
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		status, err := fetchVideoStatus(ctx, provider, videoID)
		if err != nil {
			return err
		}
		switch strings.ToLower(status) {
		case "completed", "succeeded":
			return nil
		case "failed", "error", "cancelled", "canceled":
			return fmt.Errorf("视频生成失败：渠道返回状态 %s", status)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func fetchVideoStatus(ctx context.Context, provider ProviderConfig, videoID string) (string, error) {
	body, err := getWithAuth(ctx, endpoint(provider.BaseURL, "/videos/"+videoID), provider.APIKey)
	if err != nil {
		return "", err
	}
	var parsed videoStatusResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if parsed.Status == "" {
		return "", errors.New("视频渠道未返回状态")
	}
	return parsed.Status, nil
}

func fetchVideoContent(ctx context.Context, provider ProviderConfig, videoID string) ([]byte, error) {
	return getWithAuth(ctx, endpoint(provider.BaseURL, "/videos/"+videoID+"/content"), provider.APIKey)
}

func getWithAuth(ctx context.Context, rawURL string, apiKey string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	return doRequest(request)
}

// parseAspectSize 解析 "1280x720" 形式，复用 storage 侧的维度约定。
func parseAspectSize(size string) (int, int) {
	dimensions := parseSizeString(size)
	if dimensions == nil {
		return 0, 0
	}
	return dimensions.Width, dimensions.Height
}

var _ = bytes.MinRead
var _ = io.EOF
```

> `postJSON`/`doRequest`/`endpoint`/`imageDataURL`/`loadSourceImages`/`parseSizeString` 均复用 `generation.go`/`storage.go` 已有函数。结尾两个 `var _ =` 占位用于在初版未直接引用 `bytes`/`io` 时通过编译——若实现期补充流式下载则删除。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd worker && go test ./internal/worker/ -run TestGenerateVideo`
Expected: PASS（两个用例）。

- [ ] **Step 6: 全量 Worker 测试不回归**

Run: `cd worker && go build ./... && go test ./...`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add worker/internal/worker/video.go worker/internal/worker/video_test.go worker/internal/worker/storage.go
git commit -m "feat(video): worker 视频客户端适配层与 generateVideo"
```

---

## Task 8: Worker — `processJob` 分叉与 `completeVideoJob`

**Files:**
- Modify: `worker/internal/worker/worker.go`

- [ ] **Step 1: `processJob` 按类型分叉**

`worker/internal/worker/worker.go`，把 `processJob` 内 `resolveProvider` 之后的生成与写入段（约 285-298 行，`images, err := generateImages(...)` 到 `logger.Info("生成任务完成", ...)`）替换为：

```go
	if job.GenerationType == "TEXT_TO_VIDEO" || job.GenerationType == "IMAGE_TO_VIDEO" {
		video, err := generateVideo(ctx, w.storage, job, provider, w.cfg.VideoPollInterval)
		if err != nil {
			logger.Error("视频生成失败", "error", err)
			_ = w.failJobAndRefund(parent, job.ID, err.Error())
			return
		}
		if err := w.completeVideoJob(parent, job, video); err != nil {
			logger.Error("写入视频结果失败", "error", err)
			_ = w.failJobAndRefund(parent, job.ID, err.Error())
			return
		}
		logger.Info("视频生成任务完成", "url", video.URL)
		return
	}

	images, err := generateImages(ctx, w.storage, job, provider)
	if err != nil {
		logger.Error("生成失败", "error", err)
		_ = w.failJobAndRefund(parent, job.ID, err.Error())
		return
	}

	if err := w.completeJob(parent, job, images); err != nil {
		logger.Error("写入生成结果失败", "error", err)
		_ = w.failJobAndRefund(parent, job.ID, err.Error())
		return
	}

	logger.Info("生成任务完成", "images", len(images))
```

- [ ] **Step 2: 新增 `completeVideoJob`**

`worker/internal/worker/worker.go`，在 `completeJob` 方法（约 440-515 行）之后插入。结构镜像 `completeJob`：事务内先把 Job 置 `SUCCEEDED`，再写 `GeneratedVideo`，并复用自填渠道记忆逻辑：

```go
func (w *Worker) completeVideoJob(ctx context.Context, job GenerationJob, video VideoResult) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UTC()
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'SUCCEEDED',
  "completedAt" = $1,
  "lockedAt" = NULL,
  "workerId" = NULL,
  "updatedAt" = $1
WHERE id = $2
  AND status = 'PROCESSING'
  AND "workerId" = $3
`, now, job.ID, w.cfg.WorkerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("任务状态已变化，跳过写入")
	}

	_, err = tx.Exec(ctx, `
INSERT INTO "GeneratedVideo" (
  id,
  "jobId",
  url,
  "posterUrl",
  width,
  height,
  "durationSeconds",
  "showcaseStatus",
  "showPromptPublic",
  "createdAt"
) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PRIVATE', false, $8)
`, cuidLikeID(), job.ID, video.URL, nullableVideoString(video.PosterURL), nullableInt(video.Width), nullableInt(video.Height), nullableInt(video.DurationSeconds), now)
	if err != nil {
		return err
	}

	if job.ProviderMode == "CUSTOM" && job.ProviderRemember {
		if !job.ProviderBaseURL.Valid || !job.ProviderAPIKeyEncrypted.Valid {
			return errors.New("自填渠道配置不完整")
		}
		_, err := tx.Exec(ctx, `
INSERT INTO "SavedProviderConfig" (
  id,
  "userId",
  label,
  "baseUrl",
  "apiKeyEncrypted",
  model,
  models,
  "createdAt",
  "updatedAt"
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
ON CONFLICT ("userId") DO UPDATE SET
  label = EXCLUDED.label,
  "baseUrl" = EXCLUDED."baseUrl",
  "apiKeyEncrypted" = EXCLUDED."apiKeyEncrypted",
  model = EXCLUDED.model,
  models = EXCLUDED.models,
  "updatedAt" = EXCLUDED."updatedAt"
`, cuidLikeID(), job.UserID, nullableString(job.ProviderLabel), job.ProviderBaseURL.String, job.ProviderAPIKeyEncrypted.String, job.Model, job.ProviderModels, now)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func nullableVideoString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
```

> `posterUrl` 当前为空（首帧抓取属可选项，spec §14 §5）；`nullableVideoString` 把空串写成 NULL，前端用 `<video>` 自带首帧兜底。`strings` 包已在 worker.go 导入。

- [ ] **Step 3: 编译与全量测试**

Run: `cd worker && go build ./... && go test ./...`
Expected: 编译通过；全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add worker/internal/worker/worker.go
git commit -m "feat(video): worker 按类型分叉并写入 GeneratedVideo"
```

---

## Task 9: Worker — 视频配置项

**Files:**
- Modify: `worker/internal/worker/config.go`
- Test: `worker/internal/worker/config_test.go`

- [ ] **Step 1: 写失败测试 — 读取视频轮询间隔与视频积分单价**

`worker/internal/worker/config_test.go`，在 `TestLoadConfigReadsWorkerHTTPAndMetricsSettings` 之后插入：

```go
func TestLoadConfigReadsVideoSettings(t *testing.T) {
	t.Setenv("AUTH_SECRET", "unit-test-secret")
	t.Setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app?schema=public")
	t.Setenv("WORKER_VIDEO_POLL_INTERVAL_MS", "3000")
	t.Setenv("BUILTIN_PROVIDER_VIDEO_CREDIT_COST", "30")
	t.Setenv("BUILTIN_PROVIDER_VIDEO_MODEL", "sora-2")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}
	if cfg.VideoPollInterval != 3*time.Second {
		t.Fatalf("unexpected video poll interval: %s", cfg.VideoPollInterval)
	}
	if cfg.BuiltInProviderVideoCreditCost != 30 {
		t.Fatalf("unexpected video credit cost: %d", cfg.BuiltInProviderVideoCreditCost)
	}
	if cfg.BuiltInProviderVideoModel != "sora-2" {
		t.Fatalf("unexpected video model: %s", cfg.BuiltInProviderVideoModel)
	}
}

func TestLoadConfigVideoSettingsDefaults(t *testing.T) {
	t.Setenv("AUTH_SECRET", "unit-test-secret")
	t.Setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app?schema=public")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}
	if cfg.VideoPollInterval != 5*time.Second {
		t.Fatalf("unexpected default video poll interval: %s", cfg.VideoPollInterval)
	}
	if cfg.BuiltInProviderVideoCreditCost != 20 {
		t.Fatalf("unexpected default video credit cost: %d", cfg.BuiltInProviderVideoCreditCost)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd worker && go test ./internal/worker/ -run TestLoadConfigVideo`
Expected: FAIL — 编译错误 `cfg.VideoPollInterval undefined` 等。

- [ ] **Step 3: Config struct 加字段**

`worker/internal/worker/config.go:12-35`，在 struct 内 `PollInterval time.Duration` 之后加：

```go
	PollInterval              time.Duration
	VideoPollInterval         time.Duration
	BuiltInProviderVideoCreditCost int
	BuiltInProviderVideoModel string
```

- [ ] **Step 4: `LoadConfig` 读取这三项**

`worker/internal/worker/config.go`，在 `LoadConfig` 返回的 `Config{...}` 内 `PollInterval: ...` 之后加：

```go
		PollInterval:              time.Duration(getenvInt("WORKER_POLL_INTERVAL_MS", 1000)) * time.Millisecond,
		VideoPollInterval:         time.Duration(getenvInt("WORKER_VIDEO_POLL_INTERVAL_MS", 5000)) * time.Millisecond,
		BuiltInProviderVideoCreditCost: getenvInt("BUILTIN_PROVIDER_VIDEO_CREDIT_COST", 20),
		BuiltInProviderVideoModel: getenv("BUILTIN_PROVIDER_VIDEO_MODEL", "sora-2"),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd worker && go test ./internal/worker/ -run TestLoadConfigVideo`
Expected: PASS（两个用例）。

- [ ] **Step 6: 全量 Worker 测试 + 编译**

Run: `cd worker && go build ./... && go test ./...`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add worker/internal/worker/config.go worker/internal/worker/config_test.go
git commit -m "feat(video): worker 视频轮询间隔与默认模型/计费配置"
```

---

## 联调验收（实现全部 Task 后）

> 需要 spec §14 的前置：一个可用的 OpenAI 兼容视频渠道（baseUrl/key/模型名）。

- [ ] 在后台或 env 配置一个支持视频模型的渠道（设置 `videoCreditCost`）。
- [ ] 用 curl 提交一条文生视频任务（JSON）：

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: <已登录会话 cookie>" \
  -d '{"generationType":"text_to_video","model":"sora-2","prompt":"海浪拍打礁石的慢镜头","providerMode":"built_in","size":"1280x720","durationSeconds":8,"aspectRatio":"16:9"}'
```

- [ ] 轮询返回的 job：`GET /api/me/generations/{id}`，确认 `status` 从 `pending` → `succeeded`，且 `videos[0].url` 指向 mp4。
- [ ] 失败路径：用错误模型名提交，确认任务转 `failed` 且积分已退还。
- [ ] 若实际渠道端点/字段与 OpenAI 形态不符 → 只改 `worker/internal/worker/video.go` 的 `createVideo`/`fetchVideoStatus`/`fetchVideoContent`。

---

## Self-Review（已执行）

- **Spec 覆盖（阶段 1-3）：** 数据模型(§4)→Task 1；序列化(§9 末)→Task 2；提交校验(§6)→Task 3；计费(§8)→Task 4 + Task 5；Worker 视频处理(§7)→Task 6-9。`WorkLike` 改造(§4.4)与作品广场(§10)明确划归计划三；前端(§9)划归计划二。
- **占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码。`video.go` 结尾的 `var _ =` 为编译占位并已注明删除条件，非逻辑占位。
- **类型一致性：** `VideoResult` 字段（URL/PosterURL/Width/Height/DurationSeconds）在 video.go 定义、video_test.go 与 completeVideoJob 一致引用；`videoCreditCost` 在 schema/env/ResolvedChannel/route 命名统一；`generateVideo(ctx, storage, job, provider, pollInterval)` 五参签名在定义、测试、processJob 调用处一致；`GeneratedVideo` 列名（驼峰带引号）与 schema 一致。
- **已知假设（联调前确认）：** 视频接口形态(spec §14.1)、`JobTimeout` 是否够长(§14.3)；本地 fallback 的 base64 视频仅限无 S3 开发环境。
