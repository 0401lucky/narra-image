# 后台管理：作品强制下架 + 用户删除 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Narra Image 后台添加两块运营兜底：管理员可主动下架任意可见作品（回到 PRIVATE），可硬删除其他用户（个人数据级联清理，历史关联置空保留）。

**Architecture:** 作品下架复用现有 `applyAdminWorkReview` 状态机，新增动作 `force_takedown`，前端在审核面板对应卡片加按钮 + 确认弹窗。用户删除走新建 `DELETE /api/admin/users/[id]`，先用 Prisma migration 把 7 个外键改成 `onDelete: SetNull`，路由内只需 `db.user.delete()`，UI 在用户卡片加红色按钮 + 确认弹窗。

**Tech Stack:** Next.js 16 App Router、TypeScript、Prisma 7 + PostgreSQL、zod、vitest（jsdom）、Tailwind、lucide-react。

**关键参考文件**：
- 设计文档：`docs/superpowers/specs/2026-05-19-admin-moderation-tools-design.md`
- 状态机：`src/lib/work-showcase.ts`
- 现有审核 API：`src/app/api/admin/works/[id]/review/route.ts`
- 审核面板：`src/components/admin/admin-works-board.tsx`
- 用户卡片：`src/components/admin/user-admin-card.tsx`
- 现有作品状态测试：`src/tests/unit/work-showcase.test.ts`
- 现有路由测试参考：`src/tests/unit/admin-generations-route.test.ts`、`src/tests/unit/work-delete-route.test.ts`
- HTTP helpers：`src/lib/server/http.ts`

**项目 Bash 注意事项**：
- 包管理器：`pnpm`（version 10.32.1）
- 测试命令：`pnpm test`（运行所有）/ `pnpm vitest run <path>`（运行单个文件）
- Lint：`pnpm lint`
- 路径分隔符：Bash 用 forward slash；Windows 项目可用 `pnpm vitest run src/tests/unit/work-showcase.test.ts`

---

## 模块 A：作品强制下架（状态机 + API + UI）

### Task A1：扩展状态机单元测试（先写测试，TDD）

**Files:**
- Modify: `src/tests/unit/work-showcase.test.ts`

- [ ] **Step 1: 在文件底部追加 force_takedown 的成功用例**

打开 `src/tests/unit/work-showcase.test.ts`，在 `describe("作品状态流转", ...)` 块内（约第 132 行 `it("管理员同意下架后回到私有状态..."` 之后），紧跟着追加：

```ts
  it("管理员强制下架待审核作品时回到私有状态并清空投稿时间", () => {
    const result = applyAdminWorkReview({
      action: "force_takedown",
      currentStatus: "PENDING",
      now,
      reviewNote: "违规内容",
      reviewerId: "admin_5",
    });

    expect(result).toEqual({
      featuredAt: null,
      reviewNote: "违规内容",
      reviewedAt: now,
      reviewedById: "admin_5",
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    });
  });

  it("管理员强制下架公开作品时清空 featuredAt 和 submittedAt", () => {
    const result = applyAdminWorkReview({
      action: "force_takedown",
      currentFeaturedAt: new Date("2026-04-20T09:00:00.000Z"),
      currentStatus: "FEATURED",
      now,
      reviewNote: null,
      reviewerId: "admin_6",
    });

    expect(result).toEqual({
      featuredAt: null,
      reviewNote: null,
      reviewedAt: now,
      reviewedById: "admin_6",
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    });
  });

  it("管理员强制下架待下架申请的作品也能执行", () => {
    const result = applyAdminWorkReview({
      action: "force_takedown",
      currentStatus: "TAKEDOWN_PENDING",
      now,
      reviewNote: "",
      reviewerId: "admin_7",
    });

    expect(result).toEqual({
      featuredAt: null,
      reviewNote: null,
      reviewedAt: now,
      reviewedById: "admin_7",
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    });
  });
```

- [ ] **Step 2: 给非法源状态校验补一行测试用例**

在同文件第二个 `it.each` 块（"非法管理员审核会抛错"，约第 150 行）的数组里追加一行：

```ts
    ["force_takedown", "PRIVATE"],
```

修改后该数组应是：

```ts
  it.each([
    ["approve_feature", "FEATURED"],
    ["reject_feature", "PRIVATE"],
    ["approve_unfeature", "PENDING"],
    ["reject_unfeature", "PRIVATE"],
    ["force_takedown", "PRIVATE"],
  ] as const)(
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm vitest run src/tests/unit/work-showcase.test.ts`
Expected: 3 个新增 it + 1 个新 it.each 行 FAIL，错误类似 `'"force_takedown"' is not assignable to ...` 或 `Invalid enum value`，因为 `adminWorkReviewActions` 还没包含该值。

- [ ] **Step 4: Commit 测试**

```bash
git add src/tests/unit/work-showcase.test.ts
git commit -m "test: 为管理员强制下架新增 force_takedown 状态机用例"
```

---

### Task A2：在状态机中实现 force_takedown

**Files:**
- Modify: `src/lib/work-showcase.ts`

- [ ] **Step 1: 扩展 adminWorkReviewActions 常量**

在 `src/lib/work-showcase.ts:18-23` 找到：

```ts
export const adminWorkReviewActions = [
  "approve_feature",
  "reject_feature",
  "approve_unfeature",
  "reject_unfeature",
] as const;
```

改为：

```ts
export const adminWorkReviewActions = [
  "approve_feature",
  "reject_feature",
  "approve_unfeature",
  "reject_unfeature",
  "force_takedown",
] as const;
```

- [ ] **Step 2: 扩展 assertAdminActionAllowed**

找到 `assertAdminActionAllowed`（约第 63-76 行）：

```ts
function assertAdminActionAllowed(
  action: AdminWorkReviewAction,
  currentStatus: WorkShowcaseStatus,
) {
  const allowed =
    ((action === "approve_feature" || action === "reject_feature") &&
      currentStatus === "PENDING") ||
    ((action === "approve_unfeature" || action === "reject_unfeature") &&
      currentStatus === "TAKEDOWN_PENDING");

  if (!allowed) {
    throw new Error("当前状态不允许执行该审核操作");
  }
}
```

改为：

```ts
function assertAdminActionAllowed(
  action: AdminWorkReviewAction,
  currentStatus: WorkShowcaseStatus,
) {
  const allowed =
    ((action === "approve_feature" || action === "reject_feature") &&
      currentStatus === "PENDING") ||
    ((action === "approve_unfeature" || action === "reject_unfeature") &&
      currentStatus === "TAKEDOWN_PENDING") ||
    (action === "force_takedown" &&
      (currentStatus === "PENDING" ||
        currentStatus === "FEATURED" ||
        currentStatus === "TAKEDOWN_PENDING"));

  if (!allowed) {
    throw new Error("当前状态不允许执行该审核操作");
  }
}
```

- [ ] **Step 3: 扩展 applyAdminWorkReview**

在 `applyAdminWorkReview` 函数最后的 `return { ... showcaseStatus: "FEATURED" };`（约第 164-170 行，是 `reject_unfeature` 的默认分支）**之前**插入 force_takedown 分支。

完整改造后函数应是（第 132 行开始替换）：

```ts
  if (action === "approve_feature") {
    return {
      featuredAt: now,
      reviewNote: normalizeReviewNote(reviewNote),
      reviewedAt: now,
      reviewedById: reviewerId,
      showcaseStatus: "FEATURED",
    };
  }

  if (action === "reject_feature") {
    return {
      featuredAt: null,
      reviewNote: normalizeReviewNote(reviewNote),
      reviewedAt: now,
      reviewedById: reviewerId,
      showcaseStatus: "PRIVATE",
    };
  }

  if (action === "approve_unfeature") {
    return {
      featuredAt: null,
      reviewNote: normalizeReviewNote(reviewNote),
      reviewedAt: now,
      reviewedById: reviewerId,
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    };
  }

  if (action === "force_takedown") {
    return {
      featuredAt: null,
      reviewNote: normalizeReviewNote(reviewNote),
      reviewedAt: now,
      reviewedById: reviewerId,
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    };
  }

  return {
    featuredAt: currentFeaturedAt,
    reviewNote: normalizeReviewNote(reviewNote),
    reviewedAt: now,
    reviewedById: reviewerId,
    showcaseStatus: "FEATURED",
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/tests/unit/work-showcase.test.ts`
Expected: 全部 PASS（包括之前失败的 4 个用例和原有的 13 个）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-showcase.ts
git commit -m "feat: 状态机新增 force_takedown 管理员强制下架动作"
```

---

### Task A3：审核面板按钮 + 确认弹窗

**Files:**
- Modify: `src/components/admin/admin-works-board.tsx`

无单测——这是 React 客户端组件，按现有项目约定（如 user-admin-card / admin-actions）通过手动验证。

- [ ] **Step 1: 在 getActionButtons 增加 force_takedown 按钮**

在 `src/components/admin/admin-works-board.tsx:55-71` 找到 `getActionButtons`，改为：

```ts
function getActionButtons(status: WorkShowcaseStatus) {
  if (status === "PENDING") {
    return [
      { action: "approve_feature" as const, label: "通过投稿", variant: "primary" as const },
      { action: "reject_feature" as const, label: "拒绝投稿", variant: "secondary" as const },
      { action: "force_takedown" as const, label: "强制下架", variant: "danger" as const },
    ];
  }

  if (status === "TAKEDOWN_PENDING") {
    return [
      { action: "approve_unfeature" as const, label: "确认下架", variant: "primary" as const },
      { action: "reject_unfeature" as const, label: "拒绝下架", variant: "secondary" as const },
      { action: "force_takedown" as const, label: "强制下架", variant: "danger" as const },
    ];
  }

  if (status === "FEATURED") {
    return [
      { action: "force_takedown" as const, label: "强制下架", variant: "danger" as const },
    ];
  }

  return [];
}
```

- [ ] **Step 2: 在组件里增加 confirmTakedownWork 状态**

在 `AdminWorksBoard` 函数顶部（约第 74-79 行 useState 区域），追加：

```ts
  const [confirmTakedownWork, setConfirmTakedownWork] = useState<SerializedAdminWork | null>(null);
```

- [ ] **Step 3: 调整按钮渲染，对 danger 走确认弹窗**

替换 `src/components/admin/admin-works-board.tsx` 中按钮渲染部分（约第 244-258 行 `getActionButtons(...).map(...)` 整段），改为：

```tsx
                          {getActionButtons(work.showcaseStatus).map((button) => {
                            const isDanger = button.variant === "danger";
                            const isPrimary = button.variant === "primary";
                            const baseClass = isDanger
                              ? "border border-rose-300 text-rose-600 hover:bg-rose-50"
                              : isPrimary
                                ? "bg-[var(--ink)] text-white hover:bg-[var(--accent)]"
                                : "border border-[var(--line)] text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)]";

                            return (
                              <button
                                key={button.action}
                                type="button"
                                disabled={pendingWorkId === work.id}
                                onClick={() => {
                                  if (isDanger) {
                                    setConfirmTakedownWork(work);
                                  } else {
                                    void handleReview(work.id, button.action);
                                  }
                                }}
                                className={`rounded-full px-4 py-2 text-sm font-medium transition ${baseClass} disabled:opacity-60`}
                              >
                                {pendingWorkId === work.id ? "处理中..." : button.label}
                              </button>
                            );
                          })}
```

- [ ] **Step 4: 在组件 return 末尾增加确认弹窗 JSX**

在 `src/components/admin/admin-works-board.tsx` 的 `return ( <> ... </> )` 末尾，紧跟着 `{promptWork ? <PromptModal ... /> : null}` 之后（约第 289 行），追加：

```tsx
      {confirmTakedownWork ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => {
            if (pendingWorkId !== confirmTakedownWork.id) setConfirmTakedownWork(null);
          }}
        >
          <div
            className="studio-card w-full max-w-md rounded-[1.8rem] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">强制下架作品</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              作品将被下架至 PRIVATE，不再公开展示。作者后续仍可重新投稿。下架理由会写入审核备注。
            </p>
            <div className="mt-4 grid gap-2 rounded-[1.2rem] border border-[var(--line)] bg-[var(--surface-strong)]/40 p-3 text-xs text-[var(--ink-soft)]">
              <div>作者：{confirmTakedownWork.author.email}</div>
              <div>当前状态：{getWorkShowcaseStatusLabel(confirmTakedownWork.showcaseStatus)}</div>
              <div className="line-clamp-2 text-[var(--ink)]">提示词：{confirmTakedownWork.prompt}</div>
            </div>
            {errors[confirmTakedownWork.id] ? (
              <p className="mt-3 text-sm text-rose-600">{errors[confirmTakedownWork.id]}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={pendingWorkId === confirmTakedownWork.id}
                onClick={() => setConfirmTakedownWork(null)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={pendingWorkId === confirmTakedownWork.id}
                onClick={async () => {
                  const id = confirmTakedownWork.id;
                  await handleReview(id, "force_takedown");
                  setConfirmTakedownWork((current) => (current?.id === id ? null : current));
                }}
                className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {pendingWorkId === confirmTakedownWork.id ? "下架中..." : "确认下架"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
```

- [ ] **Step 5: 跑 lint 与单测**

Run: `pnpm lint`
Expected: 通过。

Run: `pnpm vitest run src/tests/unit/work-showcase.test.ts`
Expected: 通过。

- [ ] **Step 6: 手动验证**

启动 dev：`pnpm dev`。以管理员身份登录 `/admin/works`：
1. PENDING 区域作品 → 点"强制下架" → 弹窗 → 在卡片 textarea 写理由 → 确认 → 作品消失/状态变 PRIVATE。
2. FEATURED 区域作品同样测试。
3. TAKEDOWN_PENDING 区域同样测试。
4. 弹窗点取消不触发请求。

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/admin-works-board.tsx
git commit -m "feat: 后台审核面板新增强制下架按钮与确认弹窗"
```

---

## 模块 B：Prisma 外键级联调整 + 用户删除

### Task B1：修改 Prisma schema 加 onDelete: SetNull

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 修改 InviteBatch.createdBy**

在 `prisma/schema.prisma:84` 找到：

```prisma
  createdBy   User?        @relation("InviteBatchCreatedBy", fields: [createdById], references: [id])
```

改为：

```prisma
  createdBy   User?        @relation("InviteBatchCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
```

- [ ] **Step 2: 修改 InviteCode.createdBy 与 InviteCode.usedBy**

在 `prisma/schema.prisma:192-193` 找到：

```prisma
  createdBy   User?        @relation("InviteCreatedBy", fields: [createdById], references: [id])
  usedBy      User?        @relation("InviteUsedBy", fields: [usedById], references: [id])
```

改为：

```prisma
  createdBy   User?        @relation("InviteCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  usedBy      User?        @relation("InviteUsedBy", fields: [usedById], references: [id], onDelete: SetNull)
```

- [ ] **Step 3: 修改 RedeemCodeBatch.createdBy**

在 `prisma/schema.prisma:219` 找到：

```prisma
  createdBy      User?          @relation("RedeemBatchCreatedBy", fields: [createdById], references: [id])
```

改为：

```prisma
  createdBy      User?          @relation("RedeemBatchCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
```

- [ ] **Step 4: 修改 RedeemCode.createdBy**

在 `prisma/schema.prisma:237` 找到：

```prisma
  createdBy      User?              @relation("RedeemCodeCreatedBy", fields: [createdById], references: [id])
```

改为：

```prisma
  createdBy      User?              @relation("RedeemCodeCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
```

- [ ] **Step 5: 修改 GenerationJob.featuredBy**

在 `prisma/schema.prisma:315` 找到：

```prisma
  featuredBy        User?                  @relation("FeaturedByAdmin", fields: [featuredById], references: [id])
```

改为：

```prisma
  featuredBy        User?                  @relation("FeaturedByAdmin", fields: [featuredById], references: [id], onDelete: SetNull)
```

- [ ] **Step 6: 修改 GenerationImage.reviewedBy**

在 `prisma/schema.prisma:356` 找到：

```prisma
  reviewedBy       User?          @relation("ReviewedWorks", fields: [reviewedById], references: [id])
```

改为：

```prisma
  reviewedBy       User?          @relation("ReviewedWorks", fields: [reviewedById], references: [id], onDelete: SetNull)
```

- [ ] **Step 7: 生成 migration**

Run: `pnpm prisma migrate dev --name user-deletion-set-null`
Expected: 生成 `prisma/migrations/<timestamp>_user_deletion_set_null/migration.sql`，内含 7 段 `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ... ON DELETE SET NULL`。

如果数据库不在本地或没有连接，跳过这一步——用户会在自己环境执行（命令会同步更新 `prisma migrate` 状态）。仅检查生成的 schema 是否能通过 `pnpm prisma format` 与 `pnpm prisma validate`：

Run: `pnpm prisma format && pnpm prisma validate`
Expected: 输出 valid，无报错。

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): 外键 onDelete 改为 SetNull 以支持删除用户"
```

如果 migrate 没成功只改了 schema：commit 只含 schema，备注 "（migration 待环境同步）"，但建议先在本地数据库跑通再提交。

---

### Task B2：删除用户 API 的单元测试（TDD）

**Files:**
- Create: `src/tests/unit/admin-user-delete-route.test.ts`

- [ ] **Step 1: 写测试**

新建 `src/tests/unit/admin-user-delete-route.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindUnique,
  mockRequireAdminRecord,
  mockUserDelete,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
  mockUserDelete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      delete: mockUserDelete,
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

import { DELETE } from "@/app/api/admin/users/[id]/route";

describe("后台用户删除接口", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockRequireAdminRecord.mockReset();
    mockUserDelete.mockReset();
  });

  it("管理员可删除其他用户", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockFindUnique.mockResolvedValue({ id: "user_2", email: "victim@example.com" });
    mockUserDelete.mockResolvedValue({ id: "user_2" });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "user_2" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        deleted: { id: "user_2", email: "victim@example.com" },
      },
    });
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: "user_2" } });
  });

  it("禁止管理员删除自己", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "admin_1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "不能删除自己的账号",
    });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("目标用户不存在时返回 404", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockFindUnique.mockResolvedValue(null);

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "ghost" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "用户不存在" });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("非管理员调用时返回错误", async () => {
    mockRequireAdminRecord.mockRejectedValue(new Error("没有管理员权限"));

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "user_2" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "没有管理员权限" });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/tests/unit/admin-user-delete-route.test.ts`
Expected: FAIL，错误为找不到模块 `@/app/api/admin/users/[id]/route` 或类似。

- [ ] **Step 3: Commit 测试**

```bash
git add src/tests/unit/admin-user-delete-route.test.ts
git commit -m "test: 添加后台用户删除接口单元测试"
```

---

### Task B3：实现删除用户 API 路由

**Files:**
- Create: `src/app/api/admin/users/[id]/route.ts`

- [ ] **Step 1: 创建路由文件**

新建 `src/app/api/admin/users/[id]/route.ts`：

```ts
import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdminRecord();
    const { id } = await context.params;

    if (id === admin.id) {
      return jsonError("不能删除自己的账号", 400);
    }

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!user) {
      return jsonError("用户不存在", 404);
    }

    await db.user.delete({ where: { id } });

    return jsonOk({
      deleted: { id: user.id, email: user.email },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm vitest run src/tests/unit/admin-user-delete-route.test.ts`
Expected: 4 个用例全 PASS。

- [ ] **Step 3: 跑全量单测确保没回归**

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/users/[id]/route.ts
git commit -m "feat: 新增 DELETE /api/admin/users/[id] 路由"
```

---

### Task B4：用户卡片删除按钮 + 确认弹窗

**Files:**
- Modify: `src/components/admin/user-admin-card.tsx`

- [ ] **Step 1: 调整 imports 和 type**

在 `src/components/admin/user-admin-card.tsx:1-7` 找到现有 imports，改为：

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Shield, ShieldOff, Trash2 } from "lucide-react";

import { CreditAdjuster } from "@/components/admin/admin-actions";
```

- [ ] **Step 2: 在组件内添加删除状态与函数**

在 `UserAdminCard` 函数内，原 `const [error, setError] = useState<string | null>(null);`（约第 28 行）下面追加：

```tsx
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setDeleteError(result.error || "删除失败，请稍后再试");
        return;
      }
      setConfirmingDelete(false);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setIsDeleting(false);
    }
  }
```

- [ ] **Step 3: 在操作列追加删除按钮**

找到 `src/components/admin/user-admin-card.tsx` 中 `<div className="flex items-end">` 块（约第 95-121 行），把里面的 `{!isCurrentAdmin && ( <button ...> )}` 块改为：

```tsx
        {!isCurrentAdmin && (
          <div className="flex flex-col items-stretch gap-1.5">
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(handleRoleToggle)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition disabled:opacity-60 ${
                user.role === "admin"
                  ? "border border-amber-200 text-amber-700 hover:bg-amber-50"
                  : "border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              }`}
            >
              {user.role === "admin" ? (
                <>
                  <ShieldOff className="size-3.5" />
                  {isPending ? "处理中…" : "取消管理员"}
                </>
              ) : (
                <>
                  <Shield className="size-3.5" />
                  {isPending ? "处理中…" : "设为管理员"}
                </>
              )}
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
            >
              <Trash2 className="size-3.5" />
              删除用户
            </button>
          </div>
        )}
        {error && <span className="text-xs text-rose-600">{error}</span>}
```

- [ ] **Step 4: 在卡片末尾追加确认弹窗**

找到 `UserAdminCard` 的 `return (` 中 `</article>` 标签（约第 122 行）。把现有 `return (...)` 改为返回 fragment，并在 `</article>` 后追加弹窗：

```tsx
  return (
    <>
      <article className="studio-card grid gap-4 rounded-[1.8rem] p-5 xl:grid-cols-[1.2fr_0.6fr_0.5fr_0.8fr_auto]">
        {/* …原 article 内容保持不变… */}
      </article>

      {confirmingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!isDeleting) setConfirmingDelete(false);
          }}
        >
          <div
            className="studio-card w-full max-w-md rounded-[1.8rem] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">删除用户</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              将永久删除该用户及其全部生成记录、对话、API Key、签到、兑换记录、点赞。该用户创建过的邀请码/兑换码将保留，作者字段会被清空。操作不可恢复。
            </p>
            <div className="mt-4 grid gap-2 rounded-[1.2rem] border border-[var(--line)] bg-[var(--surface-strong)]/40 p-3 text-xs text-[var(--ink-soft)]">
              <div>邮箱：{user.email}</div>
              <div>注册：{new Date(user.createdAt).toLocaleString("zh-CN")}</div>
              <div>生成次数：{user.generationCount}</div>
              <div>当前积分：{user.credits}</div>
            </div>
            {deleteError ? (
              <p className="mt-3 text-sm text-rose-600">{deleteError}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmingDelete(false)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {isDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
                {isDeleting ? "删除中" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
```

> 注意：`{/* …原 article 内容保持不变… */}` 仅为占位说明；实际编辑时保留 `<article>` 内的原始 JSX（标签头与子节点都不动），只在 `<article>` 外层包裹 `<>...</>` 并在尾部添加弹窗。

- [ ] **Step 5: 跑 lint**

Run: `pnpm lint`
Expected: 通过。

- [ ] **Step 6: 手动验证**

启动 dev：`pnpm dev`，以管理员登录 `/admin/users`：
1. 点其他用户卡片上的"删除用户" → 弹窗 → 信息正确 → 点确认 → 用户卡片消失，列表 totalCount 减 1。
2. 弹窗"取消"按钮不发请求。
3. 自己卡片上没有"删除用户"按钮。
4. 数据库验证（如果方便）：被删用户的 generation/conversation/apiKey 都已级联消失；他创建过的邀请码仍在，但 `createdById` 已为 null。

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/user-admin-card.tsx
git commit -m "feat: 用户管理卡片新增删除用户按钮与确认弹窗"
```

---

## 收尾

### Task C1：最终回归

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 通过。

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 通过（同时会跑 `prisma generate`，确认 schema 变更对客户端没破坏）。

- [ ] **Step 4: 如有失败修复后再次 commit**

无失败则跳过；有失败则按调试流程修复并在原任务对应位置补 commit。

---

## 自检清单

**Spec 覆盖**：
- 作品强制下架（状态机 / API 复用 / 三态可下架 / reviewNote 写入）→ Task A1 / A2 / A3
- 弹窗确认 → A3 / B4
- Prisma onDelete: SetNull 7 个外键 → B1
- 删除用户 API + 边界 → B2 / B3
- 用户卡片删除按钮 → B4
- 测试 / Lint / Build → C1

**Placeholder 扫描**：完成。无 TBD/TODO/省略代码（注意 Task B4 Step 4 的 `{/* …原 article 内容保持不变… */}` 是文字说明，已显式标注为占位）。

**类型与方法名一致性**：
- `force_takedown` 在 work-showcase、validators（自动推导）、admin-works-board 一致。
- `setConfirmTakedownWork` / `confirmTakedownWork` 命名一致。
- DELETE 路由路径 `/api/admin/users/[id]` 在前端 fetch、单测 import、文件路径三处一致。
