# 图片存储基础设计

本子任务采用父任务 `../11-12-local-media-retention/design.md` 第 1–5、8 节的契约；本文件补充拥有的接入面，不能另行选择一套清单、锁或计费语义。

## 数据与调用边界

- 建立 ImageAsset、ImageStorageLocation、ImageObject、ImageReference、额度/预留模型及 additive migration。物理记录独立于业务 cascade，稳定逻辑 ID 支持后续多副本迁移。
- 所有写入先登记/预留再 IO；输出 count 为规范化后 1–4，每槽最大 50MiB。b64 解码前后、远端读取、Responses 聚合、Go 内部任务入口均要证明此边界，不能只校验 Node 请求。
- Web、外部 legacy、gateway 在现有扣费事务前取得输出凭证并绑定内部身份；Worker handoff 前复核，存储层精确长度 guard 是最后屏障。Canvas 重放继续早于余额和当前容量判断。
- 保持 v0/v1 的退款差异；新增 pre-handoff 容量错误作为共享确定失败，不落入默认 UNKNOWN 字符串分类；handoff 后保存失败保留 RESULT_PERSIST_FAILED。
- 保存画布、提交输入、精选/审核和封面设置与资产状态共同加锁建立引用。额度事务与原 canvas/run/owner 锁保持明确顺序，IO 不进入长事务。

## 文件与读取

Node/Go 对 LOCAL 和 S3 提供一致的图片 put/read/verify 接口；LOCAL 不覆盖已有 key、检查 root/链接边界、保留未知写入清单。对外稳定不可猜 HTTP(S) URL，内部读取已登记对象，第三方 URL 继续走原远端限制。覆盖网页、Next optimizer、代理下载、图生图与外部 b64 转换。

## Canvas 与部署

- 新增明确来源 provider、逻辑媒体关联和物理副本，S3-only 列按判别条件可空；CHECK 显式处理 NULL，不可变比较使用 IS DISTINCT FROM。
- `CanvasImportAsset` 继续承载 ID/上传身份/逻辑状态/账户额度；其原始 tuple 不可变。全站只从物理清单与未消费预留计量，不再加一遍 Canvas 字节数。
- 拆分 scene/run wire v1 与存储/GC revision。更新严格能力 DTO、有效 schema 指纹和旧 mutation 栅栏；仅加表不算隔离旧 Worker。
- 同卷身份、权限和持久化由两种拓扑共同验证；旧 Worker drain 是切换前置。本地 ready 探针不请求尚未启动的 Next route。

## 下游接口

向 C2 提供受管理清单、可用性与引用查询、额度失败结果、物理 claim/finalize 的共享类型；向 C3 提供副本注册/校验/读取指针和精确旧 URL 别名能力。批量删除、历史盘点和迁移的运行入口尚不在此阶段启用。
