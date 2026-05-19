# 后台管理：作品强制下架 + 用户删除

> 设计日期：2026-05-19
> 状态：待评审

## 背景

当前后台缺两个常用的运营兜底能力：

1. **作品审核**只能按"用户发起的投稿/下架申请"流程走，遇到用户已经公开（FEATURED）的不雅图片时，管理员无法主动把它撤下来，必须等用户自己发起下架。
2. **用户管理**只能调整积分和角色，没有删除入口。出现违规账号时无法清理。

## 目标

- 管理员可以在任意可见状态（PENDING / FEATURED / TAKEDOWN_PENDING）下，对单张作品执行"强制下架"，状态回到 PRIVATE。
- 管理员可以在用户列表上删除任意非自己的用户，相关个人数据按 Cascade 清理，历史关联（创建者、审核者）置空保留。
- 两类危险操作都通过弹窗二次确认。

## 非目标

- 不实现批量下架/批量删除。
- 不实现软删除（deletedAt）方案。
- 不引入审计日志表。
- 不通知作者「作品已被下架」。

---

## 一、作品强制下架

### 状态机

新增一个管理员动作 `force_takedown`，允许的源状态：`PENDING`、`FEATURED`、`TAKEDOWN_PENDING`。目标状态：`PRIVATE`。

更新字段：

| 字段 | 值 |
|---|---|
| `showcaseStatus` | `PRIVATE` |
| `featuredAt` | `null` |
| `submittedAt` | `null` |
| `reviewedAt` | `now` |
| `reviewedById` | 当前管理员 id |
| `reviewNote` | 入参（可空，trim 后空字符串归 null） |

作品后续仍可由作者重新投稿（流程保持不变：PRIVATE → PENDING）。

### 代码改动

**`src/lib/work-showcase.ts`**

- `adminWorkReviewActions` 末尾加 `"force_takedown"`，类型自动扩展。
- `assertAdminActionAllowed` 增加分支：当 action 为 `force_takedown` 时，允许 `PENDING / FEATURED / TAKEDOWN_PENDING`。
- `applyAdminWorkReview` 增加分支：返回上表所列字段。

**`src/lib/validators.ts`**

- `adminWorkReviewSchema` 不需要改：`z.enum(adminWorkReviewActions)` 自动包含新值。

**`src/app/api/admin/works/[id]/review/route.ts`**

- 完全复用现有 PATCH。`revalidateTag("featured-works")` 已在路由内，下架后首页缓存会自动失效。

**`src/components/admin/admin-works-board.tsx`**

- `getActionButtons` 给三种状态各补一个 `{ action: "force_takedown", label: "强制下架", variant: "danger" }`。
  - 在 PENDING 区域：与"通过投稿/拒绝投稿"并列。
  - 在 FEATURED 区域：作为唯一可用动作。
  - 在 TAKEDOWN_PENDING 区域：与"确认下架/拒绝下架"并列。
- 按钮样式：红色描边、红色文字，悬浮变深红填充。
- 新增 `confirmTakedownWork: SerializedAdminWork | null` 状态。点击"强制下架"先 `setConfirmTakedownWork(work)`，弹出确认 Modal。
- Modal 内容：作者邮箱、提示词截断到 80 字符、当前状态、缩略图；下方 textarea 复用 `draftNotes[work.id]` 作为下架理由（可选）；按钮：取消 / 确认下架（红色 + loading 态）。
- 确认后调用现有 `handleReview(work.id, "force_takedown")`，关闭弹窗。

### 错误处理

- 状态不允许时 `applyAdminWorkReview` 抛 `当前状态不允许执行该审核操作`，路由返回 409，前端展示在卡片底部错误区（已有）。
- 作品不存在时返回 404。

---

## 二、删除用户

### Schema 变更（带 migration）

`prisma/schema.prisma` 中给以下 7 个外键加 `onDelete: SetNull`。这些字段已经是 `String?` 可空，语义本应是 SetNull。

| 模型 | 字段 | 关系名 |
|---|---|---|
| `InviteCode` | `createdById` | `InviteCreatedBy` |
| `InviteCode` | `usedById` | `InviteUsedBy` |
| `InviteBatch` | `createdById` | `InviteBatchCreatedBy` |
| `RedeemCodeBatch` | `createdById` | `RedeemBatchCreatedBy` |
| `RedeemCode` | `createdById` | `RedeemCodeCreatedBy` |
| `GenerationJob` | `featuredById` | `FeaturedByAdmin` |
| `GenerationImage` | `reviewedById` | `ReviewedWorks` |

执行：`pnpm prisma migrate dev --name user-deletion-set-null`（或项目使用的等价命令），生成 `prisma/migrations/<timestamp>_user_deletion_set_null/migration.sql`。

预期 SQL 形如：

```sql
ALTER TABLE "InviteCode" DROP CONSTRAINT "InviteCode_createdById_fkey",
  ADD CONSTRAINT "InviteCode_createdById_fkey" FOREIGN KEY ("createdById")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- 重复 7 次
```

### 删除后的数据效果

**Cascade（直接随用户删除）：**

- `GenerationJob` → `GenerationImage`（job → image 是 Cascade）、`WorkLike`（image → like 是 Cascade）
- `Conversation`
- `CheckInRecord`
- `ApiKey`
- `SavedProviderConfig`
- `RedeemRedemption`
- `WorkLike`（user 关系 Cascade）

**SetNull（本次改 schema 后保留记录但清空创建/使用/审核者）：**

- `InviteCode.createdBy` / `InviteCode.usedBy`：邀请码本身保留，作者/使用者字段变 null
- `InviteBatch.createdBy`、`RedeemCodeBatch.createdBy`、`RedeemCode.createdBy`：批次和码本身保留
- `GenerationJob.featuredBy`：被该管理员精选的他人作品仍保留 featured 状态
- `GenerationImage.reviewedBy`：他人作品的审核历史保留

### API

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
    return jsonOk({ deleted: { id: user.id, email: user.email } });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
```

### UI

**`src/components/admin/user-admin-card.tsx`**

- 在操作列（与"设为管理员/取消管理员"同区）追加一个红色"删除用户"按钮：`<Trash2 />` 图标 + 文字。
- 当 `isCurrentAdmin === true` 时不渲染该按钮（第一道保险）。
- 点击后 `setConfirmingDelete(true)`，弹出确认 Modal。
- Modal 内容（与作品下架弹窗、生成记录删除弹窗风格统一）：
  - 标题：「删除用户」
  - 信息列表：邮箱、注册时间、生成次数、当前积分
  - 警告文案：「将永久删除该用户及其全部生成记录、对话、API Key、签到、兑换记录、点赞。操作不可恢复。」
  - 按钮：取消 / 确认删除（红色，loading 态展示 `Loader2` 自旋）
- 删除成功后 `router.refresh()` 重新渲染用户列表。

### 错误处理

- 自删 400；用户不存在 404；其余 db 异常统一 400 + `getErrorMessage`。
- 前端按钮在请求过程中 disabled；失败时把错误信息塞进弹窗内 `<Alert variant="error">`。

---

## 测试计划（手动）

### 作品强制下架

1. PENDING 作品 → 强制下架 → 状态变 PRIVATE，作者列表中可见，公开页消失。
2. FEATURED 作品 → 强制下架 → 公开页消失，`featuredAt` 清空。
3. TAKEDOWN_PENDING 作品 → 强制下架 → 与"确认下架"等效（PRIVATE）。
4. reviewNote 填写后查看 DB 中字段已写入。
5. 弹窗取消按钮不触发请求。

### 删除用户

1. 删除一个有生成记录、对话、API Key 的普通用户 → 全部级联清空。
2. 删除一个曾使用邀请码注册的用户 → InviteCode.usedBy 变 null，邀请码本身仍在。
3. 删除一个曾创建邀请码的管理员（非自己） → InviteCode.createdBy 变 null，邀请码本身仍在。
4. 删除一个曾审核过他人作品的管理员（非自己） → GenerationImage.reviewedBy 变 null，作品状态不变。
5. 尝试删自己 → 按钮不出现 + API 返回 400。
6. 弹窗取消按钮不触发请求。

---

## 影响范围与回归

- `applyAdminWorkReview` 已被 `/api/admin/works/[id]/review` 单点调用，扩展枚举不影响其他调用方。
- 用户删除路径全新，不影响现有 `[id]/credits`、`[id]/role` 路由。
- Schema 变更属"约束放宽"，对现有数据零损坏。生产环境上线前需运行迁移。
