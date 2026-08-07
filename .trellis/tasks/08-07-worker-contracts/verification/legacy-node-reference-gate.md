# 旧 Node 生图实现引用闸门

审计日期：2026-08-07  
审计基线：`main@6e29a91` 加当前工作区变更

本文件是删除前的静态引用与行为覆盖检查，不授权本子任务删除任何文件。
最终删除由 `08-07-go-api-gateway` 独占，并须在独立变更中再次取得用户明确确认。

## 结论

- `src/lib/providers/generate-images.ts` 当前没有来自页面、API 路由、服务层、启动脚本或构建配置的生产调用者。
- `src/lib/providers/resolve-provider.ts` 的唯一非测试调用来自上述旧生图文件；因此它同样没有可达的生产入口。
- 仍存在两个真实测试消费者：
  - `generate-images-size.test.ts` 直接导入 `generateImages`，覆盖 11 个旧 SDK/Responses 兼容场景。
  - `provider-config.test.ts` 直接导入 `resolveGenerationProvider`，覆盖内置渠道与自填渠道校验。
- 两个旧文件仍被根 `tsconfig.json` 的 `**/*.ts` 包含规则纳入类型检查。Docker 构建阶段也会复制全仓并执行
  `pnpm build`，所以即使它们不进入运行时路由包，源码本身仍必须保持可编译。
- 当前 `.next` 产物中没有检出旧文件路径、导出符号或旧错误文案；这只是当前构建产物的辅助证据，删除前仍需执行一次干净构建。
- `openai` 包在仓库源码中的唯一直接导入位于 `generate-images.ts`。删除旧文件后才可评估移除该依赖和锁文件条目。
- **删除闸门当前关闭。本任务保留旧文件、旧测试和 `openai` 依赖，不执行删除。**

## 生产引用审计

### `generate-images.ts`

反向引用只有：

- `generate-images-size.test.ts`：测试态直接导入。
- Trellis、Claude 工作记录和迁移研究文档：仅作历史/规划说明，不会被应用加载。

没有发现以下生产引用：

- `src/app/**` 页面或 API 路由的静态 import、动态 import。
- `src/lib/**` 中除文件自身外的服务调用。
- `scripts/**`、`package.json`、`next.config.ts`、Dockerfile 或 Compose 的入口引用。
- 当前 `.next` 服务端/客户端构建产物中的模块路径或实现特征。

当前公开生成入口走数据库队列：

- Web 入口 `src/app/api/generate/route.ts` 创建 `workerManaged=true` 的任务。
- `/v1/images/generations`、`/v1/images/edits`、`/v1/responses`、`/v1/chat/completions`
  调用 `runExternalGeneration`，随后把任务开放给 Go Worker。

因此旧 `generateImages` 不是当前生产执行 owner；Go Worker 的同名 `generateImages` 是 Go 包内私有函数，
与 Node 文件不存在导入或构建关系。

### `resolve-provider.ts`

直接引用只有：

- `generate-images.ts`：旧实现内部选择内置/自填配置。
- `provider-config.test.ts`：测试内置渠道返回和自填渠道必填字段。
- `generate-images-size.test.ts`：只通过 `vi.mock` 替换该模块，以隔离旧生图测试。

没有发现其他生产、动态或构建入口。删除顺序必须是先解除/删除 `generate-images.ts`，再确认
`provider-config.test.ts` 的行为已迁移，最后才能删除 `resolve-provider.ts`。

## 测试引用与保留理由

### `generate-images-size.test.ts`

该文件名称虽然强调尺寸，实际还保留了以下旧 Node 行为证据：

1. 文生图高分辨率、格式、压缩和质量参数透传。
2. 默认参数不额外污染兼容渠道请求。
3. 图生图参数透传、多参考图和固定单图行为。
4. 从响应元数据或 PNG 数据提取实际尺寸，以及无法识别时返回空尺寸。
5. `gpt-5` 主线模型通过 Responses `image_generation` 工具生图。
6. 非流式 Responses 被拒绝后切换流式请求。
7. Anyrouter 的 Codex 兼容头、流式请求和事件收集。
8. Responses 官方最小请求形态。

共享契约测试目前已覆盖模型分流、渠道模型归属、状态/错误/媒体字段和密钥 fixture，
但不等价覆盖上述 OpenAI SDK 请求形态、SSE 兼容和尺寸嗅探。因此该测试暂不能随旧文件删除。

### `provider-config.test.ts`

保留理由：它仍是 `resolveGenerationProvider` 的唯一直接行为测试，证明：

- 内置模式原样返回站点配置。
- 自填模式同时要求 API Key 和 Base URL。

共享渠道契约已经覆盖“显式渠道不得静默换渠”和模型归属，但删除本测试前，新网关或共享 fixture
仍需明确覆盖自填渠道配置完整性和最终 provider mode 的序列化结果。

## 构建与依赖关系

- `tsconfig.json` 使用宽泛的 `**/*.ts`、`**/*.tsx` include；旧源码和旧测试都会被 `tsc --noEmit` 检查。
- `package.json` 没有旧生成器专用脚本；新的 `verify:worker-contracts:*` 也没有导入旧生成器测试，
  因而删除前必须单独运行本文件末尾的 legacy 测试命令。
- Docker builder 执行 `COPY . .` 和 `pnpm build`；runner 只复制 `.next`、依赖、Prisma 与脚本，
  不把 `src/` 作为独立运行目录复制。旧源码是否进入生产运行时取决于 Next 模块可达性，当前静态与产物搜索均为零。
- `openai` 的唯一源码 import 是 `generate-images.ts`；`generate-images-size.test.ts` 还会 mock 该模块。
  在旧源码和测试迁移完成前保留依赖，避免类型检查和测试解析失效。
- `.claude/**`、`.trellis/**` 和迁移研究中的路径属于历史证据；删除代码时应更新为“历史路径/已删除”，
  但它们不是运行时阻塞引用。

## 删除前置条件

只有以下条件全部满足，`08-07-go-api-gateway` 才能提交删除：

1. 新 Go `/v1` 网关或 Next 薄代理已替代所有公开图片生成入口，并通过灰度、回滚、JSON/SSE、取消和查询验收。
2. 全仓静态搜索确认生产 import、动态 import、脚本入口和构建配置引用为零；干净 `next build` 后的 `.next` 再次搜索为零。
3. `generate-images-size.test.ts` 的 11 个场景已逐项迁移到 Go、新网关或共享兼容测试，特别是：
   Responses 非流式/流式回退、Anyrouter 头与事件解析、多参考图、输出参数、结果持久化和尺寸探测。
4. `provider-config.test.ts` 的内置/自填渠道行为已有替代测试，且共享契约仍证明显式渠道不会静默换渠。
5. 回滚路径不再导入旧 Node 生成器；若生产仍需要代码回滚，应由发布工件/版本回退承担，而不是保留隐藏调用入口。
6. contract v1 的 `SUBMITTING`、`SUBMITTED`、`UNKNOWN` 活动任务已满足部署级回滚闸门，旧 finalizer 不会误退款。
7. 删除旧文件与迁移/删除旧测试放在单独可回滚变更中；随后再搜索 `openai`，确认无其他用途后才修改依赖和锁文件。
8. `tsc`、legacy 替代测试、Worker 契约测试、Go 测试、干净 Next 构建和 `git diff --check` 全部通过。
9. 用户对旧文件、旧测试以及可能的 `openai` 依赖删除范围再次明确确认。

任一条件不满足时，删除闸门立即失败；不得以“当前生产引用为零”代替行为迁移和回滚验证。

## 固定复查命令

```powershell
# 文件路径、静态 import、动态 import和历史引用
rg -n --hidden -g '!node_modules/**' -g '!.git/**' -g '!.next/**' -g '!coverage/**' `
  'generate-images|resolve-provider' .

# 导出符号和调用点
rg -n -w 'generateImages|resolveGenerationProvider|GeneratedImageRecord' src scripts prisma

# 生产路径反向引用；预期只有 generate-images.ts → resolve-provider.ts 的旧实现内部边
rg -n -F '@/lib/providers/generate-images' src/app src/lib scripts package.json Dockerfile next.config.ts
rg -n -F '@/lib/providers/resolve-provider' src/app src/lib scripts package.json Dockerfile next.config.ts

# 独占依赖检查
rg -n --hidden -g '!node_modules/**' -g '!.git/**' -g '!.next/**' -g '!pnpm-lock.yaml' `
  'from "openai"|from ''openai''|require\("openai"\)|import\("openai"\)' .

# 当前构建产物辅助检查；删除前应先执行干净构建
rg -l --hidden -g '!cache/**' -g '!trace*' `
  'providers/generate-images|resolveGenerationProvider|当前渠道未配置完成|generateImages' .next

pnpm exec tsc --noEmit
pnpm exec vitest run src/tests/unit/generate-images-size.test.ts src/tests/unit/provider-config.test.ts `
  --reporter=dot --testTimeout=15000 --hookTimeout=15000
pnpm verify:worker-contracts:ts
pnpm verify:worker-contracts:go
pnpm build
git diff --check
```

PowerShell 中 `rg` 没有匹配时返回退出码 `1`，对于“生产引用必须为零”和“.next 产物必须为零”属于预期结果，
应记录为零匹配而不是命令异常。
