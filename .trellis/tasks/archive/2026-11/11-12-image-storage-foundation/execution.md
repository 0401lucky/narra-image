# C1 执行交接（持续更新）

## 授权与当前阶段

- 用户已在最终规划摘要后回复“没问题”，批准父任务及三个图片子任务；视频/视频专用封面排除。不能重复请求创建/规划审批。
- 当前任务为 `11-12-image-storage-foundation`，in_progress。C2 清理管理、C3 历史迁移尚未实施；必须在 C1 相关门禁通过后按依赖推进。
- 生产数据迁移/删除/部署不在此次操作范围。仓库 main 原有六项 GHCR 任务未提交变更不属于本任务。

## 执行者与文件所有权

- `/root/image_data_core`：media contracts、Prisma schema、20261112090000 首迁移、Node/Go 图片 repository/schema verifier、数据层单元和真实 DB suite。
- `/root/image_integration`：现有 Node/Go 入口、runtime/env/Canvas/readiness/优化器/部署、20261112100000 第二迁移、Canvas 契约/runner/集成测试。
- `/root/image_local_io`：本地 IO helper/测试已完成，当前 idle。
- `/root/image_io_check`：正在复核并修复 IO helper/测试/接口说明的限定范围；已修 missing/pending 竞态、JS 尾换行接受差异和 ES2017 BigInt 字面量。之后仍需 C1 全范围 check。
- 主会话：调度和隔离验证、任务记录、spec 更新和最终提交；不要编辑其他执行者仍持有的产品文件。

## 接口与部署决定

- 具体数据/IO API 在 `research/implementation-contract.md`、`research/local-io-contract.md`。
- 配置 `IMAGE_STORAGE_BACKEND=s3|local`、PATH、VOLUME_ID、`IMAGE_STORAGE_MANAGED_ENABLED=false` rollout 开关；local 要求 managed=true。
- managed 模式始终 enforce 5GB；policy.enabled 只控制破坏性清理，不是放开配额的开关。
- ImageReference.ownerId 是引用者，ImageAsset.ownerId 是原作者；普通已知公开图片 URL 可跨 owner 建输入保护，Canvas 仍维持原 same-owner 检查。
- LOCAL key 映射平面 SHA256 文件名，独占 .writing 暂存与硬链接发布；只读 Verify 和明确零字节 ProbeWritable 分开。Probe 同时验证硬链接/不覆盖并清理两个已知路径。
- 文件0600，两服务需使用兼容 UID（当前 Docker 默认都为 root）；最终必须证明实际 Linux 同卷互读。Go Root.Link 使最低工具链升至1.25，镜像原本已1.25。
- Canvas scene wire 保持1，存储/GC修订2；旧GC签名被栅栏拒绝，新兼容GC只处理未纳管S3，managed物理对象归后续C2执行器。
- C1 保留现有 backfill 新COPY行为：INPUT+GENERATED 仅允许精确 backfill-image:<legacy-id>、现存未关联legacy图片/owner证明，仍实际预留与写入；C3无PUT历史采纳另行实现。

## 验证环境与锁

- Launcher：`checks/isolated.py`，复用已审阅的复制依赖/拒绝dotenv/owner检查。用 Python 调用，系统 pnpm/go 不在 PATH。
- Workspace：`E:/code/narra-image/.trellis/tasks/11-12-image-storage-foundation/checks/.runtime/storage-4e37900e/app`。
- Node24.22.1、Go1.25.14 在 `checks/.runtime/toolchain/`，官方SHA256校验；pnpm10.32.1复制到快照工具目录。Docker本机29.9.2，测试镜像已存在。
- 主会话分配单一 workspace 窗口；refresh、测试、schema capture、lint/types 不并发。真实源码可以继续改，验证只读冻结快照。
- 常用：`python checks/isolated.py refresh --workspace <absolute-app>`；`run --workspace <app> --stage prisma|types|lint|test|go-build|go-tests|go-local-io|media-canvas-db-smoke|canvas-db|worker-db|gateway-db|migrations|e2e`。
- `test` 后可跟精确 Vitest 路径。所有回执/日志在 snapshot 的 sibling receipts/，保存 sourceBefore/After 和真正退出码。

## 已有证据（不是完整 C1 通过）

- Prisma generate 两轮通过：20261112T034823-prisma-edc32e、20261112T044922-prisma-da75bb。
- IO Node35/35、repository4/4 通过；同批 contract32/33 发现 BigInt('2.3e9') 抛错，core 已修，待刷新重测。回执20261112T042804-test-582ed2。
- Go named-file IO12项通过，使用真实 contract 和 Canvas location，无shim：20261112T042920-go-local-io-f6ccbe。不是完整Go包验收。
- 首迁移42710 provider CHECK重名已修；第二次两迁移成功，但主会话catalog harness误把Canvas三列结果当JSON，已修。
- 两新增迁移 + core SQL smoke + Canvas LOCAL/root/旧GC栅栏 smoke 均通过：20261112T044811-media-canvas-db-smoke-221e11；20段完整历史，全部临时DB资源已清理。
- media实际263objects：1794458896575前的media capture（最新 `1794458896426-media-catalog-7c2308.json`），SHA b95e1addd746cf635d266e0d4d7a4fe4e6b84a9f12f5ba40dbc1e575865e7af7；core已填expected。
- Canvas实际196objects：`1794458896575-canvas-catalog-ed248c.json`，SHA e2a6e000a61d28115aca992fd6b4d07151c2147eac53871830242eab18dbdb05；integration已填并追加 UPDATE OF columns 核验。
- 早期 tsc20261112T044951-types-4623ee失败：ES2017不允许n字面量、schema测试union转换、旧fixture缺mediaAssetId/nullable能力字段；各 owner 已认领修复，未宣称最终类型通过。
- 之后 core 又加入窄backfill/边界校验，IO checker又修复竞态，因此需要刷新后重新验证相关专项，旧通过不能替代新源码证明。

### 05:05 源码快照专项

- 早期全 Go 构建成功：`20261112T045611-go-build-2911aa`，仅绑定 04:48 源码。
- IO checker 05:05:20 冻结 909 文件；Prisma generate `20261112T050640-prisma-57c9cc` 成功。
- Node 四专项 109/109 成功（local 51、contract 34、repository 4、schema 20）：`20261112T050728-test-992afe`。
- Go local helper 专项成功：`20261112T050829-go-local-io-2cb8ef`。
- lint 0 errors / 9 既有 warnings：`20261112T051002-lint-8a64c2`。
- 全工程 types `20261112T051152-types-a9724a` 仅余 integration 的消费者测试 union `b64_json` 访问；integration 已在真实源改成等价 `.toMatchObject`，待 fresh 验证。
- 以上均没有 snapshot/source 漂移。限定 IO 审阅完成；`image_io_check` 已转为 C1 全范围审阅，不能把专项代替全任务结论。
- core 接管独占验证窗口，refresh 后 joint catalogue/SQL smoke + canvas-db full/additive。其他执行者不操作快照。
- 主会话新增 `checks/local-crossprocess.mjs`（真实 Linux UID0、重建 Node/Go 容器共享临时 bind volume）和 `checks/local-http.mjs`（已构建真实 Next/Go、LOCAL Canvas/生成/匿名原图/optimizer/下载代理/进程重启）；尚未运行，不算验收。

## 下一步

1. 收集正在执行的早期Go全量构建回执，诊断发给相应owner。
2. 给IO checker刷新+本地/数据focused tests+go-local-io+lint窗口；主会话随后重跑fresh Prisma/types/完整Go。
3. core真实 image-storage-db.test.ts 纳入Canvas runner，与已有suite明确串行/事务隔离global quota/policy，不清除永久inventory做teardown。
4. 完成C1所有专项、完整CI与DB/迁移门禁；检查真实optimizer与两种拓扑覆盖由C3最终补齐，不能把SQLsmoke当浏览器/provider执行。
5. 做全范围trellis-check、更新相关spec/验证记录后，继续C2/C3；功能尚未完成，不得在此结束整个用户任务。

## 2026-11-12 跨会话恢复

- 从用户指定会话 `01a1cd4b-18ae-7e62-bb97-81aee1ac08d1` 恢复完整实施授权；本次再次收到“继续”，复用已有 C1，未新建任务。
- 原会话末尾实际已完成 `20261112T074619-ci-bounded-a88e13`：155 个 Node 文件 / 1992 测试、类型、lint（0 errors / 9 既有 warnings）、TS/Go 契约、Go vet/test/build 与 Next 生产构建通过。恢复时核对其全部 sourceBefore 文件与当前源码相同。仅限制本机 Vitest/Next 并发，保留原 CI 的全部 10 阶段。
- 原 `20261112T075245-local-http-307503` 在 8.226 秒内失败并清理资源，失败发生在夹具把 psql 命令标签与 `t` 当 JSON 解析；尚未启动应用/Worker，不是 HTTP 链路通过证据。本次将 SQL 输入设为 QUIET 并返回真正 JSON，等待重跑。
- 本次 `20261112T084932-worker-db-ae8b76` 与 `20261112T085533-gateway-db-f1e0e1` 均在旧 schema fixture 的 additive 迁移失败：缺少 `LoginCoverConfig`。交给 `/root/c1_resume_check` 修复旧基线的一致性；不通过绕开生产迁移消除失败。
- 当前所有旧执行者均不参与本会话；`/root/c1_resume_check` 拥有 C1 产品/回归修复和全范围检查，主会话拥有验证脚本、唯一快照窗口、任务记录与 specs。仍须完成 HTTP、Worker/gateway DB、migration 门禁和最新完整检查，再进入 C2。

## 2026-11-15 再次恢复与最终门禁

- 从用户指定的 `01a1cedd-fc26-7220-94ad-6b40642e29cf` 接回同一 C1；用户再次要求继续，沿用父任务三个子任务的既有实施批准。
- 上次未汇总的最终 Worker DB `20261112T101512-worker-db-cde899`、gateway DB `20261112T101542-gateway-db-ae595b`、Canvas/Image DB `20261112T101608-canvas-db-847013`、Linux 同卷跨进程 `20261112T101648-local-crossprocess-ea4860` 均已通过。逐文件 SHA256 核对显示产品输入一致，后续差异只在迁移验证脚本/测试与 Prisma 默认表达式声明。
- 本会话 `/root/c1_final_check` 完成全范围静态审查并写入 `verification.md`，补齐上次未完成的 11 项 pgx preflight 回归。
- Docker 沙箱管道拒绝的 `20261115T025355-migrations-abc02e` 不是通过。随后 `20261115T031826-migrations-2750f4` 暴露剩余 schema drift；实际诊断 `20261115T032802-schema-diff-556c49` 唯一差异是 `ImageAsset.publicToken` 默认表达式少一层 PostgreSQL 规范括号。
- 已对齐 Prisma 的 `dbgenerated` 并增加全部 Image 模型默认值与实际 catalogue 的回归；未修改 migration SQL、数据库约束、令牌算法或 TS/Go 产品逻辑。`checks/media-db-smoke.mjs --schema-diff` 可在加入测试哨兵前显示真实结构差异，所有资源仍为 disposable。
- 最新完整 migration `20261115T042713-migrations-4750ea` 已通过，53.15 秒，snapshot/source drift 均为空。当前串行执行 fresh `ci-bounded` → `local-http`，最终结果追加 `verification.md`。
- 下游仍按 C1 → C2 → C3 推进；C2 首次开放删除前必须解决已批准的“旧 Canvas 引用先存在、回填媒体关联后出现”根保护接缝，具体见 `research/retention-data-handoff.md`。
- C1 最终验证已完成，见 `verification.md`：CI 前九阶段与独立完整生产构建通过，真实 HTTP `043438-local-http-c508dd` 和零差异/真实 SQL smoke `043505-schema-diff-1782a7` 通过。继续激活 C2；代码提交与任务归档将于整个已授权工作可审阅后按项目要求统一呈现提交计划，不在依赖交接处重复请求实施许可。
