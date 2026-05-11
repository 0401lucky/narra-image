## 项目上下文摘要（Turnstile + Admin 系统设置归类）
生成时间：2026-05-02

### 1. 相似实现分析

- **OAuthProvider 配置**: `prisma/schema.prisma:90-99` + `src/components/admin/oauth-provider-manager.tsx`
  - 模式：单例多记录（type @unique）、客户端 fetch + 表单
  - 可复用：UI 卡片+toggle+保存 的交互模板
- **BenefitConfig 单例**: `prisma/schema.prisma:81-88`
  - 模式：`scope String @unique @default("default")` 单例配置
  - Turnstile 表沿用此模式
- **ChannelManager**: `src/components/admin/channel-manager.tsx`（已写完，缺 page.tsx 入口）
  - 直接 `<ChannelManager initialChannels={...} />` 嵌入即可

### 2. 项目约定

- **API 风格**: `requireAdminRecord()` → `parseJsonBody` + `zod.parse` → `jsonOk`/`jsonError`
- **加密**: `encryptProviderSecret(value, env.AUTH_SECRET)`，存为 `xxxEncrypted` 字段
- **路由**: Next.js 16 app router；管理页在 `/admin/*`；API 在 `/api/admin/*`
- **导航**: `admin-nav.tsx` 是 pills（rounded-full px-4 py-2）+ currentPath 高亮
- **页面骨架**: `requireAdminRecord` → `redirect('/login')` → `<SiteHeader>` + `<AdminNav currentPath>` + 内容

### 3. 可复用组件清单

- `src/lib/providers/provider-secret.ts`: AES-GCM 对称加解密
- `src/lib/server/http.ts`: parseJsonBody / jsonOk / jsonError / getErrorMessage
- `src/lib/server/current-user.ts`: requireAdminRecord
- `src/lib/validators.ts`: zod schemas（loginSchema/registerSchema 需扩展）
- `src/lib/env.ts`: getEnv()
- `src/components/admin/channel-manager.tsx`: 渠道 CRUD UI
- `src/components/admin/admin-nav.tsx`: 顶部 pills 导航

### 4. 测试策略

- Vitest + Testing Library；测试路径 `*.spec.ts(x)` / `*.test.ts(x)`
- 本任务以 lint + tsc --noEmit 为主（破坏性迁移测试代价大，风险低）

### 5. 依赖和集成点

- **登录**: `/api/auth/login` (route.ts) ← `auth-form.tsx` 表单
- **注册**: `/api/auth/register` (route.ts) ← `auth-form.tsx` 表单
- **邀请码兑领取**: `/api/invites/batches/[id]/claim/route.ts` ← `invite-claim-board.tsx`
- **Turnstile 数据流**: 客户端 widget → token → API body → server siteverify

### 6. 技术选型

- **Cloudflare Turnstile**：免费、无次数上限、不要求托管在 CF；浏览器端引脚本 `https://challenges.cloudflare.com/turnstile/v0/api.js`，服务端 POST `https://challenges.cloudflare.com/turnstile/v0/siteverify` 校验 token
- **不引入 NPM 包**（如 `@marsidev/react-turnstile`）：原生脚本就够用，少一层依赖

### 7. 关键风险点

- **siteverify 网络故障**：CF 侧短暂不可达时不能因此把所有登录请求拒了——需要短超时 + 失败时按 fail-open 还是 fail-close？决定：fail-close（拒绝），但日志记录原因
- **secret 解密失败**：fallback 为"该 scope 校验失效"日志告警，不阻塞登录
- **Token 一次性**：siteverify 校验后 token 失效；前端必须在每次提交前 reset widget
- **dev 环境**：CF 提供测试 sitekey `1x00000000000000000000AA`（总是通过），文档里标注

### 8. 范围确认（已与用户对齐）

| 选项 | 决定 |
|---|---|
| /admin/oauth 旧路径 | 直接 404（破坏性，无重定向） |
| /api/create 默认保护 | 关（仅留开关，登录/注册/邀请码兑换默认开） |
| channels 页面 | 顺手做（API/组件齐全，只缺 page.tsx） |
