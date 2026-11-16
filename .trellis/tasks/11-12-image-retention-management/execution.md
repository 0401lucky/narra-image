# C2 执行交接

## 授权与前置

- 父任务三个图片子任务已获用户实施批准，当前从旧会话继续；未新增任务或扩展到视频。
- 2026-11-15 C1 基础已通过本阶段所需验证，记录位于 `../11-12-image-storage-foundation/verification.md`；C2 已由 `task.py start` 激活为 in_progress。
- C1 产品变更尚未提交，最后将按项目规则呈现具体提交批次。原有 GHCR 任务修改不属于本功能。

## 并行所有权

- `/root/c2_data`：新 additive migration、Prisma、media/Canvas schema/capability、Node/Go 数据契约/repository/schema verifier、共享 DTO、真实 DB/状态测试。先发布 `research/data-interface.md`。
- `/root/c2_runtime`：单一实际删除执行器、后台调度、读/复制保护接入、容量不足后的有界协调、Node/Go IO、Worker 生命周期与 Go 外部可用性投影及对应测试。
- `/root/c2_ui`：管理员 API/service/page、策略/预览/确认/进度、设置导航、TS 图片可用性 DTO/serializer/查询、作品/会话/Canvas 消费者与对应权限/交互测试。
- 主会话：共享接口协调、验证工具/浏览器证据、spec 与任务记录。修改交叉文件前相互协调；不得回退他人改动。

## 必须先成立的删除保护

按本任务 design 与 C1 `research/retention-data-handoff.md`，先补齐“旧 Canvas result/run 已引用，之后才回填 mediaAssetId”的历史根。清理候选/领取还要复核原业务事实、长期输入根、精选/封面、活跃输出/写入/预留、读取/复制、Canvas 七天宽限；空 ImageReference 不足以证明可删。

逻辑清理与迁移冗余源退休共用物理执行器，但资格不同。所有字节释放须来自确切删除/missing 回执及现有 accounting trigger，UNKNOWN/过期/错误卷不能减量。

## 验证窗口

仍复用 C1 已审计的 `checks/isolated.py` 和唯一冻结快照：
`E:/code/narra-image/.trellis/tasks/11-12-image-storage-foundation/checks/.runtime/storage-4e37900e/app`。

工具链 Node24.22.1 / Go1.25.14 / pnpm10.32.1 已准备。源码 capture 已包含 C2/C3 任务目录。主会话串行 refresh/测试/构建；其他执行者不操作该快照或读取真实 `.env`、数据库、R2。

- `retention-catalog`：对最新完整 migration 链采集实际 media/Canvas catalogue，仅提供指纹，不冒充行为测试。
- `retention-schema`：额外验证最新迁移结果与 Prisma 声明零差异。
- `canvas-db`：执行明确纳入 runner 的 full/additive suites。
- `ci-bounded`：完整十阶段 CI，只约束本机测试/构建并发；OOM 的失败与独立重跑分别记录。
- C2 尚需实际管理员浏览器流程与后台真删除/失败/恢复证据，不能用 UI 单测替代。

## 当前状态

三个模块实施中，尚未宣称 C2 验收通过。C3 继续等待本阶段接口与质量门禁。

## 2026-11-15 复核与验证进度

- data/runtime/UI 主体已完成。`/root/c2_check` 负责全范围检查并维护 `verification.md`；主会话仍拥有唯一验证窗口和 specs。
- 05:11:40 冻结：Prisma、Go build、全局 types 通过；`051448-test-45d713` 为 17 个专项 / 197 测试通过。
- 最新 C2 SQL SHA 为 `f6917c183d108706fda46282263a58a3bdbaaefb9ee3f641e3f9b38d7843cbf1`；`052055-retention-catalog-5f441a` 捕获 media 417 / Canvas 196，对应两个 manifests 已同步。后续未改产品 SQL。
- `052650-canvas-db-7a3f5d`：三组 DB suite 完整历史/增量历史通过（含 11 个 C2 用例）。之后补了仅测试的 source-retirement 第三副本、rollback revision 常量等回归，须进入最终冻结。
- Go 新测试先后修正无效 UUID 和 SDK 精确 `x-id=DeleteObject` 查询夹具；没有放宽生产删除凭证/路径/版本校验。最终 Go 复跑尚待记录。
- UI 新回归的五项 fixture 类型错误已修；`cleaned` 按不可变图片 ID 单调保留，`unavailable` 允许新事实恢复，已覆盖迟到任务/会话/Canvas 缓存。
- checker 已修复 5 个文件：MyWorksBoard 的 server props 可用性窄合并及打开的旧 zoom；Node chat/completions 复用共享 formatter 拒绝 cleaned/deleting URL；新管理员页面在 try/catch 外构造 JSX。相应两组回归已补。
- `053436-ci-bounded-7b5a38` 仅在新管理员页面 JSX try/catch lint 失败，尚未运行后续全量测试/DB/browser，不能记为全量通过。上项 page 修复已解决源码问题，等待实际 lint 回执。
- 当前 05:47:56 冻结正在跑 checker 两组回归、types、lint。随后统一 fresh CI、Worker/Gateway/Canvas DB、migration、真实 `retention-http`。
- Data 正补 managed Canvas 经新执行器的七天/根/多副本/逻辑额度/UNKNOWN与token恢复分支。历史时间无法经生产 guard 写入，已明确允许 C1 既有窄 fixture：临时库 sentinel + 精确 ID，仅事务内 SET LOCAL replica 更新三个时间字段，立即 origin 并断言，所有实际清理操作仍跑完整 guard；不改 DDL/身份/计量/业务状态。
- `checks/browser-flow.mjs` 已准备真实 Next/Go/DB/Chrome 流程：权限→策略→预览取消→确认→关闭管理员浏览器并重启 Worker→实际删除/幂等/历史保留→桌面/手机截图。使用短原始 writer lease 的专属历史文件夹具，读取保护不绕过。
- 不在这里结束父任务。C2 门禁齐全后激活已有 C3 `11-12-image-history-migration`，继续历史盘点/复制/源退休/两种部署；最终才展示具体提交计划并按项目规则请求一次提交确认。

## 2026-11-15 最终冻结与本机内存约束

- `054820-test-9950d7` 的 2 suite / 31 回归、`054839-types-6f3771` 的全局 types、`054901-lint-439f1f` 的 lint 均通过，修复五文件 SHA 相同；data 已完成 14 项真实 DB 用例，尚待最终 runner。
- `055319-ci-bounded-d14fc2`：前四阶段通过，双 Vitest worker 在 Windows 原生 Zone Allocation OOM 后达到 300 秒截止，完整命令退出 124，不能记为全量通过。
- `071234-ci-bounded-a317a2`：本地改为单 Vitest/build worker，前四阶段通过，测试因原生 Committing semi space 失败退出 134。主机当时可用 commit 约 1.4–2.2GB，普通 PowerShell 启动/读取也出现过原生内存分配错误；未终止用户应用或修改分页/生产配置。
- checker 只读核对 `canvas-unified-view` 及五个相关文件与 C1 指纹完全相同；该 suite 不进入 C2 新图片可用性更新路径，未找到渲染循环缺陷。
- 07:18:09 冻结在相同产品源码上进一步限制测试 V8 old space 512MiB、semi space 4MiB，并改为逐项 reporter；CI 所有阶段、测试、断言与截止保持。当前 `071828-ci-bounded-6adced` 运行中，待实际结果。
- C2 维护 API、全站锁序、读保护、token/UNKNOWN、源副本退休、晚绑定 Canvas 根与正式 availability 已同步进 image-storage、canvas-contracts、release-hardening 与 frontend quality/state/public-work specs。规范更新不表示门禁已通过。
- 最终仍串行执行 worker-db、gateway-db、canvas-db、migrations、retention-http；测试冻结副本只由 root 操作。C2 通过后继续 C3，不重复索要既有实施授权。

### 后续实际回执

- `071828-ci-bounded-6adced` 在 300 秒测试截止退出 124，日志中 233 项完成，未形成完整通过。小堆下未再见 OOM，但不能累加先前部分测试冒充全量。harness 现在保留原 `NODE_OPTIONS` 的 deny-env preload，再追加测试内存参数（该次临时设置曾覆盖 preload，失败结果不作为环境隔离门禁证据）；已恢复两个测试 worker，并增加只输出 module/case 进度、不更改执行结果的诊断 reporter。
- `072621-worker-db-3ab400`：完整 Worker TS/Go disposable DB 通过，13.736 秒。
- `072717-gateway-db-3d61f4`：生成网关 disposable DB 通过，10.366 秒。
- `072815-canvas-db-2fb293`：完整历史三套共 60 case，59 通过、1 失败。新 managed Canvas UNKNOWN 接管场景暴露真实 `CANVAS_LEASE_LOST`：finalizer 单独改 deleteToken 时违反原 guard 的续期要求。已交 data 修复实际协议；不弱化测试或 guard，不将本回执记为通过。若 SQL 改变须重采 media/Canvas catalogue。
- `073013-go-tests-3b9981`：Go 全量实际通过，7.218 秒。先前 UUID/SDK x-id 夹具问题已关闭，LOCAL、S3 失败/版本/单次删除与 scheduler 生命周期测试均纳入此命令。

### 07:38 后的真实回归定位

- SQL 续期修复 SHA `2d65ec945b167fac0df3a8e08d6f6d92cbdcf9545dd23b5eaa05d978ecf2bdcb`；`073350-retention-catalog-56af4a` 已实际重采 media 417（SHA `22019c06daaabcf147a43942df7b4ff42e8d2786615526c74cf5b220a57a21aa`）与 Canvas 196（SHA 不变），两份 schema objects 已逐项匹配。
- `073819-canvas-db-0941d9` 在 07:37:59 冻结上通过 full/additive 各三套、60 项用例（每种均含 14 项 C2），53.534 秒；UNKNOWN/过期 Canvas token 分支已有实际通过。
- 新 module/case reporter 在 `074004-ci-bounded-aa02a2` 将全量卡点定位为 `generator-studio-origins.test.tsx:251` 的 same-owner fresh props 用例。其前一项 A-B-A 用例完成，下一项持续不结束。低可用内存是真实现象，但不能据此将先前全部 OOM/超时认作纯环境失败。
- root 发现 C2 `useConversationGenerations.mergeGeneration` 在已有 current 时总创建新对象；工作台同步 effect 取得相同 canonical 后又因引用不同而 updateGeneration，再复制并 publish，形成回写循环。已交 UI 代理修复语义/引用收敛，保持 cleaned 单调、终态和本地编辑；原完整组件断言不能削弱。当前全量命令未完成，后续先定向复验此 suite 和 hooks，再完整 CI。

### 全量测试已关闭，生产构建转入 Linux 验证

- 缓存修复只改变两个 hook 的等价合并/publish，并抽出共用 `generation-value.ts`；原 GeneratorStudio 和 origins suite 未修改。`075011-test-354dde`：5 suite / 89 case 通过，6.507 秒，包含原卡点。
- `075119-ci-bounded-cb2ab3` 全 Vitest 已结束，无再挂起/OOM：161 suite / 2065 case 中只有两处测试断言失败。UI 更新 featured response 的合法 availability/显式 12 字段白名单，以及 work detail 的完整多行 raw textContent 断言；产品源码保持。
- `075738-test-135701`：两组断言回归 22 case 全部通过，3.159 秒。
- `075820-ci-bounded-1e367d`：前九阶段全通过，包括 161 suite / 2065 tests、全 types/lint、Worker TS/Go contract、Go 全量 tests/build；sourceChanges 和 snapshotModifications 均为空。仅最后完整 Next build 的 TypeScript 子进程原生 OOM，整个命令仍为 exit 134，不能标成原 CI 单次通过。
- 同一产品代码的 Windows 独立完整构建 `080233-build-42bd97`、`080555-build-af3d12`、`091245-build-9db16a` 仍失败。构建并发 1、1536MiB old-space / 4MiB semi-space 只属于 task harness；较低 1024MiB 试验确实到达 heap limit，其余为低系统 commit 的 native allocation 失败。没有改生产配置、依赖、TypeScript 排除或用户系统内存设置。
- `091715-next-types-bec0f8` 使用当前 Next 16.2.4 官方 `verifyAndRunTypeScript` 独立执行真实类型检查并写正常增量缓存，16.641 秒通过。随后原完整 build `091842-build-5b5a56` 仍 OOM，故缓存预热不能宣称解决生产构建。
- `/root/c2_linux_build` 正实现本任务下的 Linux 完整构建/运行产物导出 helper：固定预装基础镜像、凭证隔离 source context、原 Dockerfile builder 的完整 `pnpm build`、精确 owner 清理；只限制验证资源，导出时不带 Linux `.next/cache`，不改 compiled 文件。root 仍拥有唯一冻结窗口、产物校验/安装与 HTTP/browser 验收。
- `092305-go-vet-57313a` 全量 Go vet 通过，1.795 秒；`092521-worker-db-384562` 新 SQL 版本 Worker DB 重验通过，12.259 秒；Gateway DB 同版本重验进行中。
- C2→C3 实际接缝研究已写入 `research/c3-data-handoff.md`，两份 C3 jsonl 已引用。它是 observed/adoption/copy 协调提案，未开始 C3 产品实施；整体授权和 C1→C2→C3 顺序保持。

### C2 最终质量门禁通过

- `092738-gateway-db-c1be1e` 同最终 SQL 的 Gateway DB 通过，10.073 秒。Worker DB、Go vet、完整/追加 Canvas DB 及迁移回执已经齐全。
- Linux 备用构建 `094421-linux-next-build-4f2ac4` 在依赖 COPY 阶段遇到 Docker `unexpected EOF`，未运行应用构建；退出 1，原清理回执 `complete=false` 保留。稍后对相同 daemon 的只读恢复检查确认该 owner 无容器/镜像残留，记录于 C1 receipts 的 `c2-linux-build-recovery-audit.json`。没有安装 Linux 构建产物。
- `132252-build-55c84c`：原完整原生 `pnpm build` 通过，26.27 秒，包含 Next 编译、内置 TypeScript 和 64/64 页面生成。它与 `075820` 前九阶段组成完整验证；不改写原 CI exit134。909 项非 `.trellis/` 产品输入相同，sourceChanges/snapshotModifications 为空。
- `132509-retention-http-f8a633`：真实 Next/Go/PostgreSQL/Chrome 验证通过，132.266 秒。覆盖无 S3 的实际生成、普通参考上传、Canvas 导入/重放/保存根、匿名 GET/HEAD/304、Next optimizer、下载代理及重启读取。
- 六项 C2 浏览器检查全部通过：401/403 权限、原生策略与预览取消、确认后关闭浏览器并重启 Worker、后台精确删除 70B 与 quota 从 350B 到 280B、重复确认不再减量、原任务/提示词/余额不变且媒体 410、同 job URL 重开、390px 手机无横向溢出、作者历史/详情已清理占位与下载禁用。
- 主会话已目视核对 `retention-browser-fdc1a2e9-7105-4b7f-ac75-ef033e90971a` 的五张桌面/手机/作品截图。checker 完成最终全范围验证记录，C-A1–C-A7 均通过，没有遗留 C2 产品缺陷。`checks/gates.json` 绑定实际回执与产品指纹。
- 相关 specs 与重复调试复盘均已更新，父实施清单 C2 已勾选。C1/C2 保持原路径供后续冻结验证复用，提交/归档等待整个父交付完成后的具体批次审阅。现在进入已批准的 C3 历史登记与迁移实施，不执行生产操作。
