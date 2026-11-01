# 执行与验证

1. [x] 恢复原诊断，确认官方 R2 API 兼容性与本地 / 线上版本。
2. [x] 保留两处已有改动，将 main 快进到 `64dad3c`。
3. [x] 准备共享 `probeVectors`，Node / Go 独立实现并运行定向测试。
4. [x] 更新 README 与 Canvas 契约，记录 R2 的认证 HEAD 证明及 S3 原有保护。
5. [x] 独立审查跨语言语义、认证 / 重定向 / 取消边界、原有 GC 与回执保护。
6. [x] 在无真实凭据、dotenv 隔离的环境运行完整非 DB Vitest、类型检查、lint、Go test / vet / build 和 Next 构建；定位并修复三个脚本的 Windows shebang 换行问题后重跑完整套件。
7. [x] 核对 diff、原有文件哈希与验证证据；交付源码修复和生产尚未变更的状态。

重点测试：Node canvas-storage / capability-response / readiness / assets；Go Canvas storage / runtime / readiness / GC；共享 endpoint vectors。真实 PostgreSQL / Docker / 浏览器 / 付费生成不由上述单测代替，未运行需明确说明。

用户已明确要求直接修复已诊断的问题。计划与执行范围没有新增产品决定；本轮自主完成本地可逆修复，不增加流程性确认。
