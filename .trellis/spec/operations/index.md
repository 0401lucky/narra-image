# Operations Guidelines

> 发布、迁移与可观测部署的稳定契约。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Release Hardening](./release-hardening.md) | 发布拓扑、Prisma 迁移安全、healthz/readyz、环境契约与 CI/E2E 验证入口 | Active |

---

## 使用方式

- 修改启动脚本、migration 入口、探针、Compose、环境 manifest 或验证 wrapper 前，先读 [Release Hardening](./release-hardening.md)。
- 任何"普通启动自动修库/静默 resolve/自动 repair"的改动都违反该契约，禁止。
