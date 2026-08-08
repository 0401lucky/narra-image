# Operations Guidelines

> 发布、迁移与可观测部署的稳定契约。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Release Hardening](./release-hardening.md) | 发布拓扑、Prisma 迁移安全、healthz/readyz、环境契约与 CI/E2E 验证入口 | Active |
| [Media Storage](./media-storage.md) | 生成结果媒体持久化策略、存储形态元数据、失败语义与历史回填 | Active |
| [Prompt Sync](./prompt-sync.md) | 提示词来源清单单一事实来源、三入口同步、并发/幂等与调度 | Active |

---

## 使用方式

- 修改启动脚本、migration 入口、探针、Compose、环境 manifest 或验证 wrapper 前，先读 [Release Hardening](./release-hardening.md)。
- 修改媒体写入路径、媒体表列或回填工具前，先读 [Media Storage](./media-storage.md)。
- 修改提示词来源清单、同步实现或调度前，先读 [Prompt Sync](./prompt-sync.md)。
- 任何"普通启动自动修库/静默 resolve/自动 repair"的改动都违反该契约，禁止。
