# Research: baseline-validation

- Query: 记录本次 Go 化迁移审计的历史决策依据与当前可运行基线。
- Scope: internal
- Date: 2026-08-07

## 历史决策

- `trellis mem context 019e78ff-b7b4-7043-9ac7-ba78abefdab1` 显示，2026-05-30 的原始决策是先做第一阶段：Next.js 负责提交任务，Go Worker 负责消费生成任务，明确“不全量重写”。
- Git 提交 `a104dde` 首次加入 Go Worker；`5a7d516` 将外部 OpenAI 兼容 API 的模型调用移交 Worker，但认证、限流、参数解析、响应格式化仍保留在 Next.js。
- `docs/go-backend-migration-plan.md:3-9,23-60` 仍把当前状态描述为渐进迁移，并保留队列增强、Go Gateway、存储服务化、实时推送、观测和鉴权下沉等后续项。

## 当前验证结果

- `pnpm exec tsc --noEmit`：通过。
- `cd worker && go test -count=1 -timeout=50s ./...`：通过；两个命令入口无测试文件，`internal/worker` 测试通过。
- `pnpm exec vitest run src/tests/unit/external-generation-service.test.ts src/tests/unit/job-refund.test.ts src/tests/unit/image-url.test.ts --reporter=dot`：3 个文件、11 项测试通过。
- 首次并行执行完整前端测试与 Go 测试时均触及 60 秒外层超时；分开运行后 Go 全量测试通过。
- 单独运行 `pnpm test`：69 个测试文件中 68 个通过，301 项中 299 项通过；两个失败均是 `generator-studio-feedback.test.tsx` 在默认 5 秒内超时。
- 将同一测试文件的超时提高到 15 秒后，10 项全部通过，其中两项分别约 2.2 秒和 1.8 秒。因此当前证据更符合“全量并发运行下的测试时限/稳定性问题”，而不是已确认的自填 API 功能错误。

## 研究边界

- 未连接真实 PostgreSQL、Zeabur、S3/R2 或第三方模型渠道。
- 未执行 Docker 构建、生产数据库迁移或真实生成请求。
- 本阶段未修改产品代码；仅新增 Trellis 任务和研究文档。

