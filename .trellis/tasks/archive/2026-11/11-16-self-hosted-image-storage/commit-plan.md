# Proposed Local Commit

最终检查已通过；用户已授权先推送 GitHub 再部署，创建并推送一个工作提交：

`fix(storage): allow explicit database image persistence`

包含文件：

- `.env.example`
- `README.md`
- `contracts/runtime/v1/environment.json`
- `docker-compose.yml`
- `src/lib/env.ts`
- `src/lib/storage/persist-generated-image.ts`
- `src/tests/contracts/runtime-environment-contract.test.ts`
- `src/tests/unit/persist-generated-image.test.ts`
- `worker/internal/worker/config.go`
- `worker/internal/worker/config_test.go`
- `worker/internal/worker/storage.go`
- `worker/internal/worker/storage_test.go`
- `.trellis/spec/operations/media-storage.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/tasks/11-16-self-hosted-image-storage/` 中的规划、规格上下文、审阅记录、部署工具与验收回执；排除 task-local ignore 管理的 runtime/二进制/archive 等生成内容。

用户原有 `.gitignore`、`.serena/project.yml` 改动不属于本次提交。将工作提交推送到 `origin/main`，使用仓库既有 CI/发布流水线发布镜像，不手工绕过发布门禁。

工作提交完成且任务验收完成后，按 Trellis 分别归档本任务与记录 journal。其他任务保持原状态。
