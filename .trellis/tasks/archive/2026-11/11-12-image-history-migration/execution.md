# C3 历史图片盘点与迁移执行记录

## 已有授权与依赖

父任务及三个图片子任务已于 2026-11-12 获准实施。C1、C2 的阶段门禁均通过；C2 最终回执见其 verification.md 与 checks/gates.json。2026-11-15 由 `task.py start` 激活本任务，无重复规划审批。

## 实施分工

- `/root/c3_data`：追加 `20261115180000_image_history`、Prisma、shared contracts/revision3、Node/Go repositories/schema 与真实 DB 用例；固定接口见 research/data-interface.md。
- `/root/c3_runtime`：默认只读 CLI、显式源绑定、实际源/目标读取校验、apply/copy/recovery/源退休编排及真实 IO 测试。
- `/root/c3_ops`：工具镜像打包、README/操作说明、rollback preflight、实际 embedded/dedicated E2E 和其 owner-labelled 资源安全。
- root：业务事务引用协调前置锁、validator 的共享修订消费、任务与 specs、隔离验证及最终验收映射。实现者各自拥有文件；不覆盖他人或原有 GHCR 任务修改。

## 验证安排

只由 root 使用 C1 的 `checks/isolated.py`，冻结 workspace 仍为 `storage-4e37900e/app`。所有测试/构建/DB/容器串行运行，保留 deny-env preload、固定工具链、owner 与实际退出回执。

为验证旧版本拒绝，在刷新 C2 快照前将真实旧源码交叉编译为 Linux Worker：`20261115T135500-previous-worker-linux-4133d8`，exit0，12.484 秒。二进制及原 contracts 保存在 `storage-4e37900e/c2-worker-evidence`，SHA256 为 `f16bec7352122be5b921392313fa0b34db83d01f201bee926e0d2fe9a04a784d`。不进入产品提交，不以模拟 revision 响应代替实际旧 Worker 证据。

## 引用竞争与锁序

数据层提供 `image_lock_reference_epoch()`（事务 advisory gate）在 quota/业务行/asset 之前。普通 SQL 写入由 BEFORE STATEMENT trigger 取得，多个语句的业务事务在入口提前取得：Canvas transaction、生成入队、外部 API 初始创建、管理员批量退款/删除、Go 图片成功写回及 managed gateway。managed 关闭时仍有历史输入产生，不能按 managed 开关跳过 gate。

`GenerationJob` 的 gate 仅覆盖 INSERT、输入 URL UPDATE 和 DELETE；普通状态/心跳不进入全局引用锁。`GenerationImage` 覆盖 INSERT、媒体绑定/展示状态变动和 DELETE。User/Conversation DELETE 在 cascade 前取得同一 gate。先捕获未绑定永久 URL 根，最终原子绑定别名/历史根并解除 adoption hold；原冻结输入和 Canvas tuple 不改写。

## 当前进度

功能实现、当前最终字节快照的完整隔离验收和获批Git收尾均已完成。完整CI、真实DB/catalogue/迁移、默认11场景E2E及源码/资源审计通过；两笔工作提交1368518/67b0edf之后，C3/C2/C1/父任务按序归档，journal第10次记录写入 `.trellis/workspace/0401lucky/journal-1.md`，未push或执行生产操作。以下保留所有原失败与阶段输入边界。

## 首轮实施与实际诊断

- 三个实现分工已交付，`c3_check` 正进行全范围复核并在 verification.md 逐项记录修复；未执行生产操作。
- 首轮 Go history/maintenance 专项 `143719-history-go-tests-55d538` 通过，6.349 秒；后来增加的 public-reader、canonical 输入与进度修复仍需最终完整 Go 回执。
- `152911-history-linux-tests-d0ed0c` 通过，6.475 秒。实际 Linux 命令测试包含默认初始化/预览零写入、所有预先存在子目录的 inotify 监控、取消/输入界限及参数错误；镜像固定、无网络、根只读、源码只读挂载，容器按 owner/ID 精确清理。不能将这份命令测试扩大解释为真实迁移已通过。
- SQL 迁移语法与 Prisma 结构诊断均曾通过；每次函数改变重新捕获 catalogue。当前 SQL 为 `12459548628adecd2f1cde186c0485ebe52d3dd5e44eb5f1b44abafe7ae1eecd`。`153623-history-catalog-d4ecc0` 采集 media636/Canvas201，后续加强 media→Canvas 依赖查询还须重采。
- `144229-canvas-db-c42e9d`：39/75 通过，失败暴露两个真实 SQL 问题（共享 trigger 的其他行类型不含 provenance、局部变量与 SQL 别名冲突），以及新 epoch 下同步等待对手的旧竞争夹具。修复保留完整 guards。
- `151307-canvas-db-e6600c`：75/77 通过，剩余两项 Canvas 历史测试受到前套件已提交 GC singleton lease 干扰。按 sentinel/确切 token 的 rollback fixture 隔离，不修改生产租约规则。
- `152439-canvas-db-984854`：19 项当时的 C3 全通过，整个 wrapper 仍失败；新 C3 竞争夹具留下无根 READY 对象进入后续 C2 全站清理断言。修复为对本套件确切 committed 图片建立真实永久输入 fixture 根，不删除不可变 ledger。
- `153942-canvas-db-adeb58`：82/83 通过。剩余 Canvas candidate 未找到来自历史 helper 只查第一页，前套件有超过1000条原图；按同一上界遍历游标并增加尾页边界回归。测试未通过时不标记整体门禁完成。
- `151616-test-7436d6`、`154245-test-90593d` 分别为231/238和125/128通过。真实变更新增只读 URL 查找后，旧 Canvas fixture 缺少查询桩；另外两处新测试用了错误 result 节点 ID/未包含 parser 默认 availability。原逻辑断言保留，定向修正后仍待复跑。
- `153045-go-tests-321f51` 已编译并运行新增 CLI/历史测试，但全量失败于残留 revision2/旧 catalogue 数量和迁移 fingerprint 断言。revision fixtures 正在与 shared3 对齐；两份 schema.json 由 root 独占，统一校验当前 SQL/checksum/capture，避免并行元数据覆盖。

## 复核补齐的跨层接缝

- 历史原 URL 不改写；作品、Canvas、外部响应和参考缩略图从当前 managed token 投影。已挂载列表只合并同 ID 的 url/availability，放大/下载读取当前对象；不重置分页、提示词、选择或点赞。
- 接受 token URL 的新任务/当前封面在短业务事务里注册实际 URL 拼写并形成 root，覆盖 host 大小写/默认端口/当前站点基址差异。只读 GET 不偷偷新增 alias。
- 显式源退休在内部目标读回之外验证实际 canonical GET，应用停机或读者不匹配保留源，重启后恢复同 job。默认复制保留源无需公开回环；启动 readiness 不依赖公开 GET。
- Canvas 纳管前拓扑验收真实 drain/等待 GC lease，用同卷 one-off CLI 复制后重启再恢复退休。旧 tuple/upload 身份与账户量保持。
- media schema verifier 补全 Canvas 函数、表字段/索引/约束、枚举与触发器依赖；CANVAS_ENABLED=false 不能让历史/清理消费者漏检旧 hold/GC 协议。

## 已通过的最终源码门禁与部署验证进展

- `155128-history-catalog-d4acb5` 捕获扩大依赖后的 media820、Canvas201。SQL仍为124595...；media capture SHA为`e8983c905bd04acd02272b31f21efb528de29daeff087347ca73108bff8e5b7b`，Canvas为`b408e4af9b1bbbbf6aaa44887faa40b18e51449d36ecfe75654814c6894a6c19`。两份 manifest 的当前与链中 SHA 由root逐项读实际SQL同步。
- `160229-canvas-db-be1df8`：完整/追加历史各4套、各87项全部通过，62.733秒，含27项C3；此前分页/共享测试状态问题已由实际复跑关闭。
- `162157-ci-bounded-88eb1c`：完整10阶段退出0，205.274秒。发布脚本、Prisma generate、TypeScript、lint、168套2146项、WorkerTS/Go契约、Go全量测试/构建、完整Next生产构建均通过。不是部分回执拼接；保留之前失败单独记录。
- `162720-worker-db-6747d6`：当前升级夹具与TS/Go数据库断言通过，12.234秒。旧fixture缺失Conversation已按原始migration补全，不让生产migration跳过真实依赖。
- `162835-gateway-db-629223`：含exact token输入/永久根/并发幂等的新网关DB通过，10.644秒。两个DB回执与CI只差legacy-schema.sql及Go网关DB的providerMode fixture修正，产品输入相同。
- `163001-migrations-e83e1d`：完整迁移、安全回滚预检及Prisma零差异验证通过，46.237秒。
- `163143-history-integrated-e2e-6b9ac0`：只读预检发现合成HOME无法发现已安装Compose，退出2未运行场景。root复制并校验现有Compose二进制到owned HOME，不复制auth/config；记录`compose-plugin-preparation.json`。
- `163427-history-integrated-e2e-08cc94`：Compose与4项本地镜像预检通过，但Docker旧缓存parent snapshot不存在，应用构建前失败。仅task helper为本轮镜像增加`--no-cache`，不prune用户缓存。
- `163710-history-integrated-e2e-fa8901`：绕过缓存问题后依赖下载两项TLS连接重置，退出1，未运行产品场景。root新增task helper核实原C2完整依赖镜像的Node版本与当前package/lock/workspace三个SHA，只替换验证Dockerfile的deps FROM；原`pnpm install --frozen-lockfile`与完整`pnpm build`仍运行，记录原/生成Dockerfile哈希。
- 当前完整默认11场景加真实C2旧Worker验证继续执行；这些环境/构建失败不是功能验收通过，不改写为成功。最终E2E/浏览器结论尚待实际回执。

## Linux 构建环境恢复与最后回归

- `164442-history-integrated-e2e-2982da`：固定依赖镜像核验通过，原 frozen install 成功，Prisma/Next 开始后 Docker EOF；检查容器清理核验超时。随后同 daemon 精确复核并删除，独立记录 `dependency-inspector-recovery-2982da.json`，原退出2不变。
- `165136-history-integrated-e2e-d6bc5f`：退出1、104.957秒；deps 安装成功，独立 builder 的 Corepack 下载 pnpm10.32.1 遇到 TLS ECONNRESET。只读核实固定镜像的实际 Corepack cache 后，task-local Dockerfile 复用它；builder/runner 均在已有 package.json 时执行离线版本检查，生产 Dockerfile 未改。
- `165921-history-integrated-e2e-4fd0e1`：退出2、132.562秒；离线 pnpm10.32.1、Prisma 生成通过，完整 Next 开始后 EOF。宿主日志确认17:01:15 UTC 整个 WSL engine 退出，guest wsl.exe 返回0xc00000fd；没有 container OOM 证据，不将其归因为应用错误。恢复后按原 daemon/ID/name/owner/read-only/no-network/no-mount 核实并删除 inspector，见 `dependency-inspector-recovery-4fd0e1.json`。
- `170509-history-integrated-e2e-bc3e98`：退出2、142.279秒；单核/2GiB 的 task-only 构建约束没有解决 WSL 退出，完整构建再次中止、清理未完成。Docker 此后暂时不能启动。恢复原本机 profile 的 Desktop 后，确认 daemon ID 仍为原值，按精确身份删除 inspector，确认本轮 app tag 不存在，见 `dependency-inspector-recovery-bc3e98.json`。原失败回执不变，未运行任何部署场景。
- Desktop 恢复的首次 CLI 调用继承了测试合成 profile，未在45秒 CLI/55秒 wrapper 截止内返回。核实本轮新建的进程树后停止它，以隐藏窗口、正常 Windows profile 和机器环境重新启动已安装 Desktop；不改全局配置、不关闭其他用户进程、不清理用户卷/镜像。两个恢复记录单独保留，不计为产品验证。
- task helper 新版本严格要求依赖镜像 `/app` 仅含三个已核实的依赖输入与 node_modules（含隐藏名称检查）；builder 直接继承 deps 层，省去一次大目录 overlay 复制。仍 COPY 全部当前源码、运行原 frozen install 与完整 Prisma/Next build，runner 继续 COPY 新 builder 的 node_modules，确保当前 Prisma Client；两份 Dockerfile 的 hash 与所有调整写入回执。reviewer 静态复核通过，运行效果待下一次实际构建。
- `170859-go-vet-c34f6b`：当前 Go 全量 vet 通过，1.589秒。
- `170916-build-56192a`：当前完整原生 Next 生产构建通过，26.109秒；编译、内置类型、页面生成和最终优化均完成。生产输入与之前完整 CI 一致；下一步使用此实际 BUILD_ID 执行最终清理浏览器回归。
- `171857-retention-http-4b17cb`：最终真实浏览器/HTTP回归通过，124.632秒、源/快照零漂移；六项检查和五张截图通过。已用350→280字节，确认关闭浏览器、Worker重启恢复、70字节精确删除与重放不额外释放、410、历史占位/禁用下载、提示词与计费保持、390px无水平溢出。950项非 `.trellis/` 输入与当前源码逐项SHA相同。
- `172214-history-integrated-e2e-39888f`：继承builder依赖后Docker未中断，Next编译通过；task设置的768MiB old-space使内置TypeScript进程明确V8 heap exhausted/SIGABRT，整轮退出1、126.812秒。Inspector和尝试镜像清理核验通过；不能据此解释此前WSL退出。已将task限制恢复为1536MiB old-space/3GiB、保留单核。
- `172709-history-integrated-e2e-6dd675`：完整Next/TypeScript/页面和四个Go命令均已编译成功；runner复制完整node_modules时Docker再次EOF，整轮退出2、282.453秒。没有运行场景；恢复同daemon后按原身份删除inspector、确认本轮tag不存在，见`dependency-inspector-recovery-6dd675.json`。
- 最新task-only helper让runner也继承deps，在当前Prisma/schema/config/包文件COPY后生成新client。完整build后逐项记录node_modules（根/目录/隐藏条目、mode/uid/gid、文件长度/SHA、字面symlink，特殊文件拒绝），runner必须完全一致；每文件1MiB buffer，builder/runner计数与摘要打印入日志。还验证依赖镜像的base layer前缀、精确环境/入口/用户/工作目录，拒绝构建DB/auth/app/provider环境泄入运行镜像。原构建和全部11场景保留，静态review通过，实际运行结果尚待回执。
- `173806-history-integrated-e2e-d587e5`：完整Linux应用/Worker镜像通过；builder/runner各55,432项依赖逐项一致，SHA为`45c1bacc3504f4b526053033baca9e335b8165acc1c38167ec2115f9b69795b7`。前9项legacy/Canvas场景全部通过；image-embedded完成生成/上传/普通历史复制、实际排空Canvas/复制/切换/离线读者拒绝，但重启后的源退休持续BLOCKED。整轮退出124、1065.205秒；所有本轮container/network/volume/image清理通过，source/snapshot零漂移，未将9项拼为全套通过。
- owner-checked只读诊断确认Canvas项source/target均READY、未创建retirement。review定位测试遗漏：只启用managed写入开关，却未通过正式策略接口开启`ImageStoragePolicy.enabled`；源退休按C2契约返回`IMAGE_POLICY_DISABLED`（durable block归为STORAGE_UNAVAILABLE）。正在修正测试，先实际断言默认策略拒绝且源/用量不变，再CAS启用策略且关闭定时/容量自动清理，恢复同job；不改生产SQL/Go保护规则。
- `180101-history-linux-tests-24717a`：当前Linux命令测试通过，5.107秒、源/快照零漂移；binarySHA`2f5d2f0e77356a64929ec29a31ee93007e011bc6c4b4d5ae6b8ac1f0b48b374b`。完整命令边界、递归inotify默认初始化/预览零变更及精确归属清理通过；与最终浏览器的950项非`.trellis/`输入一致。之后JS测试夹具修正不影响此Go/CLI证据。
- `180804-ci-bounded-12d932`：策略夹具/有界日志回归修复后，原完整10阶段再次通过，200.452秒；168套/2150项、全局类型、lint、WorkerTS/Go契约、Go全量测试/构建和完整Next构建均通过。相对浏览器仅三个部署测试相关文件不同，DB/Go/页面产品输入不变；后加迁移文档的一句策略门禁属于文字更新。
- `181219-history-integrated-e2e-2640e9`：退出2、2.387秒，旧无标签C2依赖镜像随上一轮最终镜像的无引用祖先清理而消失，止于预检；未运行场景。辅助器改为带本任务owner/tag的deps缓存，严格原deps prefix+frozen install+固定NodeID，记录精确运行回执并继续原全部校验。
- `181723`重跑中，新deps冻结安装38.1秒完成，缓存`sha256:7f2fb189b4194a1187daaaa7428c369de01518ea9b3b367c4ee3979684b7b32f`，owner`ab64fa18-bbd0-4b38-91db-3faf7db4dafc`。当前完整Next与runner55,432项依赖相同，摘要`e2bc35132248073275cadf6b7b1df9bc79a5786e12093e437266c567d6e09578`；不同seed的目录模式可能不同，只使用同轮精确等值证明。最终部署/缓存清理仍待实际回执。
- `181723-history-integrated-e2e-2fd7ef`最终退出2、951.844秒，9项legacy/Canvas通过。新的策略断言误将公开CLI外壳当内部ApplyReport，读取顶层items得到undefined；正确字段在`progress.items`。生产源/副本保持READY，无源删除。全部运行container/network/volume/最终image清理通过；独立tagged deps按计划保留。记录一次Windows docker.exe启动分配失败，后续retryable probe成功；独立Linux页缓存回收不删除文件、不改卷/配置、不重启服务。
- F12只修同三个测试相关文件的公开CLI外壳解析和对应mock，不改SQL/Go/业务产品。`183728-test-d0c4e5`两套57项通过0.963秒；`183838-types-aec1c4`全局types通过3.179秒；`183856-lint-ed3d80`全局lint通过13.721秒（9项既有warnings）。三份源/快照零漂移；全量CI2150作为其余输入基线，未虚称该次全量CI覆盖随后修正的三行协议解析。当前重新执行完整11场景。

## 续接会话的最终验收与证据恢复（2026-11-16）

- 从会话 `01a1dd19-5295-78c3-ae53-8cfcc0c42ac5` 恢复已有授权和任务。最后一次命令在原会话停止响应后继续完成：`184531-history-integrated-e2e-765657` 退出0，1278.531秒，源与快照均零漂移。没有重复创建任务或重跑已通过的重量级门禁。
- 完整默认11场景在同一次调用全部通过。两种图片拓扑各完成4个明确来源绑定、3个持久任务、保留3个源/退休1个源、8个LOCAL文件、最终770字节；实际验证dry-run零变更、停站读者拒绝、默认维护策略拒绝/显式启用/同任务恢复、源删除失败及重试、同卷重建和原URL读取。真实C2 Worker分别因拓扑冲突/修订不兼容拒绝，前后attempt/图片清单与计量相同。
- Linux应用/Worker生成Dockerfile的完整构建分别为305.882秒/68.399秒；builder和runner的55,432个依赖条目摘要同为 `24a9f2ffd34268575e0916d2ce4a34196c02c0c83c4744ef6da0d49f37e083cd`。任务辅助器仅对原Go依赖下载增加最多三次尝试；所有原安装、构建、类型/页面、启动和场景断言保留。此前 `184003...580614` 在Go下载EOF失败，原失败和精确清理记录保留。
- 当前完整950个非 `.trellis/` 源码/测试/部署输入逐项SHA与成功E2E相同，无新增/缺失/变化；输入集合摘要为 `765f4633d66a7607bef9faa023b759cb4978e68e83fbee5b4bc0d12c27cc6885`。两个构建辅助器也与冻结回执一致。之后仅更新任务记录/spec，不修改已验收产品源码。
- 最终资源审核 `final-resource-audit-20261116-617547e9.json` 确认同daemon上本次E2E的container/network/volume/image全部不存在；验证独立依赖缓存的唯一tag/ID/owner及无使用容器后以非force方式删除，tag不再存在。第一次审核因本机Docker给本地镜像记录同一owned RepoDigest而在删除前拒绝；该事实保留，重试仅接受同repository/同image摘要，不放宽未知对象删除。
- `checks/gates.json` 绑定15份通过回执、最终stdout/stderr、各输入边界、11项时长和独立资源审核。operations image-storage §9补齐公开CLI外壳/状态/退出码及progress.items；frontend quality-guidelines记录真实序列化边界的测试规则。父A1–A10及本任务H-A1–H-A6的隔离验收证据齐全，Git提交/归档待一次确认。

## 提交前原字节与Git检出修正（F13）

- 普通 `git diff --check` 不包含未暂存新文件；独立检查发现新C1 Canvas migration第273行多余EOF空行。与 `before-delivery-eol-20261116-f8411648` 原始副本比对，删除的唯一字节为最后一个LF，22174→22173字节，全部SQL前缀/13份函数定义保持原字节。新SHA为 `6f6d8fef83291f2888f5f5a47a2213c8131f027ffd8a7116b5549263d2513b3c`；两份schema manifest各仅替换一次旧SHA，不重写其他字段。
- migration-safety与Prisma核对原SQL字节，schema body单测的CRLF规范化不提供检出checksum保证。`.gitattributes`补齐已发布Canvas基座和C2/C3的精确 `text eol=lf`，五份shared链均固定LF，未修改已发布SQL或C2/C3字节，不增加whitespace豁免。
- 独立checker用Git实际检出filter把原HEAD的LF基座blob应用到每个声明路径：五份输出均与原SHA `1247ec0b...`相同；未匹配SQL路径产生883份CRLF，SHA `2c73d8ebe99b116b5a88d97638c0c1730bbb00cc7073258c66ee2cb0e685a9f4`，规范化回原内容。未暂存或写index/对象。原C1 EOF副本及两份manifest均保留；原11场景与浏览器记录仍是原快照的行为证据，不当作新字节回执。
- 2026-11-16 02:16:21 UTC冻结1030个源/任务文件，当前执行完整CI、实际catalogue、Canvas/Worker/gateway数据库、迁移及默认全部11场景。任务实例使用原隔离workspace与工具链，串行执行并保留真实退出/源与快照漂移。最终当前门禁完成后再关闭提交步骤。

## 首页异步断言修正与当前完整交付复验（F14）

- `20261116T021641-ci-bounded-802b4e`：退出134、16.675秒，脚本/Prisma/types通过后ESLint native Zone Allocation OOM。只在当前隔离CI外层把Node默认old-space/semi-space设为384/4MiB，deny-env仍在；helper原TypeScript/build 1536MiB、Vitest 512MiB/2workers及全部10阶段保持。没有生产环境或helper源码改动。
- `20261116T022306-ci-bounded-6e651f`：退出1、179.520秒，types/lint通过，168套中2149/2150项通过；旧Gallery测试在manual消息渲染之后、passive effect聚焦/全选之前同步断言。只将现有focus/selection-start/end合并到awaited `waitFor`，仍检查两种clipboard失败、完整提示词与完整选择范围，产品UI不变。原文件副本及SHA位于 `before-focus-sync-20261116-c444ad5d/`。
- 2026-11-16 02:38:19.986659 UTC重新冻结1030项源/任务输入，950项非 `.trellis/` 摘要 `da14302ceb1264c4baa15caeb0e802568456fc038ab4308e6c325d23e61efac2`。相对原完整 `765657` 只变 `.gitattributes`、两份schema manifest、C1 Canvas SQL最后一个LF及Gallery单测五条路径。
- `023830-test-128545`：单套24项通过；`023915-ci-bounded-c5b0f5`：同一次完整十阶段CI通过，222.859秒、168套/2150项，含全局types/lint、TS/Go契约、Go全量测试/构建和完整Next生产构建。没有把前次2149项与补跑拼成成功。
- `024314-history-catalog-bbe283`：media820/Canvas201真实对象数组与原catalogue完全一致；`024338-canvas-db-a4e74b`完整/增量历史各4套87项通过；`024526-worker-db-4e4b18`、`024608-gateway-db-eea182`通过；`024637-migrations-061d91`全部迁移场景和Prisma零漂移通过。七份成功回执源/快照零漂移。
- `024744-history-integrated-e2e-5865be`：退出2、2.448秒，只到预检；旧cache镜像已按上一轮证据删除，marker仍在。核实原字节后将旧marker移入 `history-dependency-cache-retired-20261116-027e9df8.json.before`（SHA `58674d1e06ffc1e491ba6827a2b60a4b90726c632744362e86b2b72d95991bb4`），不覆写失败。重建本任务owner/tag的冻结依赖后继续完整E2E，无产品源刷新。
- `025107-history-integrated-e2e-f78bd8`：退出0、1600.576秒，同次默认11场景全部通过；包括两种历史迁移、默认策略拒绝/正式启用/同任务恢复、源退休失败重试、实际旧Worker拒绝和持久卷重建。Linux应用/Worker完整构建364.209/107.474秒；builder/runner各55,432项，摘要同为 `2ec77b87d24425b94c5f7d8a2e4be988a042178c5115a266a5f78c39fe6e540d`。各拓扑实际8个LOCAL文件、770字节，仍是核实的任务Dockerfile变体。
- Root独立 `final-current-source-audit-20261116-b43e9d43.json` 逐项证明当前950个产品文件集合和原SHA，与fresh CI和E2E完全一致；两份构建helper也相同，index为空且HEAD未变。之后只更新任务/spec交付记录。
- Root独立 `final-resource-audit-20261116-6565af27.json`（SHA `8ee74bbdb3d1a36c394da2887503b60324f92530bce3c0580cb61a678d831091`）确认原daemon上E2E owner全部container/network/volume/image均为空。cache `b551ce24-859d-4c16-8b67-d2cdda83427d` 经两次ID/owner/唯一tag/精确owned digest/无使用者核验后非force删除；marker安全移为 `history-dependency-cache-final-20261116-6eb71f2d.json.before`，原SHA `9f1eace2da281428826ec0315e044dad87b64649da261a7a29222118e7593e7e`保持，无陈旧marker。
- `checks/gates.json` 当前passed，保留23份通过回执、原final及原失败，所有八份新门禁相对当前输入差异为空；父A1–A10/H-A1–H-A6映射已补齐。提交范围保持272个功能/spec+79个任务记录，六份既有GHCR文件不纳入；待一次具体确认后工作提交，再归档/journal，尚未提交或推送。

## 用户确认后的工作提交（2026-11-16）

- 用户回复“没问题”，一次批准父commit-plan中的两笔工作提交、C3→C2→C1→父任务归档及journal收尾，不push，不纳入六份既有GHCR文件。
- 再次逐项核对351个候选和六个排除文件，与最终readiness审计原SHA一致。功能暂存只包含272个获批路径；cached空白及每个Git blob核对通过，全部shared migration原字节保持。
- 首次Git commit因作者配置缺失退出128，未创建提交，原阶段证据保留。最近八笔Git作者/提交者与Trellis开发者均为0401lucky；仅为本轮Git/archive/journal进程使用既有身份，未修改全局或仓库Git配置。
- `feat(storage): add local image storage and retention management` 已提交为 `1368518dfe0e2b3d9a78789f022b4e0859240ff6`，实际272个路径与清单完全一致，index归空。当前提交79份任务记录，之后才进入finish-work归档/journal；没有真实服务操作或推送。

## Git收尾完成

两笔工作提交 `1368518dfe0e2b3d9a78789f022b4e0859240ff6`、`67b0edfd777629bd1dcd37117a1d0e892a115c9e`；之后依序完成四次归档，任务均completed/quality passed。native session第10次记录 `.trellis/workspace/0401lucky/journal-1.md` 只关联两笔工作提交；最後journal提交记录session和最终完成元数据。原GHCR六份文件字节保留，无暂存遗留、无推送、无生产操作。
