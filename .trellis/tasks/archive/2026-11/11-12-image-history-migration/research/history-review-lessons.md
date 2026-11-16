# 历史纳管复核中的约束与防回归

2026-11-16；源码/真实数据库与浏览器门禁已通过。完整部署结论以 `../verification.md` 的最终回执为准。

## 历史事实与新写入必须区分

历史源没有本次 PUT，也没有本次 reservation。用新写入入口伪造它，会遗漏已经发生的物理占用，或把未知状态误转为 READY。`OBSERVED` 保存不可变读取证据、真实长度/hash、原 URL 和明确 location；超限事实照实登记，后续 COPY 仍经过原 quota 准入。旧 confirmed/versioned WRITE 可按具体版本读取，不因此允许无版本迁移或删除。

未知/版本异常/长 URL 不能因为元数据看起来齐全就参与 COPY 或释放 adoption hold。根 URL 超过别名上限时，保留原事实与真实计量，阻断无法证明所有消费者可读的退休路径。相同物理对象的复用也必须重新核验当前候选的来源 URL，不能借已有 READY 行绕过归属证明。

防回归：当前27项 history DB 用例包含新建/复用、真实超额、版本/UNKNOWN、长URL与中断恢复；完整/增量各87项通过。对应契约已写入 `image-storage.md` §9。

## 根的建立时机和读取兼容性

历史输入写入时即登记永久引用，即使当时尚无图片别名；后来纳管建立 alias 必须回接这些引用。新 token 输入允许的 host 大小写/default-port/当前站点基址拼写，在同一 reference epoch 内登记精确原字符串，再提交 job/cover；GET 不产生 alias 副作用。Go gateway 并发重放在 epoch 后重读 winner，不能用第二个请求的输入替换它。

内部 LOCAL 读回成功只证明副本正确，不能证明已部署读者能读取 canonical URL。显式退休再执行真实发布URL GET并核对同一payload；应用停站时保持源，恢复后同job续跑。Canvas 纳管需要实际排空全部旧执行者并等待租约自然到期，不能改数据库时间冒充排空。旧 backfill 没有同一写入ledger grant，必须先停止；仅补 `mediaAssetId IS NULL` 不意味着支持迁移与旧写者并发。

防回归：当前实际 Gateway/Worker DB包含精确alias、永久根、并发重放、陈旧backfill扫描/获取后绑定；Node/Go reader与CLI回归保持默认无写入、未知不释放。部署场景必须单独验证真实停止/恢复与公开读取，不能用单测替代。

实际首轮完整部署在重启后的Canvas源退休处暴露测试前置遗漏：managed写入开关已开，但数据库清理策略仍默认关闭。C2按契约拒绝`IMAGE_POLICY_DISABLED`，未删源/减量。补齐的测试先核对真实公开读者通过与策略错误码、源保留和零PUT/DELETE，再调用带expectedVersion的`image_update_storage_policy`启用显式维护；定时和容量自动清理继续关闭。源退休复用同一job。CLI进度日志保留有界原始安全错误码/读者状态，避免只见durable归类后的STORAGE_UNAVAILABLE。

随后新增策略测试自身又暴露DTO错误：消费者和mock都把内部ApplyReport当作公开CLI输出，导致2150项CI通过而实际读取`items`得到undefined。真实`historyCommandResult`包含顶层schemaVersion/dryRun/code/status和嵌套`progress.items`。修复直接对照命令类型/写入代码，正例包含真实外壳，策略helper只接受正确位置，诊断使用顶层code与嵌套进度；不增加兼容错误flat形状的fallback。修复后的两套57项、全局types/lint已通过；`20261115T184531-history-integrated-e2e-765657` 的完整11场景随后通过，两种图片拓扑实际验证默认策略拒绝、正式启用及同任务恢复。这类边界测试应从真实序列化输出结构取证，不能让实现与测试夹具共同发明协议；契约已补入operations image-storage §9及frontend quality-guidelines。

## 完整依赖与客户端缓存

Canvas关闭只是业务开关，图片清理/历史工具仍依赖Canvas根、GC租约与原图记账。media schema gate需校验完整依赖函数/表/触发器/枚举；当前真实catalogue含media820/Canvas201项，真实函数体与枚举漂移必须拒绝。

图片已经迁移但availability仍为available，前端仍需吸收同ID的新token URL。按ID窄合并媒体URL/可用性，已打开预览读取当前行；保留本地分页、选择、点赞和清理状态单调性。不要把server props整批覆盖成UI状态，也不要以同availability忽略新地址。

防回归：当前2146项全量包含作品/管理/首页挂载后URL更新、旧终态抑制、prompt隐私和缓存收敛；最终浏览器真实删除/重放/占位通过。规范见frontend state-management/homepage-interactions及operations image-storage。

## 验证环境与失败证据

本次区分了三种实际现象：Docker内下载TLS ECONNRESET、WSL整体退出导致EOF、task设置768MiB V8堆后TypeScript的明确heap exhaustion。前两者不能互相推定为应用OOM；降低worker/heap并不等于修复程序。

已存在依赖缓存可以复用，但必须核对版本、lock输入及运行配置。为避开本机大目录overlay复制，任务构建变体让builder/runner继承经核实deps；runner重新生成当前Prisma Client后，与完整构建的全部55,432个依赖条目比较路径/type/内容/mode/uid/gid/字面symlink。完整构建、类型检查和全部11部署场景仍需实际运行；不能把生成Dockerfile变体写成原Dockerfile原样构建。

Docker整体退出后的清理是独立恢复步骤：核对原daemon与具体owner/ID/name，再删除本轮资源；原非零回执保持。桌面控制应用需正常Windows profile，验证子进程仍使用合成HOME/空Docker配置/deny-env。只操作已确认由本任务创建的恢复进程，后台启动隐藏窗口，避免后代继承输出管道拖住截止。

这些本机措施保存在任务helper/validation记录；不把某台机器的内存参数固化为生产要求。没有真实R2/生产迁移或用户数据操作。

## 提交候选的原字节与异步断言

普通 `git diff --check` 不包含未暂存新文件，C1未发布SQL的一个EOF空行因此在前轮未被检出。修正只移除最后一个LF，13份函数定义/全部SQL前缀不变，但原文件checksum已改变，必须同步两份manifest并重验；不能将旧回执标为新字节。schema body单测会规范化CRLF，migration-safety/Prisma却核对原文件字节。全部shared链精确固定LF后，通过Git实际checkout filter及未匹配CRLF负对照验证规则，已发布SQL不修改。规范已补入image-storage、release-hardening和quality-guidelines。

新快照的首个CI在ESLint native Zone allocation OOM退出134；默认Node仅在当前校验进程降低至384MiB后，types/lint通过。接着全量2150项有一处旧首页断言失败：manual消息和完整textarea已提交，但测试在聚焦/选择的passive effect完成前同步断言焦点。`use-prompt-clipboard`的异步反馈与GalleryCard effect是两个边界。只把现有focus/selection断言放入awaited waitFor，保持两类clipboard失败、全量文本及全部选择范围检查；不改产品。原失败与before副本保留；修正后单套24项、同次全量168套/2150项完整CI、真实DB/catalogue/迁移及 `20261116T025107-history-integrated-e2e-f78bd8` 同次全部11场景通过，950项产品输入与成功CI/E2E完全一致，没有拼接2149项冒充整套成功。

镜像缓存的存在性与marker是同一生命周期：独立清理缓存后，应在核对归属与原字节后将marker归档，避免后续预检把陈旧声明当作可用镜像。本轮陈旧marker预检失败保留为 `5865be`；重建后 `f78bd8` 成功。最终非force删除cache的同时把marker移为 `.before`，保留原SHA；复用与清理都核对精确ID/owner/唯一tag/仅同一owned digest和无使用者，不通过全局prune处理。
