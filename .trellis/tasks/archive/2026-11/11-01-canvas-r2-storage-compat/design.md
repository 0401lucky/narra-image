# R2 存储探测修复设计

## 边界与流程

保持现有 `CanvasStorageAdapter` / `canvasGCStorage` 接口和 `unversioned` readiness DTO。先使用现有 location 规范化，再根据完整官方端点选择只读探测。

- 官方端点：`https://<32 位十六进制账户 ID>[.eu|.fedramp|.us].r2.cloudflarestorage.com`。规范化可处理大小写、根斜杠和默认 443；HTTP、自定义域名、其他端口、尾点和相似后缀不获得 R2 例外。
- R2：向确切 bucket 发出单次带签名 `HeadBucket`。只有实际原始 HTTP 200、无重定向、无版本 / delete-marker 响应头且请求未被取消时才通过。R2 平台本身不提供对象版本功能；成功探测补充认证和目标 bucket 的证据。
- 其他 S3：继续执行当前 `GetBucketVersioning` 的 16 KiB 原始 XML 校验。不得在 403 / 501 后退回 HEAD 或直接成功。

新规则仅作用于能力探测。PUT / DELETE 的非空或迟到版本回执、location / key 校验、七天保留和数据库 roots 全部保持原有语义。

## 跨语言一致性

在现有 `contracts/canvas/v1/scenarios/storage-location.json` 增加独立 `probeVectors`，不修改已有 28 个 location 身份向量。Node 与 Go 的真实 SDK 模拟传输测试都消费这组向量。官方域名判断属于各语言适配器内的私有实现，不增加环境配置或 API 字段。

## 修改分工

- Node：`src/lib/canvas/storage.ts`、对应 storage 单测和真实 SDK 响应单测。
- Go：`worker/internal/worker/canvas_gc_storage.go`、对应 storage 单测；必要时新增专门的 R2 测试文件。
- 主会话：共享场景、README、`.trellis/spec/operations/canvas-contracts.md`、任务与验证记录，集成检查。

## 验证与回滚

单测传输完全模拟，使用虚构账户 / bucket / credentials，不触及真实存储。覆盖认证失败、所有非 200 状态、取消 / 超时、不可证明的 SDK 回执、版本头、普通 S3 无版本及版本 / XML 反例。验证不得继承真实服务环境或加载仓库 dotenv。

无需迁移。源码回滚不会改变已有原图库存。后续部署仍须使用构建后的新镜像，显式设置 `CANVAS_ENABLED=true`，再验证 Node / Worker 的完整 readiness；本轮不进行生产切换。
