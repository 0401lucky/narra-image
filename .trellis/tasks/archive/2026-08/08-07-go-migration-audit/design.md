# 渐进深化 Go 化迁移设计

## 1. 设计目标

在不全量重写 Next.js 后端的前提下，完成生成相关性能关键链路的 Go 化闭环，并补齐队列、存储、迁移、部署、观测和回滚能力。

本设计优先解决真实风险：跨运行时行为漂移、生产 migration 不可审计、Worker 健康误报、媒体持久化不稳定和双轨实现长期分叉。页面流畅度是否改善必须以实际指标验证，不能把“改成 Go”本身当作验收结果。

## 2. 目标架构与边界

```text
浏览器 / 管理后台
        │
        ▼
Next.js 页面 + BFF + 会话鉴权 + 管理域
        │
        ├── Web 生成入队
        ├── 外部 /v1 薄代理（网关切换前/灰度期）
        └── 非性能关键业务 API
        │
        ▼
PostgreSQL：任务、计费、用户、媒体元数据、同步状态的事实来源
        ▲
        │
Go Worker / 内部生成网关
        ├── 任务领取、重试、租约、退款
        ├── 图片/视频上游适配
        ├── 媒体持久化
        ├── 提示词同步与调度
        └── readyz / metrics / 结构化日志
```

### Next.js 保留职责

- React/Next 页面渲染与用户交互。
- 浏览器会话、OAuth、Turnstile、邀请码、用户资料和管理后台。
- Web BFF 与非性能关键 CRUD。
- 迁移灰度期的 `/v1` 入口代理和回滚开关。

### Go 深化职责

- 生成任务的模型/渠道校验、领取、执行、重试、租约、终态和退款协作。
- 图片/视频持久化、媒体探测和上游错误归一化。
- 外部 OpenAI 兼容生成协议的内部网关实现。
- 提示词远端抓取、解析、入库、调度和失败恢复。
- Worker/gateway 就绪、指标、日志和 schema 兼容检查。

### PostgreSQL 职责

- 继续作为跨 Node/Go 的唯一业务事实来源。
- 所有 schema 变化先 additive，再回填/双读，最后才允许清理旧字段或旧路径。
- 不把数据库行队列误当作无需运维的消息系统；领取、重试、积压和清理均需显式契约。

## 3. 跨运行时契约

建立语言无关的版本化契约与测试向量，例如 `contracts/generation/v1/`。该目录只描述稳定字段、状态、错误分类和输入输出样例，TypeScript 与 Go 测试共同消费；不复制两份独立常量清单。

### 任务状态

```text
PENDING → PROCESSING → SUCCEEDED
                    └→ FAILED
          └→ PENDING（仅可重试错误，带 nextAttemptAt）
PENDING → FAILED/CANCELLED（仅在尚未提交上游时）
```

- 如果现有 Prisma 枚举无法安全加入 `CANCELLED`，第一阶段可继续用 `FAILED` + 稳定错误码表达取消；子任务设计时再决定是否增加枚举。
- 积分只在终态失败/允许取消时退款一次；重试过程中不得重复退款或重复扣费。
- 请求连接中断或外部 API 等待超时，不自动取消已经 handoff 的任务；客户端通过 generation 查询获取终态。

### 渠道与模型

- Next 入队前解析并持久化确切的 `providerChannelId` 与规范化模型。
- 显式选择的渠道失效、停用或不支持模型时必须失败，不得静默切换渠道。
- 只有未指定渠道的策略请求才允许按明确规则选择默认渠道，并将选择结果持久化后再开放 Worker。
- TypeScript 与 Go 使用相同模型识别测试向量，覆盖前缀、版本后缀和供应商命名空间。

### 错误与重试

- 可重试：连接超时、临时 DNS/网络错误、HTTP 429、明确可重试的 5xx。
- 不可重试：参数、鉴权、策略拒绝、SSRF、媒体格式/大小、模型/渠道不兼容。
- `WORKER_MAX_ATTEMPTS` 必须真正控制重试次数；稳定 `Idempotency-Key` 在同一业务任务的重试间保持一致，防止上游重复计费。
- 记录稳定错误码、最后错误、尝试次数和下一次可领取时间；用户文案与运维细节分离。

### 上游提交不确定性

- 在可能提交上游之前记录 attempt/handoff 记录；至少持久化 `attemptCount`、`upstreamSubmittedAt`、`providerRequestId`、错误码和结果不确定标记。
- 只有能证明尚未提交上游的错误才自动回到 `PENDING`；“上游可能已接受但本地未写回”的任务不得盲目重试或退款，应进入可查询/人工协调的终态。
- `Idempotency-Key` 只是降低重复风险的保护，不替代 attempt ledger，也不假设所有第三方渠道都提供恰好一次语义。

### 媒体

- 生产环境强制配置可长期访问的 S3/R2 或等价对象存储。
- data URL 只允许显式开发/测试 fallback；生产不得把大 base64 作为正常数据库存储方案。
- 视频结果必须转存或验证为长期可访问地址；不能默认信任临时上游 URL。
- 历史 data URL/上游 URL 保持可读，并提供可选回填流程；迁移不得破坏已有作品。

## 4. 生成网关迁移形态

Zeabur 当前以单容器、单公开端口为主，因此第一步不强制直接暴露第二个 Go 端口：

1. Go 在内网/loopback 提供版本化生成网关。
2. Next `/v1` 入口变成薄代理，并通过开关选择旧 Next 实现或 Go 网关。
3. 支持 shadow/对照模式时，只比较无副作用的解析、认证和响应契约；不得双重提交真实生成任务。
4. 当平台具备稳定的多端口/反向代理能力后，再评估把 `/v1` 直接路由至 Go；这不是当前任务的强制完成条件。

网关迁移仅覆盖生成相关入口：images generations、images edits、responses、chat completions 和 generation 查询。页面/BFF、管理和用户域继续保留在 Next。

### 认证与计费边界

- 当前渐进阶段由 Next 完成 API Key 查验、限流、SSRF/输入校验、积分扣减和外层错误映射。
- Next 将已认证、已规范化、已计费的内部请求 envelope 转给 Go；Go 对 envelope 做签名/版本/必填字段的防御性校验，并负责执行协议与结果格式化。
- 只有未来另立“用户域/公开 Go ingress”任务并完成安全评审后，才考虑把 API Key、限流和扣费直接下沉到 Go；本父任务不默认授权这一步。

## 5. 提示词同步单一事实来源

- Go 成为远端抓取、解析和入库的权威实现。
- `PromptSource` 数据表继续保存来源配置和状态；Node 管理后台只读取状态、修改配置和提交同步请求，不再维护另一套解析器。
- 手动 CLI、后台触发和定时任务调用同一 Go package/任务机制，复用幂等键、锁、超时和错误记录。
- 默认来源清单只保留一个权威位置；优先存入数据库或语言无关 manifest，避免 TS/Go 常量双份维护。

## 6. 部署与迁移设计

### 拓扑

- **生产主路径**：Zeabur embedded，Node supervisor 启动迁移检查、Go Worker/gateway 和 Next。
- **辅助路径**：dedicated Compose，用于隔离联调、故障演练和未来独立扩缩容。
- 两种模式必须通过显式配置互斥，并记录运行实例/worker identity，避免误启动两套消费者。

### 数据库发布

- 正常生产升级只运行 `prisma migrate deploy` 和 schema 兼容验证。
- 空库也必须通过完整 migrations 构建，不再以 `db push + resolve all` 作为默认路径。
- 历史数据库接管、失败 migration 修复和 baseline resolve 变成显式运维命令，不在普通启动中静默执行。
- 涉及删列、删表、批量回填或数据重写前必须单独确认并先备份；本父任务不授权直接操作生产数据库。

### 就绪与观测

- `healthz` 仅表达进程存活；`readyz` 验证数据库、关键 schema、队列消费能力和必要依赖。
- 指标采用稳定、可采集格式；至少覆盖 PENDING/PROCESSING 数量、排队/模型/存储耗时、成功率、错误分类、重试次数和 provider request ID。
- 指标默认绑定 loopback/内网或要求鉴权，不能把内部队列信息直接暴露公网。

## 7. 兼容、灰度与回滚

- 所有切换使用显式功能开关，默认先保持现状；新路径通过测试和隔离环境后再灰度。
- schema 先新增字段/索引，不在同一发布中删除旧字段；至少经过一个稳定观察期后再清理。
- Go 网关切换失败时可立即回到 Next `/v1` 路径；任务和结果仍使用同一 PostgreSQL 数据模型。
- 提示词同步切换前保留旧 Node 入口但禁止双写；Go 路径稳定后再删除旧 parser/service。
- 旧 Node 生成器仅在生产引用、回滚需求和测试依赖均为零后删除。

## 8. 子任务边界与依赖

```text
[worker-contracts] ───────────────┐
                                  ├──> [media-sync-boundary] ──┐
[release-hardening: baseline] ────┘                            ├──> [go-api-gateway]
       └─ readiness/deploy 集成等待 contracts 冻结 ────────────┘
```

- `worker-contracts` 先冻结任务/错误/媒体字段契约并拥有 fixtures；`release-hardening` 可先做 CI/migration harness，但其 readyz、部署和健康入口只能在 contracts 版本冻结后接入。
- `media-sync-boundary` 分为媒体阶段和提示词阶段；网关只依赖媒体 URL/响应契约，不依赖提示词调度完成。
- `go-api-gateway` 必须最后切换；其前置是任务契约、发布回滚和媒体响应均稳定。

## 9. 主要权衡

- 保留 Next.js 会继续存在两种运行时，但避免低价值的全量重写，并让 Go 集中承担并发、长任务和基础设施职责。
- 使用 PostgreSQL 行队列降低新增基础设施成本，但需要认真补齐公平性、重试和观测；若真实负载证明不足，再另立消息队列迁移任务。
- 内部 Go 网关 + Next 薄代理不能完全移除 Node ingress，但能先统一生成协议实现并保留 Zeabur 单端口兼容；API Key/计费仍由 Next 负责，避免范围膨胀。

## 10. 明确不做

- 不迁移 OAuth、Turnstile、邀请码、用户资料、管理后台和页面渲染。
- 不因追求“全 Go”引入 Redis、Kafka、Kubernetes 等未经负载证据要求的新基础设施。
- 不自动部署生产、不删除生产数据、不执行不可逆数据库操作。
