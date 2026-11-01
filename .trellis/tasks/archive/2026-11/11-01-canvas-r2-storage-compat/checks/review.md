# R2 画布存储修复审查

基线：`64dad3c`。审查范围为 Node / Go 存储适配器、对应回归测试、共享端点场景、README 和 Canvas 契约说明。

## 已修正

- README 的部署说明原本只要求重建应用容器。补充 dedicated 拓扑必须同时重建应用与独立 Worker，避免只有 Node 读到新开关。
- README / PRD 的重定向表述原本可能被理解为普通 S3 也增加了新限制。现在明确 R2 专用探测拒绝重定向，普通 S3 保留既有 XML / 版本检查语义；没有为兼容修复扩大行为变化范围。

本次审查只修改上述说明，没有修改业务代码。

## 代码核查

- 两端只对规范化后的官方 HTTPS R2 账户端点选择 HEAD；23 个共享场景涵盖默认、eu / fedramp / us、规范化、伪装域名及非法 location。
- R2 需要真实 SDK 发出的带签名、确切 bucket 的只读请求，以及原始 HTTP 200 证明；伪 SDK 元数据、错误状态、版本相关响应头和取消均不被放行。
- Node 显式关闭 region redirect；Go 克隆专用探测 HTTP 客户端并拒绝 307 / 308。已核对当前 Go SDK v1.40.0 的 `Freeze` 与默认重定向实现，专用客户端未修改原媒体客户端。
- 普通 S3 没有 403 / 501 后回退 HEAD 或成功的分支，原有有界 XML 证明继续生效。
- PUT / DELETE、迟到版本回执隔离、location / 精确 key 验证、GC roots / 保留期限、计账及默认关闭的功能开关均未改动。
- 原有 28 个 location 身份向量逐项保持一致。两处用户原有文件的 SHA-256 与任务初始记录相同。

未发现尚未修复的本次代码缺陷。

## 验证证据与边界

- 已读取 Node 定向验证绿灯日志：`node-storage-20261101T160157.json` / `.stdout.log`，2 个文件、174 个用例通过；使用 Node 24.22.1 和模拟传输。
- 已读取 Go 定向验证日志：`go-targeted-20261101T080333315993Z.jsonl`，151 个测试 / 子测试通过，另有 1 个 package pass，0 fail；使用真实 SDK 与模拟 HTTP 传输。
- 审查后的 `git diff --check` 通过。文档修正不需要重复运行业务测试。
- 项目级 lint、typecheck、完整相关测试与构建由主会话统一执行并另行汇总，本审查不把尚未完成的检查记为通过。
- 未进行生产配置修改、真实对象读写删除、数据库验收或线上启用验证。

后续集成验证发现 5 个 CLI / fixture suite 因 Windows CRLF shebang 在 Vite SSR 转换阶段加载失败。已用真实转换器的 LF / CRLF 对照确认原因，并复核主会话的三条精确 `eol=lf` 修复。隔离 app 的原失败 5 个 suite / 110 个测试全部通过；没有更改存储业务逻辑或测试断言。详见 [shebang-runner-diagnosis.md](./shebang-runner-diagnosis.md)，完整 suite 结果由主会话另行汇总。
