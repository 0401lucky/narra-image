# 图片清理与管理实施计划

前置：`11-12-image-storage-foundation` 对应接口和专项验证通过，父整体计划获准，本子任务已激活。先确认实际 C1 模型/错误命名，再实现本任务，不能按旧草稿类型复制业务。

## 顺序与责任

- [x] 复核 C1 的物理清单/引用/配额契约，定义 policy version、preview、maintenance job/item 和 token finalizer 的共享输入/输出。
- [x] 在首次允许删除之前补齐旧 GenerationImage 回填关联的 Canvas result/run 根；候选/claim 不能把空 ImageReference 当成无引用的充分条件，增加先引用后回填的真实 DB 回归。
- [x] 在 `worker/internal/worker/` 实现图片专用候选与单一删除执行器；协调现有 Canvas GC 的新 revision 接管，保持旧根、七天和 UNKNOWN 行为。
- [x] 加入 Worker 定时/手动任务领取、数据库 nextRunAt/lease/有界恢复；接入 C1 额度不足时的有界回收与重新预留。
- [x] 实现 `src/lib/storage/` 管理服务和 `/api/admin/storage/**`；管理员鉴权、集中 Zod schema、预览快照与请求幂等、策略 CAS 和分页/输出边界。
- [x] 新增 `src/app/admin/settings/storage/page.tsx` 与 `src/components/admin/` 存储管理组件，接入总览和子导航。
- [x] 更新共享图片 DTO、`prisma-mappers.ts`、作品/会话/画布与外部查询的已清理状态；保护非作者提示词白名单，不改视频 DTO。
- [x] 进行实际 UI 交互与后台并发/失败专项，由 trellis-check 核验，记录父验收映射并把 executor 接口交付 C3。

## 验证

- 管理 API/组件测试覆盖权限、加载、参数错误、策略变更、预览失效、确认幂等、取消和任务状态。
- 真临时文件/模拟 S3 加 disposable PostgreSQL 覆盖引用竞争、定时/手动/容量共用 owner、未知回执、失联恢复、重复 finalizer 和物理用量。
- 使用小额度夹具和确定创建时间核实最旧优先；包含精选/审核、保存/历史输入根、在用封面、七天内原图、视频/未知媒体负例。
- 运行 `pnpm verify:ci`、受影响 Worker/Canvas DB 契约及媒体专项；实际浏览器验证预览→确认→结果与历史占位。缺少基础设施的验证单独记录，不能以单测替代。

## 回滚与完成条件

关闭策略和停止领取可中止新清理，但不撤销已发出的文件删除。重启后按持久状态完成对账；代码回退保持新 schema/计量事实。C3 进入前必须证明源副本退休接口与逻辑删除不会互相冒充，且未登记历史对象仍不可自动清理。更新相关 specs，verification.md 逐项映射 C-A1–C-A7。
