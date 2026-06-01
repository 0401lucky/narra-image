# 视频工作区（Video Workspace）设计文档

- 日期：2026-06-01
- 状态：已与用户确认方向，待 spec 评审
- 范围档位：**A · 完整 MVP**（文生视频 + 图生视频，且视频可投稿作品广场）

---

## 1. 目标

在 narra image（图片生成站）中新增一个**独立的视频工作区**页面 `/video`，让用户用与现有创作台一致的体验生成视频，并把生成结果纳入现有的作品广场体系。

参考项目 `infinite-canvas` 的灵魂是「节点式无限画布」，本设计**不复刻画布**，只取「在工作站里调用视频 AI」这一能力，落成一个专注、线性的视频工作区。

成功标准：
- 用户在 `/video` 输入提示词（可选首帧/参考图）→ 提交 → 看到任务进入历史时间线并实时更新进度 → 成功后在预览舞台播放视频、可下载、可投稿。
- 生成由现有 Go Worker 异步处理，前端沿用现有轮询，无需新增轮询机制。
- 视频可投稿至作品广场，走现有审核/精选/点赞流程。

---

## 2. 范围

### 纳入（In scope）
- 新页面 `/video`：左参数面板 · 中预览舞台 · 底部历史时间线（布局已确认）。
- 两种生成类型：`text_to_video`（文生视频）、`image_to_video`（图生视频，复用 `sourceImageUrls`）。
- 视频参数：时长（秒）、画面比例、分辨率。
- 通过现有「渠道体系 / OpenAI 兼容接口」调用视频生成（异步：提交→轮询→取结果），在 Go Worker 内部完成。
- 积分扣减/失败退还，复用现有事务逻辑，新增视频专用计费。
- 作品广场接入视频：投稿、管理员审核、精选、点赞、视频详情播放。

### 不纳入（Out of scope）
- 节点式无限画布、节点连线、小地图、撤销重做。
- 视频剪辑/拼接/时间轴编辑、转场、配乐。
- 视频续写/扩展、关键帧编辑。
- 后台「视频专项管理」（视频渠道独立标注、视频生成记录独立筛选）——属档位 C，本期不做，沿用现有渠道与生成记录管理。
- 对外 OpenAI 兼容 API（`/v1/*`、`/responses`）暴露视频能力——本期仅网页端。

---

## 3. 核心架构决策

**决策：扩展现有 `GenerationJob` + Go Worker，而非新建独立的 VideoJob 子系统。**

理由（简单优先）：
- 现有 Worker 已支持长任务：`JobTimeout` 默认 900s、每 10s 心跳续锁、`FOR UPDATE SKIP LOCKED` 并发领取、重试与超时回收。视频「提交→轮询→取结果」可**完全在单次任务处理内部完成**，任务保持 `PROCESSING` 直到 Worker 内部轮询结束。
- 前端轮询 `GET /api/me/generations/{id}` 的机制对「图片同步」和「视频异步」完全一致——任务在 `PENDING/PROCESSING` 期间前端持续轮询，无需任何改动。
- 积分事务、渠道加密、鉴权、会话归组（Conversation）全部直接复用。

代价：`GenerationJob` 会增加几个视频专用可空字段，`images` 与 `videos` 两个关系并存。相比另起一套 Worker/轮询/计费/审核的重复代码，这点模型膨胀可接受。

> 被否决的方案：新建 `VideoJob` + 独立 Worker 循环 + 独立轮询端点。会把领取/加锁/重试/心跳/超时/指标、积分、审核逻辑全部复制一遍，改动面和维护成本远高于收益。

---

## 4. 数据模型变更（Prisma）

文件：`prisma/schema.prisma`

### 4.1 枚举扩展
```prisma
enum GenerationType {
  TEXT_TO_IMAGE
  IMAGE_TO_IMAGE
  TEXT_TO_VIDEO   // 新增
  IMAGE_TO_VIDEO  // 新增
}
```
> 复用现有 `GenerationStatus`（PENDING/PROCESSING/SUCCEEDED/FAILED）与 `ShowcaseStatus`，不新增状态机。

### 4.2 `GenerationJob` 新增字段（均可空，仅视频任务使用）
```prisma
durationSeconds Int?      // 视频时长（秒）
aspectRatio     String?   // 画面比例，如 "16:9" / "9:16" / "1:1"
// 分辨率复用现有 size 字段（存 "1280x720" 或预设标签），不新增列
videos          GeneratedVideo[]  // 新增反向关系
```

### 4.3 新增 `GeneratedVideo` 模型（与 `GenerationImage` 平行，含 showcase 字段）
```prisma
model GeneratedVideo {
  id               String         @id @default(cuid())
  jobId            String
  url              String         // S3 上的 mp4 地址
  posterUrl        String?        // 封面图（首帧/缩略图），可空
  width            Int?
  height           Int?
  durationSeconds  Int?
  // —— 以下为投稿/审核字段，镜像 GenerationImage ——
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
  likes            WorkLike[]

  @@index([showcaseStatus, featuredAt(sort: Desc), id(sort: Desc)])
  @@index([jobId, createdAt])
  @@index([createdAt(sort: Desc), id(sort: Desc)])
}
```

### 4.4 `WorkLike` 改为可同时指向图片或视频
```prisma
model WorkLike {
  // workId 改为可空，新增 videoId（二者恰有其一）
  workId  String?
  videoId String?
  work    GenerationImage? @relation(fields: [workId], references: [id], onDelete: Cascade)
  video   GeneratedVideo?  @relation(fields: [videoId], references: [id], onDelete: Cascade)
  // 唯一约束改为 (workId,userId) 与 (videoId,userId) 两组；应用层校验恰好一个非空
}
```

### 4.5 `ProviderChannel` / `User` 计费字段
```prisma
model ProviderChannel {
  videoCreditCost Int @default(20)   // 视频每次消耗积分，独立于图片 creditCost
}
```
- 环境变量后备：新增 `BUILTIN_PROVIDER_VIDEO_CREDIT_COST`（默认 20）。
- `User.reviewedVideos GeneratedVideo[] @relation("ReviewedVideos")` 反向关系。

### 4.6 迁移
- 新增一条 Prisma migration。
- ⚠️ Go Worker 不走 Prisma，直接用 pgx 原生 SQL 读写。迁移后需同步更新 Worker 的 SQL（见 §7），并确认 `GeneratedVideo`、新列名（驼峰带引号）一致。

---

## 5. 视频生成接口契约（OpenAI 兼容 · 异步）

目标渠道为「OpenAI 兼容视频接口」。以 OpenAI Video API 形态为默认契约，Worker 侧实现一个最小视频客户端：

| 步骤 | 请求 | 说明 |
|---|---|---|
| 创建 | `POST {baseUrl}/videos` | body：`{ model, prompt, seconds, size }`；图生视频额外带首帧/参考图（multipart `input_reference` 或 base64）。返回 `{ id, status }` |
| 轮询 | `GET {baseUrl}/videos/{id}` | 返回 `{ id, status: queued\|in_progress\|completed\|failed, progress? }`，轮询至终态 |
| 取结果 | `GET {baseUrl}/videos/{id}/content` | 下载 mp4 字节流，转存 S3 |
| 封面（可选）| 同上加 `?variant=thumbnail` | 取不到则 `posterUrl` 留空，前端用 `<video>` 自带首帧 |

**假设与适配位**：不同网关的端点路径/字段可能略有差异。Worker 视频客户端将端点与关键字段集中在一个适配层（如 `worker/internal/provider/video_client.go`），默认 OpenAI 形态；若实际渠道不同，仅改该适配层，不影响主流程。该不确定项在 §13 标注。

---

## 6. 提交链路（前端 → API）

**复用 `/api/generate`，用判别式联合（discriminated union）扩展，不新增端点。**

- 文件：`src/lib/generation/parse-generate-request.ts`、`src/app/api/generate/route.ts`
- zod schema 增加 `generationType: "text_to_video" | "image_to_video"` 分支，校验视频参数：
  - `durationSeconds`：枚举/范围（如 4/8/12s，按渠道能力，先给固定档位）
  - `aspectRatio`：枚举（16:9 / 9:16 / 1:1）
  - `size`/分辨率：预设档位（如 720p/1080p → 映射为 `1280x720` 等）
  - 图生视频要求 `sourceImageUrls` 至少 1 张（复用现有上传 → S3）
- 计费：视频任务走 `videoCreditCost`（而非 `creditCost`），其余事务/预扣/`workerManaged=true`/`status=PENDING` 逻辑完全复用。
- 返回 `{ data: { generation } }`，`serializeGeneration` 扩展输出 `videos[]` 与视频参数。

---

## 7. Go Worker 视频处理

文件：`worker/internal/worker/`

- `worker.go::processJob`：按 `generationType` 分叉——`TEXT_TO_VIDEO`/`IMAGE_TO_VIDEO` 走新函数 `generateVideo()`，其余维持 `generateImages()`。
- 新增 `video.go::generateVideo(ctx, storage, job, provider)`：
  1. 调用视频客户端 `create`（图生视频带 `sourceImageUrls`）。
  2. 循环 `poll`（间隔由新配置 `VIDEO_POLL_INTERVAL`，默认 5s）直到 `completed`/`failed`；期间现有 10s 心跳持续续锁。
  3. `completed` → 下载 mp4 → `storage.PersistVideo()` 存 S3（新增方法，与 `PersistImage` 平行）→ 返回 `GeneratedVideo{url,posterUrl,width,height,durationSeconds}`。
  4. `failed`/超时 → 返回错误，走现有 `failJobAndRefund()`（视频按 `videoCreditCost` 退还）。
- `completeJob`：新增「视频分支」——在事务内写 `GeneratedVideo` 记录（原 SQL 写 `GenerationImage`），更新 Job 为 `SUCCEEDED`。
- 整体超时仍受 `JobTimeout`（900s）约束；若视频生成可能超过 15 分钟，需相应调大该配置（§13 标注）。
- 配置：`worker/internal/worker/config.go` 新增 `VideoPollInterval`、`BuiltInProviderVideoCreditCost`、视频默认模型（如有）。

---

## 8. 积分与渠道

- 渠道：直接复用 `ProviderChannel` + `SavedProviderConfig` + AES-GCM 加密（`AUTH_SECRET`）。视频与图片可共用同一渠道（只要该渠道支持视频模型），靠 `model` 区分。
- 计费：图片 `creditCost`，视频 `videoCreditCost`，互不影响。`src/lib/credits.ts` 增加按 `generationType` 取价的逻辑。
- 后台渠道编辑表单（`/api/admin/channels`、对应页面）增加「视频积分单价」字段。（属档位 A 的小改动，非档位 C 的独立视频管理。）

---

## 9. 前端 `/video` 工作区

新增路由 `src/app/video/page.tsx`（服务端加载：当前用户、最近视频任务、活跃渠道、会话）。组件放 `src/components/video/`，复用 `src/components/create` 的设计语言与可复用件。

布局（已确认）：
```
┌───────────────────────────────────────────────┐
│ 顶部导航（复用 SiteHeader）                     │
├──────────────┬────────────────────────────────┤
│ 左：参数面板  │  中：预览舞台                    │
│ - 类型切换    │  - 大号视频播放器（按比例）      │
│   文生/图生   │  - 状态：生成中 %/成功/失败       │
│ - 提示词      │  - 下载 / 复制提示词 / 投稿       │
│ - 首帧/参考图 │                                  │
│ - 模型/渠道   │                                  │
│ - 时长/比例   │                                  │
│   /分辨率     │                                  │
│ - 生成(积分)  │                                  │
├──────────────┴────────────────────────────────┤
│ 底部：历史时间线（横向滚动缩略图 + 状态角标）    │
└───────────────────────────────────────────────┘
```

组件与复用：
- `useImagePoller` → 抽象为 `useGenerationPoller`（逻辑不变：退避间隔、`visibilitychange` 挂起、`/api/me/generations/{id}`），图片/视频共用；或新增同族 `useVideoPoller`。优先抽象复用。
- 新增 `VideoPlayer`（封面 + `<video controls>`）、`VideoComposer`（参数面板）、`VideoHistoryRail`（时间线）。
- 复用 `.studio-card`、暖米色 + 橙色 token、`class-variance-authority`/`clsx`/`tailwind-merge`、`motion/react`、`lucide-react`。
- 导航入口：在 `SiteHeader` 增加「视频」入口。

`serializeGeneration` 扩展：`videos: [{ id, url, posterUrl?, width?, height?, durationSeconds? }]` + `durationSeconds/aspectRatio`。

---

## 10. 作品广场接入视频

- 提交/撤回：`GeneratedVideo` 镜像 `showcaseStatus` 流转。新增 `POST /api/me/videos/{id}/showcase`（与图片版 `/api/me/works/{id}/showcase` 平行），或给现有端点加 `mediaType` 参数。优先**加 `mediaType` 参数**以收敛端点数量。
- 列表：`GET /api/works/featured` 增加 `mediaType=image|video|all`，分别查 `GenerationImage` / `GeneratedVideo`。前端作品页对视频项渲染封面 + 播放角标，详情页用 `<video>`。
- 审核：`POST /api/admin/works/{id}/review` 增加 `mediaType` 参数，管理员后台作品审核列表支持筛选/操作视频。
- 点赞：`POST /api/works/{id}/like` 增加 `mediaType`，写 `WorkLike.videoId`。
- 为控制范围，作品广场默认仍以图片为主，视频通过筛选/分区呈现，不强行混排同一瀑布流。

---

## 11. 错误处理与边界

- 提交校验失败 → 400（zod 首条错误）；积分不足 → 402；未登录 → 401。沿用 `src/lib/server/http.ts` 的 `{ data } / { error }` 约定。
- 视频生成失败/超时 → 任务 `FAILED` + `errorMessage`，按 `videoCreditCost` 退积分（仅内置渠道）。
- 渠道不支持视频 / 端点 404 / 返回结构异常 → Worker 记录明确错误信息，标 `FAILED` 退积分。
- 图生视频未上传参考图 → 提交期 zod 拦截。
- 长任务：单任务受 `JobTimeout` 约束；Worker 内部轮询遵守整体超时，避免无限轮询。
- 大文件：mp4 转存 S3，注意内存（流式下载/分片），失败 fallback 策略沿用现有 `EnableLocalImageFallback` 思路。

---

## 12. 测试策略（vitest + Go test）

- `parse-generate-request`：视频分支 zod 校验（时长/比例/分辨率枚举、图生视频必须有参考图）。
- `credits`：按 `generationType` 取价、预扣与退还。
- API `/api/generate`：视频任务创建、积分原子扣减、`workerManaged/PENDING` 落库。
- 序列化：`serializeGeneration` 输出 `videos`。
- Go：视频客户端 `create/poll/content` 的契约测试（mock provider）；`generateVideo` 成功/失败/超时分支；`completeJob` 写 `GeneratedVideo`。
- showcase：视频投稿/审核/点赞端点的 `mediaType` 分支。

---

## 13. 分阶段实施计划（供 writing-plans 细化）

1. **数据模型与序列化**：Prisma 迁移（枚举、`GenerationJob` 字段、`GeneratedVideo`、`WorkLike` 改造、计费字段）+ TS 类型/zod + `serializeGeneration` 扩展。验证：迁移成功、类型通过、序列化单测。
2. **提交链路**：`/api/generate` 视频分支 + 计费 + 上传参考图。验证：API 单测、积分事务测试。
3. **Go Worker 视频处理**：视频客户端适配层 + `generateVideo` + `completeJob` 视频分支 + 配置。验证：Go 契约/分支测试、端到端 mock 跑通一条视频任务。
4. **`/video` 前端工作区**：页面 + 组件 + 轮询复用 + 视频播放。验证：本地跑通提交→进度→播放→下载。
5. **作品广场视频接入**：showcase/审核/点赞/列表的 `mediaType` 扩展 + 前端渲染。验证：投稿→审核→精选→详情播放全流程。
6. **打磨与测试补全**：错误态、空态、边界、导航入口、文档更新。

> 阶段 1→4 即可让视频工作区独立可用；阶段 5 完成作品广场接入。可按此顺序增量交付。

---

## 14. 未决项 / 假设（需实现期确认）

1. **视频渠道的真实接口形态**：默认按 OpenAI Video API（`/videos` create/poll/content）实现。若你的实际渠道字段/路径不同，仅需改 Worker 视频客户端适配层。**实现前需提供一个可用的视频渠道 baseUrl/key 与模型名做联调。**
2. **时长/分辨率档位**：先给固定预设（时长 4/8/12s，比例 16:9/9:16/1:1，分辨率 720p/1080p）；具体可选项受渠道能力限制，联调后微调。
3. **单任务超时**：若视频生成常超 15 分钟，需调大 `WORKER_JOB_TIMEOUT`。
4. **视频默认计费 20 积分**：可在后台或环境变量调整。
5. **封面图**：能从渠道取到缩略图则存 `posterUrl`，否则留空由 `<video>` 自带首帧。
