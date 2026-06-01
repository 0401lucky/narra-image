# 视频工作区 · 作品广场接入 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让生成的视频能进入作品广场——用户投稿、管理员审核精选、其他用户浏览/点赞、详情页播放，全程复用现有图片作品的状态机与设计。

**Architecture:** 复用与媒体无关的状态机纯函数（`applyUserShowcaseAction`/`applyAdminWorkReview`）和审核流转；数据层在 `server/works.ts` 平行新增「视频版」查询函数；投稿/审核/点赞/列表端点通过 `mediaType` 参数分流到 `GeneratedVideo`。前端按 spec §10「视频独立分区、不与图片混排同一瀑布流」，在作品页新增视频分区、详情页支持播放。

**Tech Stack:** Prisma 7（`db push`）+ zod 4 + vitest 4 + Next 16 App Router；前端复用现有 works 组件设计语言。

**依赖：** 计划一（`GeneratedVideo` 表及其 showcase 字段、`reviewedBy` 关系）必须先完成。与计划二（前端工作区）无强依赖，可独立推进；但 §Task 9 的「从视频详情/工作区投稿」入口在计划二完成后体验更完整。

**前端 Task 粒度声明：** 同计划二——本仓库无业务组件测试，前端验证 = `pnpm exec tsc --noEmit` + `pnpm lint` + 手动验收。前端 Task（9）给出新增的视频分区/详情播放组件的可运行实现 + 集成点；执行前应先阅读现有 `src/components/works/my-works-board.tsx` 与 `work-detail-panel.tsx` 以对齐视觉，精确视觉细节允许微调。

**本计划不做：** 管理后台作品审核页的视频筛选 UI 精细化（沿用现有列表，视频与图片混合按状态展示即可）；视频与图片在同一瀑布流的混排。

---

## 文件结构

**修改：**
- `prisma/schema.prisma` — `WorkLike` 改造（`workId` 可空 + `videoId`）、`GeneratedVideo.likes` 反向关系
- `src/lib/prisma-mappers.ts` — 新增视频作品序列化（`SerializedFeaturedVideo` 等 + 函数）
- `src/lib/server/works.ts` — 新增视频版查询函数
- `src/lib/validators.ts` — `workShowcaseUpdateSchema`/`adminWorkReviewSchema` 加 `mediaType`
- `src/app/api/me/works/[id]/showcase/route.ts` — `mediaType` 分流
- `src/app/api/admin/works/[id]/review/route.ts` — `mediaType` 分流
- `src/app/api/works/[id]/like/route.ts` — `mediaType` 分流
- `src/app/api/works/featured/route.ts` — `mediaType` 分流
- `src/app/works/page.tsx` — 加视频分区入口
- `src/app/works/[id]/page.tsx`（或新增视频详情）— 详情播放

**创建：**
- `src/components/works/video-works-section.tsx` — 视频作品分区（用户视角）
- `src/components/works/featured-video-card.tsx` — 精选视频卡片
- `src/tests/unit/featured-video-serialization.test.ts`

---

## Task 1: Schema — `WorkLike` 改造与视频点赞关系

**Files:**
- Modify: `prisma/schema.prisma`

> `workId` 由 NOT NULL 改为可空：现有图片点赞记录的 `workId` 均非空，改可空不丢数据；新增 `videoId` 可空。`db push` 安全。

- [ ] **Step 1: 改 `WorkLike` 模型**

`prisma/schema.prisma:197-208`，把整个 `WorkLike` 模型替换为：

```prisma
model WorkLike {
  id        String           @id @default(cuid())
  workId    String?
  videoId   String?
  userId    String
  createdAt DateTime         @default(now())
  work      GenerationImage? @relation(fields: [workId], references: [id], onDelete: Cascade)
  video     GeneratedVideo?  @relation(fields: [videoId], references: [id], onDelete: Cascade)
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workId, userId])
  @@unique([videoId, userId])
  @@index([userId])
  @@index([workId])
  @@index([videoId])
}
```

- [ ] **Step 2: `GeneratedVideo` 加 `likes` 反向关系**

`prisma/schema.prisma` 的 `GeneratedVideo` 模型（计划一创建）内，在 `reviewedBy` 关系行之后加：

```prisma
  reviewedBy       User?          @relation("ReviewedVideos", fields: [reviewedById], references: [id], onDelete: SetNull)
  likes            WorkLike[]
```

- [ ] **Step 3: 同步 schema 并重新生成**

Run: `pnpm db:push && pnpm db:generate`
Expected: `db push` 输出 in sync；`generate` 成功。

- [ ] **Step 4: 类型自检（现有 like 端点用 `workId_userId` 复合键，仍有效）**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(video): WorkLike 支持视频点赞，GeneratedVideo 关联点赞"
```

---

## Task 2: 视频作品序列化

**Files:**
- Modify: `src/lib/prisma-mappers.ts`
- Test: `src/tests/unit/featured-video-serialization.test.ts`

- [ ] **Step 1: 写失败测试**

`src/tests/unit/featured-video-serialization.test.ts`：

```ts
import { serializeFeaturedVideo } from "@/lib/prisma-mappers";

describe("精选视频序列化", () => {
  it("输出封面、视频地址、点赞数与作者信息", () => {
    const result = serializeFeaturedVideo({
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      durationSeconds: 8,
      featuredAt: new Date("2026-05-02T00:00:00.000Z"),
      height: 720,
      id: "video_1",
      jobId: "job_1",
      posterUrl: "https://example.com/poster.jpg",
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      showPromptPublic: true,
      showcaseStatus: "FEATURED",
      submittedAt: null,
      url: "https://example.com/result.mp4",
      width: 1280,
      job: {
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "job_1",
        model: "sora-2",
        negativePrompt: null,
        prompt: "海浪慢镜头",
        size: "1280x720",
        status: "SUCCEEDED",
        userId: "user_1",
        user: { avatarUrl: null, id: "user_1", nickname: "阿浪" },
      },
      _count: { likes: 3 },
      likes: [{ userId: "viewer_1" }],
    } as never);

    expect(result.id).toBe("video_1");
    expect(result.videoUrl).toBe("https://example.com/result.mp4");
    expect(result.posterUrl).toBe("https://example.com/poster.jpg");
    expect(result.durationSeconds).toBe(8);
    expect(result.likeCount).toBe(3);
    expect(result.likedByMe).toBe(true);
    expect(result.authorName).toBe("阿浪");
    expect(result.prompt).toBe("海浪慢镜头");
  });

  it("作者未公开提示词时回退占位文案", () => {
    const result = serializeFeaturedVideo({
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      durationSeconds: null,
      featuredAt: new Date("2026-05-02T00:00:00.000Z"),
      height: null,
      id: "video_2",
      jobId: "job_2",
      posterUrl: null,
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      showPromptPublic: false,
      showcaseStatus: "FEATURED",
      submittedAt: null,
      url: "https://example.com/2.mp4",
      width: null,
      job: {
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "job_2",
        model: "sora-2",
        negativePrompt: null,
        prompt: "私密提示词",
        size: "1280x720",
        status: "SUCCEEDED",
        userId: "user_1",
        user: { avatarUrl: null, id: "user_1", nickname: null },
      },
      _count: { likes: 0 },
    } as never);

    expect(result.prompt).toBe("作者未公开提示词");
    expect(result.authorName).toBe("匿名创作者");
    expect(result.likedByMe).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/tests/unit/featured-video-serialization.test.ts`
Expected: FAIL — `serializeFeaturedVideo is not a function`。

- [ ] **Step 3: 实现视频序列化**

`src/lib/prisma-mappers.ts`，顶部 import 加入 `type GeneratedVideo`（若 Task 计划一已加则复用）。在 `serializeFeaturedWork` 之后追加类型与函数：

```ts
export type SerializedFeaturedVideo = {
  authorAvatar: string | null;
  authorName: string;
  durationSeconds: number | null;
  featuredAt: string | null;
  id: string;
  likeCount: number;
  likedByMe: boolean;
  posterUrl: string | null;
  prompt: string;
  size: string;
  title: string;
  videoUrl: string;
};

export type FeaturedVideoRecord = GeneratedVideo & {
  job: WorkJobFields & {
    user: WorkAuthorFields;
  };
  _count?: {
    likes: number;
  };
  likes?: Array<{
    userId: string;
  }>;
};

export function serializeFeaturedVideo(video: FeaturedVideoRecord): SerializedFeaturedVideo {
  const author = video.job.user;
  return {
    authorAvatar: author.avatarUrl,
    authorName: author.nickname || "匿名创作者",
    durationSeconds: typeof video.durationSeconds === "number" ? video.durationSeconds : null,
    featuredAt: video.featuredAt?.toISOString() ?? null,
    id: video.id,
    likeCount: video._count?.likes ?? 0,
    likedByMe: Boolean(video.likes?.length),
    posterUrl: typeof video.posterUrl === "string" ? video.posterUrl : null,
    prompt: video.showPromptPublic ? video.job.prompt : "作者未公开提示词",
    size: video.job.size,
    title: video.job.model,
    videoUrl: video.url,
  };
}
```

> `WorkJobFields` 与 `WorkAuthorFields` 是 prisma-mappers 已有的类型别名，直接复用。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/tests/unit/featured-video-serialization.test.ts`
Expected: PASS（两个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/prisma-mappers.ts src/tests/unit/featured-video-serialization.test.ts
git commit -m "feat(video): 精选视频序列化"
```

---

## Task 3: `server/works.ts` 视频查询函数

**Files:**
- Modify: `src/lib/server/works.ts`

- [ ] **Step 1: 加视频版 include 与查询函数**

`src/lib/server/works.ts`，顶部 import 加入 `serializeFeaturedVideo` 与类型：

```ts
import {
  serializeAdminWork,
  serializeFeaturedVideo,
  serializeFeaturedWork,
  serializeWork,
  type FeaturedVideoRecord,
  type FeaturedWorkRecord,
  type SerializedWork,
} from "@/lib/prisma-mappers";
```

在文件末尾追加视频版查询（镜像图片版的 cursor 分页与 mutation target）：

```ts
const videoFeaturedInclude = {
  job: {
    select: {
      createdAt: true,
      id: true,
      model: true,
      negativePrompt: true,
      prompt: true,
      size: true,
      status: true,
      user: {
        select: {
          avatarUrl: true,
          id: true,
          nickname: true,
        },
      },
      userId: true,
    },
  },
  _count: {
    select: {
      likes: true,
    },
  },
};

export type FeaturedVideosPage = {
  hasMore: boolean;
  items: ReturnType<typeof serializeFeaturedVideo>[];
  nextCursor: string | null;
};

export async function listFeaturedVideosPage(
  options: { cursor?: string | null; limit?: number; viewerId?: string | null } = {},
): Promise<FeaturedVideosPage> {
  const limit = Math.min(Math.max(options.limit ?? FEATURED_WORKS_PAGE_SIZE, 1), FEATURED_WORKS_PAGE_SIZE);
  const cursor = decodeFeaturedWorksCursor(options.cursor);
  const cursorFeaturedAt = cursor ? new Date(cursor.featuredAt) : null;
  const hasValidCursor = cursor && cursorFeaturedAt && !Number.isNaN(cursorFeaturedAt.getTime());

  const videos = await db.generatedVideo.findMany({
    where: {
      showcaseStatus: ShowcaseStatus.FEATURED,
      featuredAt: { not: null },
      ...(hasValidCursor
        ? {
            OR: [
              { featuredAt: { lt: cursorFeaturedAt } },
              { featuredAt: cursorFeaturedAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: {
      ...videoFeaturedInclude,
      ...(options.viewerId
        ? { likes: { where: { userId: options.viewerId }, select: { userId: true }, take: 1 } }
        : {}),
    },
    orderBy: [{ featuredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = videos.length > limit;
  const pageItems = hasMore ? videos.slice(0, limit) : videos;
  const last = pageItems[pageItems.length - 1];
  const nextCursor =
    hasMore && last && last.featuredAt
      ? encodeFeaturedWorksCursor({ featuredAt: last.featuredAt.toISOString(), id: last.id })
      : null;

  return {
    hasMore,
    items: pageItems.map((v) => serializeFeaturedVideo(v as unknown as FeaturedVideoRecord)),
    nextCursor,
  };
}

export async function getVideoMutationTarget(id: string) {
  return db.generatedVideo.findUnique({
    where: { id },
    select: {
      featuredAt: true,
      job: { select: { userId: true } },
      showcaseStatus: true,
    },
  });
}
```

> 复用图片版的 `decodeFeaturedWorksCursor`/`encodeFeaturedWorksCursor`/`FEATURED_WORKS_PAGE_SIZE`（同文件已定义）。`getVideoMutationTarget` 与 `getWorkMutationTarget` 形状一致，供投稿/审核端点共用纯函数。

- [ ] **Step 2: 类型自检**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/works.ts
git commit -m "feat(video): server/works 视频精选分页与 mutation target"
```

---

## Task 4: 校验 schema 加 `mediaType`

**Files:**
- Modify: `src/lib/validators.ts`
- Test: `src/tests/unit/work-showcase.test.ts`（追加 mediaType 默认值断言）

- [ ] **Step 1: 写失败测试**

`src/tests/unit/work-showcase.test.ts`（若已存在则在其中追加；该文件当前测纯函数，新增 schema 断言需 import schema）。在文件末尾追加一个 describe：

```ts
import { adminWorkReviewSchema, workShowcaseUpdateSchema } from "@/lib/validators";

describe("作品操作 schema 的 mediaType", () => {
  it("投稿 schema 默认 mediaType=image，可显式传 video", () => {
    expect(workShowcaseUpdateSchema.parse({ action: "submit" }).mediaType).toBe("image");
    expect(workShowcaseUpdateSchema.parse({ action: "submit", mediaType: "video" }).mediaType).toBe("video");
  });

  it("审核 schema 默认 mediaType=image，可显式传 video", () => {
    expect(adminWorkReviewSchema.parse({ action: "approve_feature" }).mediaType).toBe("image");
    expect(adminWorkReviewSchema.parse({ action: "approve_feature", mediaType: "video" }).mediaType).toBe("video");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/tests/unit/work-showcase.test.ts`
Expected: FAIL — `mediaType` 为 `undefined`。

- [ ] **Step 3: schema 加 `mediaType`**

`src/lib/validators.ts`，`workShowcaseUpdateSchema`（约 148-151 行）与 `adminWorkReviewSchema`（约 153-156 行）各加一行 `mediaType`：

```ts
export const workShowcaseUpdateSchema = z.object({
  action: z.enum(userWorkShowcaseActions),
  mediaType: z.enum(["image", "video"]).default("image"),
  showPromptPublic: z.boolean().optional(),
});

export const adminWorkReviewSchema = z.object({
  action: z.enum(adminWorkReviewActions),
  mediaType: z.enum(["image", "video"]).default("image"),
  reviewNote: z.string().trim().max(300, "审核备注最多 300 个字符").optional().nullable(),
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/tests/unit/work-showcase.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/validators.ts src/tests/unit/work-showcase.test.ts
git commit -m "feat(video): 投稿/审核 schema 支持 mediaType"
```

---

## Task 5: 投稿端点 `mediaType` 分流

**Files:**
- Modify: `src/app/api/me/works/[id]/showcase/route.ts`

- [ ] **Step 1: 视频分支写 `generatedVideo`**

`src/app/api/me/works/[id]/showcase/route.ts`，import 加入视频版 target 与查询：

```ts
import { getVideoMutationTarget } from "@/lib/server/works";
import { getWorkById, getWorkMutationTarget } from "@/lib/server/works";
```

把 `PATCH` 内从 `const work = await getWorkMutationTarget(id);` 到 `db.generationImage.update` 段（约 28-56 行）改为按 `body.mediaType` 分流：

```ts
    const isVideo = body.mediaType === "video";
    const work = isVideo ? await getVideoMutationTarget(id) : await getWorkMutationTarget(id);
    if (!work || work.job.userId !== user.id) {
      return jsonError("作品不存在", 404);
    }

    let data;
    if (body.action === "submit" && (await isAutoApproveShowcase())) {
      data = {
        featuredAt: new Date(),
        reviewNote: null,
        reviewedAt: new Date(),
        reviewedById: null,
        showcaseStatus: "FEATURED" as const,
        showPromptPublic: Boolean(body.showPromptPublic),
        submittedAt: new Date(),
      };
    } else {
      data = applyUserShowcaseAction({
        action: body.action,
        currentStatus: work.showcaseStatus,
        showPromptPublic: body.showPromptPublic,
      });
    }

    if (isVideo) {
      await db.generatedVideo.update({ where: { id }, data });
    } else {
      await db.generationImage.update({ where: { id }, data });
    }

    revalidateTag("featured-works", "max");

    const updatedWork = isVideo ? null : await getWorkById(id);

    return jsonOk({
      work: updatedWork,
      mediaType: body.mediaType,
    });
```

> 视频投稿后前端依据 `mediaType` 自行刷新（视频详情/工作区轮询其状态），故 `updatedWork` 对视频返回 `null`；图片维持原行为。

- [ ] **Step 2: 类型自检**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/me/works/[id]/showcase/route.ts"
git commit -m "feat(video): 投稿端点支持视频"
```

---

## Task 6: 审核端点 `mediaType` 分流

**Files:**
- Modify: `src/app/api/admin/works/[id]/review/route.ts`

- [ ] **Step 1: 视频分支写 `generatedVideo`**

`src/app/api/admin/works/[id]/review/route.ts`，import 加入 `getVideoMutationTarget`。把 `PATCH` 内从 `const work = await getWorkMutationTarget(id);` 到 `db.generationImage.update` 段（约 27-43 行）改为：

```ts
    const isVideo = body.mediaType === "video";
    const work = isVideo ? await getVideoMutationTarget(id) : await getWorkMutationTarget(id);
    if (!work) {
      return jsonError("作品不存在", 404);
    }

    const data = applyAdminWorkReview({
      action: body.action,
      currentFeaturedAt: work.featuredAt,
      currentStatus: work.showcaseStatus,
      reviewNote: body.reviewNote,
      reviewerId: admin.id,
    });

    if (isVideo) {
      await db.generatedVideo.update({ where: { id }, data });
    } else {
      await db.generationImage.update({ where: { id }, data });
    }

    revalidateTag("featured-works", "max");

    const updatedWork = isVideo ? null : await getAdminWorkById(id);

    return jsonOk({
      work: updatedWork,
      mediaType: body.mediaType,
    });
```

- [ ] **Step 2: 类型自检**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/works/[id]/review/route.ts"
git commit -m "feat(video): 审核端点支持视频"
```

---

## Task 7: 点赞端点 `mediaType` 分流

**Files:**
- Modify: `src/app/api/works/[id]/like/route.ts`

- [ ] **Step 1: 视频分支用 `videoId` 写 `WorkLike`**

`src/app/api/works/[id]/like/route.ts`，`PUT` 从 query 取 `mediaType`，视频走 `generatedVideo` + `videoId_userId` 复合键。把整个 `try` 体（约 11-75 行）替换为：

```ts
    const user = await getCurrentUserRecord();
    if (!user) {
      return jsonError("请先登录", 401);
    }

    const { id } = await context.params;
    const { searchParams } = new URL(_request.url);
    const isVideo = searchParams.get("mediaType") === "video";

    if (isVideo) {
      const video = await db.generatedVideo.findUnique({
        where: { id },
        select: { id: true, showcaseStatus: true },
      });
      if (!video || video.showcaseStatus !== ShowcaseStatus.FEATURED) {
        return jsonError("作品未公开，暂不能点赞", 404);
      }

      const result = await db.$transaction(async (tx) => {
        const existing = await tx.workLike.findUnique({
          where: { videoId_userId: { userId: user.id, videoId: id } },
        });
        const liked = !existing;
        if (existing) {
          await tx.workLike.delete({
            where: { videoId_userId: { userId: user.id, videoId: id } },
          });
        } else {
          await tx.workLike.create({ data: { userId: user.id, videoId: id } });
        }
        const likeCount = await tx.workLike.count({ where: { videoId: id } });
        return { likeCount, liked };
      });

      return jsonOk(result);
    }

    const work = await db.generationImage.findUnique({
      where: { id },
      select: { id: true, showcaseStatus: true },
    });
    if (!work || work.showcaseStatus !== ShowcaseStatus.FEATURED) {
      return jsonError("作品未公开，暂不能点赞", 404);
    }

    const result = await db.$transaction(async (tx) => {
      const existing = await tx.workLike.findUnique({
        where: { workId_userId: { userId: user.id, workId: id } },
      });
      const liked = !existing;
      if (existing) {
        await tx.workLike.delete({
          where: { workId_userId: { userId: user.id, workId: id } },
        });
      } else {
        await tx.workLike.create({ data: { userId: user.id, workId: id } });
      }
      const likeCount = await tx.workLike.count({ where: { workId: id } });
      return { likeCount, liked };
    });

    return jsonOk(result);
```

> `videoId_userId` 复合唯一键由 Task 1 的 `@@unique([videoId, userId])` 生成，Prisma client 据此命名。`_request` 参数现需读取 URL，函数签名中把它正常使用即可（无需改名）。

- [ ] **Step 2: 类型自检**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/works/[id]/like/route.ts"
git commit -m "feat(video): 点赞端点支持视频"
```

---

## Task 8: 精选列表端点 `mediaType` 分流

**Files:**
- Modify: `src/app/api/works/featured/route.ts`

- [ ] **Step 1: `mediaType=video` 返回精选视频**

`src/app/api/works/featured/route.ts`，import 加入 `listFeaturedVideosPage`：

```ts
import { listFeaturedVideosPage, listFeaturedWorksPage } from "@/lib/server/works";
import { getCurrentUserRecord } from "@/lib/server/current-user";
```

新增匿名视频缓存并在 `GET` 内按 `mediaType` 分流：

```ts
const getAnonymousFeaturedVideoPage = unstable_cache(
  async (cursor: string | null, limit: number) =>
    listFeaturedVideosPage({ cursor, limit }),
  ["featured-api-anonymous-video"],
  { revalidate: 60, tags: ["featured-works"] },
);
```

把 `GET` 的数据获取段（约 27-29 行）改为：

```ts
  const isVideo = searchParams.get("mediaType") === "video";

  const data = isVideo
    ? user
      ? await listFeaturedVideosPage({ cursor, limit, viewerId: user.id })
      : await getAnonymousFeaturedVideoPage(cursor, limit)
    : user
      ? await listFeaturedWorksPage({ cursor, limit, viewerId: user.id })
      : await getAnonymousFeaturedPage(cursor, limit);
```

- [ ] **Step 2: 类型自检 + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 通过且无回归。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/works/featured/route.ts
git commit -m "feat(video): 精选列表端点支持 mediaType=video"
```

---

## Task 9: 前端 — 作品广场视频分区与详情播放

**Files:**
- Create: `src/components/works/featured-video-card.tsx`
- Create: `src/components/works/video-works-section.tsx`
- Modify: `src/app/works/page.tsx`
- Modify: `src/app/works/[id]/page.tsx`

> 执行前先阅读 `src/components/works/my-works-board.tsx` 与 `work-detail-panel.tsx` 对齐设计；本 Task 以「新增独立视频分区 + 详情播放」为主，不改图片瀑布流。

- [ ] **Step 1: 精选视频卡片组件**

`src/components/works/featured-video-card.tsx`：

```tsx
"use client";

/* eslint-disable @next/next/no-img-element */
import { Play } from "lucide-react";

import type { SerializedFeaturedVideo } from "@/lib/prisma-mappers";

export function FeaturedVideoCard({
  video,
  onOpen,
}: {
  video: SerializedFeaturedVideo;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(video.id)}
      className="group relative block w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[#1c1714] shadow-[0_14px_30px_rgba(84,52,29,0.12)] transition hover:-translate-y-0.5"
      title={video.prompt}
    >
      <div className="relative aspect-video w-full">
        {video.posterUrl ? (
          <img src={video.posterUrl} alt={video.title} className="size-full object-cover" loading="lazy" />
        ) : (
          <video src={video.videoUrl} muted playsInline preload="metadata" className="size-full object-cover" />
        )}
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover:bg-[var(--accent)]">
            <Play className="size-5" />
          </span>
        </span>
        {video.durationSeconds != null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {video.durationSeconds}s
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="truncate text-xs font-medium text-white/90">{video.authorName}</span>
        <span className="shrink-0 text-[10px] text-white/60">♥ {video.likeCount}</span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: 用户视频分区组件**

`src/components/works/video-works-section.tsx`（用户在「作品」页查看自己的视频、投稿/撤回入口）。基础实现：拉取自己的视频任务（复用 `/api/me/generations` 过滤视频），列出每条的状态与「投稿/撤回」按钮（PATCH `/api/me/works/{videoId}/showcase?` body 带 `mediaType: "video"`）：

```tsx
"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";

type MyVideoItem = {
  id: string;            // GeneratedVideo id
  url: string;
  posterUrl: string | null;
  showcaseStatus: "PRIVATE" | "PENDING" | "FEATURED" | "TAKEDOWN_PENDING";
};

export function VideoWorksSection({ initialVideos }: { initialVideos: MyVideoItem[] }) {
  const [videos, setVideos] = useState(initialVideos);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, action: "submit" | "withdraw") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/me/works/${id}/showcase`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mediaType: "video", showPromptPublic: true }),
      });
      if (res.ok) {
        setVideos((cur) =>
          cur.map((v) =>
            v.id === id
              ? { ...v, showcaseStatus: action === "submit" ? "PENDING" : "PRIVATE" }
              : v,
          ),
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  if (videos.length === 0) {
    return <p className="text-sm text-[var(--ink-soft)]">还没有视频作品，去 /video 生成一段吧。</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {videos.map((video) => (
        <div key={video.id} className="studio-card overflow-hidden p-0">
          <div className="relative aspect-video bg-[#1c1714]">
            {video.posterUrl ? (
              <img src={video.posterUrl} alt="视频" className="size-full object-cover" />
            ) : (
              <video src={video.url} muted playsInline preload="metadata" className="size-full object-cover" />
            )}
          </div>
          <div className="flex items-center justify-between gap-2 p-2.5">
            <span className="text-xs text-[var(--ink-soft)]">{video.showcaseStatus}</span>
            {video.showcaseStatus === "PRIVATE" && (
              <button
                type="button"
                disabled={busyId === video.id}
                onClick={() => act(video.id, "submit")}
                className="rounded-full bg-[#5a4a3b] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50"
              >
                投稿
              </button>
            )}
            {video.showcaseStatus === "PENDING" && (
              <button
                type="button"
                disabled={busyId === video.id}
                onClick={() => act(video.id, "withdraw")}
                className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)] transition hover:bg-[#f7efe4] disabled:opacity-50"
              >
                撤回
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

> 服务端在 `works/page.tsx` 查询用户的 `GeneratedVideo`（`where: { job: { userId } }`，select id/url/posterUrl/showcaseStatus）并传入 `initialVideos`。

- [ ] **Step 3: `works/page.tsx` 接入视频分区**

`src/app/works/page.tsx`，在 `Promise.all` 加一项查询用户视频，并在 `MyWorksBoard` 之后渲染 `<VideoWorksSection>`。查询：

```ts
import { db } from "@/lib/db";
import { VideoWorksSection } from "@/components/works/video-works-section";
```

```ts
  const [initialPage, counts, myVideos] = await Promise.all([
    listUserWorksPage({ userId: user.id, limit: 24 }),
    getUserWorksCounts(user.id),
    db.generatedVideo.findMany({
      where: { job: { userId: user.id } },
      select: { id: true, posterUrl: true, showcaseStatus: true, url: true },
      orderBy: { createdAt: "desc" },
      take: 48,
    }),
  ]);
```

在 `<MyWorksBoard ... />` 之后加：

```tsx
        <div className="mt-10">
          <h2 className="mb-4 text-2xl font-semibold text-[var(--ink)]">我的视频</h2>
          <VideoWorksSection initialVideos={myVideos} />
        </div>
```

- [ ] **Step 4: 详情页支持视频播放**

`src/app/works/[id]/page.tsx`：先尝试图片 `getWorkById(id)`，未命中再查视频并渲染 `<video>`。在 `getWorkById` 未命中分支加视频回退（最小实现：查 `db.generatedVideo` + `canViewWorkDetail`，命中则渲染播放器，否则 `notFound()`）：

```tsx
import { db } from "@/lib/db";
```

把 `if (!work) { notFound(); }` 段（约 21-23 行）改为：

```tsx
  if (!work) {
    const video = await db.generatedVideo.findUnique({
      where: { id },
      include: { job: { select: { prompt: true, userId: true } } },
    });
    const isVideoOwner = user?.id === video?.job.userId;
    if (!video || !canViewWorkDetail({ isOwner: isVideoOwner, showcaseStatus: video.showcaseStatus })) {
      notFound();
    }
    return (
      <main className="pb-20">
        <SiteHeader currentUser={user ? serializeUser(user) : null} />
        <section className="mx-auto grid max-w-5xl gap-6 px-5 pb-12 pt-8 md:px-8">
          <video
            src={video.url}
            poster={video.posterUrl ?? undefined}
            controls
            playsInline
            className="w-full rounded-2xl border-[6px] border-white bg-black shadow-[0_18px_40px_rgba(84,52,29,0.18)]"
          />
          <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
            {video.showPromptPublic ? video.job.prompt : "作者未公开提示词"}
          </p>
        </section>
      </main>
    );
  }
```

- [ ] **Step 5: 类型自检 + Lint + 手动验收**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 通过。

手动验收（`pnpm dev`）：
- 在 `/works` 看到「我的视频」分区，对私有视频点「投稿」→ 状态变 PENDING。
- 管理员审核（现有后台或直接 PATCH `/api/admin/works/{videoId}/review` body `{action:"approve_feature", mediaType:"video"}`）→ 状态变 FEATURED。
- 调 `GET /api/works/featured?mediaType=video` 返回该视频。
- 访问 `/works/{videoId}` 能播放。
- 点赞 `PUT /api/works/{videoId}/like?mediaType=video` 切换点赞、计数变化。

- [ ] **Step 6: Commit**

```bash
git add src/components/works/featured-video-card.tsx src/components/works/video-works-section.tsx src/app/works/page.tsx "src/app/works/[id]/page.tsx"
git commit -m "feat(video): 作品广场视频分区、投稿与详情播放"
```

---

## Self-Review（已执行）

- **Spec 覆盖（阶段 5-6，spec §10 + §4.4）：** `WorkLike` 改造→Task 1；投稿→Task 5；审核→Task 6；点赞→Task 7；精选列表→Task 8；视频序列化与查询→Task 2-3；前端分区/详情播放→Task 9。`mediaType` 参数收敛端点（不新增并行端点）符合 spec §10「优先加 mediaType」。视频独立分区、不混排瀑布流符合 spec §10。
- **占位符扫描：** 无 TBD/TODO。后端为完整真实代码；前端组件为可运行实现，视觉细节按粒度声明允许微调。
- **类型一致性：** `SerializedFeaturedVideo`/`FeaturedVideoRecord` 在 prisma-mappers 定义、server/works 消费、FeaturedVideoCard props 一致；`getVideoMutationTarget` 返回形状（`featuredAt`/`job.userId`/`showcaseStatus`）与 `applyUserShowcaseAction`/`applyAdminWorkReview` 入参契合；`mediaType` 在 schema（body）与 like/featured 端点（query）取值方式已分别说明；`videoId_userId` 复合键由 Task 1 唯一约束生成。
- **复用而非重写：** 状态机纯函数、cursor 编解码、`revalidateTag`、设计 token 全部复用；图片作品链路逻辑零改动（仅在端点内加 `isVideo` 分支）。
- **已知假设：** 视频投稿后端点对视频返回 `work: null`（前端自行刷新）；管理后台审核列表暂不专门筛选视频（沿用现有，或用 API 直接审核）；详情页视频回退为「图片未命中再查视频」，依赖图片/视频 id 不冲突（均为 cuid，天然不冲突）。
