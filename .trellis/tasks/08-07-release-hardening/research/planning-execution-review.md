# 规划执行安全反审

## 初始结论

审查发现两个 BLOCKER和一个 WARNING：PostgreSQL 镜像声明 VOLUME，现有“无 named volume”仍会遗留匿名卷；baseline/repair 报告可被错库、过期或非连续列表重放；CI workflow 与 60 秒边界表述不明确。

## 证据

- 现有 runner 删除容器时未带 `--volumes`，PostgreSQL 容器可能留下匿名数据卷（`src/tests/integration/worker-contracts/postgres-runner.ts:451-467,808-817`）。
- 当前生产脚本按列表调用 `migrate resolve --applied`，正是需要被替换的高风险机制（`scripts/start-prod.mjs:329-339,393-397,466-506`）。
- Worker TS/Go wrapper 各自已有 57 秒外层截止，DB runner 另有 55 秒截止，不能再嵌入一个 60 秒总截止。
- Git 远端为 GitHub，但仓库没有 `.github/workflows`。

## 规划修订

- disposable PostgreSQL 强制 tmpfs；兜底清理带 `--volumes`，且结束时断言无归属容器/卷。
- baseline 仅连续 migration 前缀；inspect 绑定脱敏数据库身份、schema hash、migration checksums 与 digest，apply 前重新检查。
- repair 使用 migration ID allowlist，验证失败行/checksum/前后 schema 与 migration 状态。
- 每个单元测试进程独立约 57 秒；CI 总流程、build、migration、E2E 使用独立 timeout。
- GitHub Actions 变为必做，仅调用仓库 wrapper；E2E 实际构建两个镜像。

修订后无已知执行安全 BLOCKER，实施阶段必须先写失败 fixture 再修改生产入口。
