# 公开作品数据边界

## 1. 适用范围与触发条件

修改精选 DTO、图片详情页面、图片可用性或提示词复用入口时，必须先区分作者数据与公开访问数据。组件隐藏文字不能保护已经进入 HTML/RSC 或客户端 props 的字段。本契约不改变视频详情和后台权限规则。

## 2. 函数与边界

- `serializeFeaturedWork(work: FeaturedWorkRecord): SerializedFeaturedWork` 用于首页首屏及 `GET /api/works/featured`。
- `serializePublicWorkDetail(work: SerializedWork): SerializedPublicWorkDetail` 是不修改输入对象的公开投影，不负责授予访问权限。
- `WorkDetailPage` 先调用 `canViewWorkDetail({ isOwner, showcaseStatus })`，再按服务端确认的 `isOwner` 选择完整作者 DTO 或公开 DTO。
- `WorkDetailPanel` 使用 `{ isOwner: true; work: SerializedWork } | { isOwner: false; work: SerializedPublicWorkDetail }`，不能把公开对象断言回完整作者类型。

## 3. 数据契约

公开详情只允许以下 12 个字段：`id`、`url`、`availability`、`authorNickname`、`createdAt`、`featuredAt`、`model`、`size`、`showcaseStatus`、`showPromptPublic`、`prompt`、`negativePrompt`。

- 提示词权限沿用 `canShowWorkPrompt({ isOwner: false, ... })`。不允许公开时，正向和负向提示词均为 `null`；允许时保留原文。
- 无论提示词是否公开，非作者 DTO 均不包含 `ownerId`、`jobId`、生成元数据、`submittedAt`、`reviewNote`、`reviewedAt`、`reviewedById`、`reviewer`。新增作者/管理字段不会自动成为公开字段。
- 作者继续使用 `serializeWork`，后台继续使用 `serializeAdminWork`；不得全局剥离这些 serializer 的授权数据，也不得原地删除可能被复用对象的字段。
- 精选 DTO 显式携带 `showPromptPublic: boolean`。隐藏时服务端仍将 `prompt` 替换为说明文案；客户端不能用字符串非空或字符串不等于占位文案推断公开权限。
- 公共提示词入口只在权限严格等于 `true` 时开放。旧缓存缺少该字段按不公开处理；真实公开文本即使恰好等于旧占位说明，也不能仅凭文本拒绝它。
- `availability` 仅为 `available | cleaned | unavailable`：已纳管且 DELETED 映射 cleaned，其他不可读状态映射 unavailable，旧未纳管图片保持兼容。查询必须包含用于投影的媒体状态，不能从图片网络失败推断或把缺少关联投影的数据默认为可用。
- 清理后保留任务、提示词和计费事实；作者历史与详情显示“图片已清理”，禁用图片下载/作为参考复用，不继续渲染已删除图片。提示词公开权限仍独立判断；不可用状态不授予任何新数据权限。
- 本公开投影不加入物理存储路径、位置身份、删除任务或管理员例外；后台管理字段继续在独立管理 DTO 中传递。

## 4. 权限与错误矩阵

| 访问者 / 状态 | 访问结果 | 下发提示词 / 审核数据 |
| --- | --- | --- |
| 作者 / 任意现有展示状态 | 原详情及管理能力 | 完整授权 DTO |
| 非作者 / `FEATURED` / 提示词公开 | 公开详情 | 完整允许的正负提示词，无内部字段 |
| 非作者 / `FEATURED` / 提示词隐藏 | 公开详情 | 两类提示词为 `null`，无内部字段 |
| 非作者 / `PRIVATE`、`PENDING`、`TAKEDOWN_PENDING` | 404 | 不创建详情客户端 props |
| 管理员作为公共路由的非作者 | 与其他非作者相同 | 后台身份不是公共详情的访问例外 |
| 图片不存在 | 原有缺失/视频分支 | 不借本修复扩展视频行为 |
| 获准访问的作品 / `availability=cleaned` | 保留详情及清理占位，禁用图片下载/复用 | 继续原作者或公开提示词白名单，不附加物理清理信息 |

`notFound()` 是访问拒绝契约；Next 已开始流式输出时，HTTP 状态可能是 200，响应携带 `NEXT_HTTP_ERROR_FALLBACK;404` 和 `noindex`。检查必须同时记录传输状态和实际拒绝结果，不可为测试表面状态去扩大访问权限，也不可把 HTTP 200 当作有权获得详情数据。

## 5. Good / Base / Bad

- Good：公开访问后同一输入对象用于作者访问，作者提示词和管理字段仍完整；将来追加管理字段也不会泄露。
- Base：匿名浏览已精选且公开提示词的作品，详情内容正常，精选响应带明确公开标记。
- Bad：把完整 `SerializedWork` 传入客户端，只用 `showPromptPublic` 隐藏按钮；或展开完整对象后维护容易遗漏的删除名单。

## 6. 必需回归断言

- `work-detail-page-privacy.test.tsx`：等待真实异步页面，保留真实读取/序列化/权限代码，检查实际客户端 props 的精确键及独特敏感值；覆盖匿名、普通非作者、管理员非作者和作者的状态矩阵。
- `public-work-detail-serialization.test.ts`：冻结带未来管理字段的输入，检查纯投影和完整允许键；公开投影不得污染作者/后台结果。
- `featured-public-contract.test.tsx`、`prisma-mappers.test.ts`：Home 首屏和分页接口合同一致，隐藏原文不出站，显式权限真/假及与占位说明相同的公开原文均覆盖。
- `work-detail-panel.test.tsx`：作者投稿/撤回等管理能力及允许公开提示词保留。
- 媒体状态回归覆盖已清理占位、禁用下载/复用、任务终态/提示词保留，以及旧未纳管/缓存兼容；公开页面 props 的精确白名单只增加 `availability`，不能展开完整媒体关联。
- 浏览器/Next 验证必须额外检查初次 HTML、导航及刷新 RSC 的原始响应敏感值，而不只检查可见 DOM。隔离模拟 DB 的结果不等于真实 DB/账户服务 E2E。

## 7. 错误与正确示例

```tsx
// Wrong: hidden UI still receives private prompt and review fields.
<WorkDetailPanel isOwner={false} work={work} detailUrl={detailUrl} />

// Correct: run the existing access gate first, then project before the boundary.
<WorkDetailPanel
  isOwner={false}
  work={serializePublicWorkDetail(work)}
  detailUrl={detailUrl}
/>
```

本契约有修复前失败/修复后通过的页面 props 回归，以及真实 Next 加隔离模拟 DB 的原始传输验证；这两层证据均不能冒充真实账户/数据库服务 E2E。
