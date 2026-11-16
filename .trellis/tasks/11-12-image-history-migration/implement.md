# 历史图片与迁移实施计划

前置：C1 `11-12-image-storage-foundation`、C2 `11-12-image-retention-management` 的依赖验收通过，父计划获准，本子任务已激活。读取父设计与本任务 H1–H7，复用已实现存储/清理契约。

## 顺序与责任

- [x] 确认前两项最终模型/API 名称与 state/lease 不变量；编排器只调用它们，不能直接绕过 gate 执行 Put/Delete。
- [x] 在 `worker/cmd/` 与 `worker/internal/worker/` 增加图片盘点/迁移运维入口，参考既有 backfill 的 dry-run/limit 风格但不误用其 NULL-only/S3-target 语义。
- [x] 实现稳定分页的历史业务扫描、显式 location 绑定、大小/摘要核实、精确 URL 别名和受管理输入/展示引用补齐；原始业务快照和 S3 tuple 不变。
- [x] 实现迁移状态/游标、目标实际字节预留、复制校验、读取位置切换和可恢复重入；处理容量不足、失败、未知状态和正在使用的源。
- [x] 接入显式 source-retirement 选项，复用 C2 executor/token/finalizer；默认保留源，所有双份物理占用如实计量。
- [x] 收敛 README、公开环境示例、Compose/镜像 overlay、embedded 启动、卷准备、盘点/启用/迁移/回滚操作说明及 rollback preflight。
- [x] 在 disposable PostgreSQL、临时卷和模拟 S3 上完成旧数据迁移与故障竞争矩阵，最终运行两种部署拓扑 E2E。
- [x] trellis-check 全范围复核；主会话将父 A1–A10 与 H-A1–H-A6 证据对应，更新 specs。
- [ ] 按父任务的具体提交计划取得一次确认后提交/归档，不提前标记 Git 收尾完成。

## 验证顺序

先验证盘点分类、重复执行、dry-run 零写入、源身份不明/视频排除和精确 URL 别名；再验证复制校验/断点、双份额度、目标失败保留源、源退休失败保留计量、UNKNOWN 与引用/删除竞争。

最后运行当前源码的 `pnpm verify:ci`、`pnpm verify:worker-contracts:db`、`pnpm verify:canvas-contracts:db`、`pnpm verify:gateway:db`、隔离的 `pnpm verify:migrations` 和 `pnpm verify:e2e`。拓扑测试使用 owner 标识的隔离卷/模拟存储，核实重建前后真实文件内容；不能以假 HTTP 响应代替持久卷证明。

## 完成与回滚门禁

- 默认命令不执行真实迁移/源删除；计划中的生产步骤与已完成的本地验证分开记录。
- 切换读取位置后原源仍保留才可回退；已删除图片不承诺恢复。未决写入/删除/迁移和新 revision 都进入 rollback preflight。
- 完整交付需要统计范围诚实、保护正确、额度含预留、清理可恢复、旧画布继续可读、视频排除及部署证据齐全；只跑通复制命令不算父任务完成。
- 更新 verification.md、父级验收汇总和相关存储/Canvas/发布/frontend specs 后，才进入父任务最终收尾。
