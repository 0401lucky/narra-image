# Implementation Plan

## Order

- [x] 最终方案由用户确认后，`task.py start`。用户回复“可以开始吧”。
- [x] 派发 `trellis-implement`，只负责运行时环境契约、Node/Go loader、图片持久化分支、相关配置文档与测试；不修改生产服务。
- [x] 更新 manifest 后同步 loader、`.env.example`、README、Compose。Go storage loader 与运行 loader 都识别新开关。
- [x] 验证 production 显式数据库存图、默认拒绝、S3 兼容、完整图片 bytes、上游 URL 持久化、B64 元数据。
- [x] 派发 `trellis-check` 检查范围、规格与验证；修复发现的相关失败。
- [x] 主会话更新媒体规范与任务验收记录，准备具体上线/回滚变更。
- [x] 本地验证后取得最终授权：用户要求先推送 GitHub 再部署；真实生图由用户自行验收。
- [ ] 提交并推送本次修复，等待 GitHub CI 与对应 GHCR 镜像发布。
- [ ] 使用发布镜像 digest 部署 .22，确认 app/Worker 就绪与存图开关启用；不创建真实生图任务。

## Validation

最小充分验证：

```powershell
go -C worker test -count=1 -timeout=50s ./internal/worker/...
go -C worker vet ./...
go -C worker build ./...
pnpm exec vitest run src/tests/contracts/runtime-environment-contract.test.ts
pnpm verify:worker-contracts:ts
pnpm verify:worker-contracts:go
pnpm exec tsc --noEmit
pnpm lint
git diff --check
```

按实际改动执行相关 Node 单测及媒体契约验证；若 disposable PostgreSQL 的本地前置条件具备，执行 `pnpm verify:worker-contracts:db`，否则明确记录未执行原因。任何真实环境生成验证独立标注，不将健康探针当作存图通过。

## Risk and Ownership

- 保留用户已有 `.gitignore`、`.serena/project.yml` 改动。
- 实施与检查代理不拥有生产部署、数据库写入、任务规划及最终规范更新。
- 主要风险点为默认值/开关优先级、生产判定、runtime manifest 静态审计及 data URL 大小。
- 不调整应用模式来规避生产校验，不引入 schema repair 或历史任务重试。
