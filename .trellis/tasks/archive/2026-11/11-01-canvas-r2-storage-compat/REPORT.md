# R2 画布存储检查修复

已修复 Node 应用和 Go Worker 对 Cloudflare R2 的存储能力检查。基线为 `64dad3c`，修复提交为 `e34bd409664c797313924c3bc86815ab982b1f18`。本报告记录源码验证阶段的结果；2026-11-01 用户已授权后续推送并部署，生产启用另行验收。

## 修复行为

- 官方 HTTPS R2 账户端点（默认、eu、fedramp、us）使用带签名的 `HeadBucket`，只有确切 bucket 的原始 HTTP 200 才通过。
- R2 探测拒绝重定向、异常状态、版本相关响应头、取消、超时和未经原始响应验证的 SDK 回执。
- 普通 S3 继续严格验证 `GetBucketVersioning` 原始 XML。保留原图登记、location、精确 key、迟到版本回执隔离、GC roots、保留期限和计账规则。
- 两端使用同一组 23 个端点场景，原有 28 个 location 身份向量保持完整。
- 修复验证时发现的 Windows 测试加载问题：为三个被 Vitest 导入的 CLI / fixture 脚本固定 LF。脚本内容逐个与 Git 基线字节一致；未删除 shebang、测试或断言，未修改全局 Git 配置。

## 验证结果

验证使用 Node 24.22.1、Go 1.25.5、隔离源码与独立依赖。进程环境不继承真实业务凭据；dotenv 读取受到保护，存储测试使用模拟传输或本机测试服务。

| 检查 | 结果 |
|---|---|
| 完整 Vitest 非数据库套件 | **140 个文件、1,756 个用例通过** |
| Node 存储专项 | 2 个文件、174 个用例通过 |
| Go 全量测试 | 通过 |
| Go vet / build | 通过 |
| TypeScript | 通过 |
| 根目录 ESLint | 0 errors，9 条原有 warnings |
| Next.js 生产构建 | 通过，61 个静态页生成完成 |
| 独立代码审查、差异与源码哈希 | 通过 |

第一次完整测试中，1,646 个用例通过、5 个套件因 Vite 8.0.9 的 CRLF shebang 转换问题未加载。保持业务和断言不变，仅归一化三个脚本后，5 个套件的 110 个用例通过；随后重新运行完整套件取得上述 1,756 全通过结果。保留了前后独立回执，未合并局部计数冒充全量通过。

主要证据：

- [最终完整测试](./checks/test-20261101T082329474143Z.json)
- [源码审查](./checks/review.md)
- [Windows 加载问题诊断](./checks/shebang-runner-diagnosis.md)
- [换行归一化与 Git 基线一致性](./checks/shebang-normalization.json)

## 边界与后续部署

本机 Docker daemon 未运行，因此未执行真实 PostgreSQL / 容器双拓扑 E2E；未使用生产对象存储做写入或删除，也未发起付费生成。模拟传输和构建结果不等同于线上启用验收。

上线时需部署包含本次修复的新镜像，并显式设置 `CANVAS_ENABLED=true`。当前服务器使用 embedded Worker，重建应用容器即可让 app / Worker 读取同一开关；dedicated 部署需同时更新独立 Worker。完整 readiness 通过后，创作页才会显示“对话 / 画布”切换。

用户已有的 `.gitignore` 与 `.serena/project.yml` 修改通过 SHA-256 核对，未被覆盖。

自动审批检查拒绝了清理临时验证目录的操作，仅返回 `blocked by policy`，未给出更具体原因。`D:/code/_tmp/narra-canvas-r2-verify-gpjo1prx` 因此保留；不影响已完成的修复和验证。源码快照哈希与检查回执已另存本任务的 `checks/`。
