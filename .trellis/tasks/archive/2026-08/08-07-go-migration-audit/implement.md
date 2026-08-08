# 渐进深化 Go 化迁移执行计划

## 1. 执行原则

- 父任务只负责需求、依赖、跨子任务验收和最终集成；实际代码由四个子任务分别实施和检查。
- 每个子任务开始前补齐自己的 `design.md`、`implement.md`、上下文清单并获得启动批准。
- 先增加兼容路径和测试，再切换流量，最后清理旧实现。
- 不自动部署生产；数据库删除、批量重写、容器/volume 删除等危险操作必须另行获得明确确认。

## 2. 阶段与依赖

### 阶段 A：冻结基线与契约

- [ ] 保存当前测试、路由、schema、环境变量和部署拓扑基线。
- [ ] 建立语言无关的生成契约/测试向量，覆盖状态、模型、渠道、错误、计费和媒体字段。
- [ ] 确认外部 API 连接中断不取消已 handoff 任务；处理中任务不自动退款。
- [ ] 将测试入口稳定化的责任交给 `release-hardening`；本阶段只记录当前超时基线，不修改业务测试。

验证：

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run src/tests/unit/external-generation-service.test.ts src/tests/unit/job-refund.test.ts src/tests/unit/image-url.test.ts
go -C worker test -count=1 -timeout=50s ./...
```

回滚点：本阶段只新增契约和测试，不切换运行行为。

### 阶段 B：子任务 `08-07-worker-contracts`（P0，先行）

- [ ] 固定渠道必须验证模型；停用/删除渠道不得静默回退。
- [ ] 统一 TS/Go 模型分流和错误分类。
- [ ] 设计并实现有限重试、`nextAttemptAt`/错误码等必要 additive schema。
- [ ] 明确 PENDING/PROCESSING 的取消、请求超时、退款和幂等语义。
- [ ] 增加队列公平性/用户级并发保护、schema gate 和优雅停止测试。
- [ ] 增加 Node/Go 契约回归及真实 PostgreSQL 队列集成测试。
- [ ] 产出旧 Node 生成器的生产引用清单和删除闸门；实际删除归阶段 E，不在本阶段删除。

验证：

```powershell
pnpm test
pnpm exec tsc --noEmit
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
```

审查闸门：确认所有退款只发生一次，重试不会重复提交/计费，旧任务仍能被新 Worker 读取。

### 阶段 C：子任务 `08-07-release-hardening`（P0，contracts 冻结后集成）

- [ ] 固化 embedded 生产主路径和 dedicated 辅助路径，开关互斥且可观测。
- [ ] 把 baseline/repair 与普通启动分离；空库和升级库都真实执行 migrations。
- [ ] 增加唯一 CI/本地入口（例如 `pnpm verify:ci`）和独立迁移入口（例如 `pnpm verify:migrations`）：TS、Go、Docker、Compose、迁移升级均有明确退出码。
- [ ] 增加 app/worker `readyz`、schema 版本校验、指标保护和结构化日志。
- [ ] 补齐环境变量契约、密钥强度、数据库 URL 特殊字符和视频配置。
- [ ] 演练 Worker 崩溃、数据库断连、迁移失败、停止和旧版本回滚。

验证：

```powershell
pnpm lint
pnpm test
pnpm build
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
docker compose config --quiet
docker compose -f docker-compose.e2e.yml config --quiet
```

新增 E2E runner 后必须验证：空库迁移、历史 schema 升级、失败 migration、app 等待 Worker、重复消费者保护；这些场景必须由一次性测试数据库/fixture 和可重复命令覆盖，不能只留在自然语言。

全量前端测试的默认超时先由该子任务稳定化（统一 CI timeout 或拆分入口），再成为所有后续子任务的硬门禁。

回滚点：保留旧启动入口和配置开关一个观察期；禁止在同一发布删除兼容命令。

### 阶段 D：子任务 `08-07-media-sync-boundary`（P1，媒体先于提示词）

- [ ] **媒体阶段（先行）**：生产强制长期媒体存储，开发 fallback 显式化；统一图片/视频 S3、CDN、URL 和历史记录读写契约。
- [ ] **提示词阶段（可独立验收）**：Go 成为抓取/解析/入库权威实现；Node 管理入口只提交任务和读取状态。
- [ ] 两阶段共享幂等、锁、超时和错误记录，但提示词阶段不阻塞网关。
- [ ] 手动、后台、定时触发共享幂等、锁、超时和错误记录。
- [ ] 增加 S3 失败、上游 URL 过期、部分来源失败和重复同步测试。
- [ ] 如需历史媒体回填，先提供 dry-run、数量统计和备份方案，再请求危险操作确认。

验证：

```powershell
pnpm test
pnpm exec tsc --noEmit
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
```

审查闸门：历史作品可继续读取；生产路径不再正常写入大 data URL 或短期视频 URL。

### 阶段 E：子任务 `08-07-go-api-gateway`（P1）

- [ ] 在 Go 内部端口实现 images、edits、responses、chat 和 generation 查询。
- [ ] Next `/v1` 先作为薄代理，通过功能开关在旧路径与 Go 网关间切换。
- [ ] 保持 API Key、限流、计费和入口 SSRF/输入校验由 Next 负责；Go 校验版本化内部 envelope，并承接媒体限制、OpenAI 错误/SSE 和执行协议，不迁移用户页面域。
- [ ] 增加代表性客户端与真实数据库的逐接口兼容测试。
- [ ] 灰度验证成功后关闭旧直连调用；确认生产引用和回滚依赖为零。
- [ ] 最后由本阶段独占删除旧 Node 生成器及只为其存在的测试/兼容代码，并再次全仓搜索；删除前须取得明确确认并保留独立可回滚提交。

验证：

```powershell
pnpm lint
pnpm test
pnpm build
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
docker compose config --quiet
```

灰度检查：JSON/SSE、超时、取消、错误码、b64/url、计费、查询和回滚均与旧入口一致。

回滚点：开关立即恢复 Next 入口；数据库 schema 保持向后兼容；删除旧实现必须独立提交，便于恢复。

## 3. 并行策略与文件所有权

- `worker-contracts` 独占生成业务、队列 SQL、契约 fixtures、attempt ledger 和对应 TS/Go 测试；先冻结 schema/错误版本。
- `release-hardening` 独占启动脚本、Docker/Compose、CI、迁移工具、readyz/metrics 和部署文档；Worker 只提供可调用的 schema/消费探针。
- `media-sync-boundary` 负责 storage、prompt sync、调度和历史兼容；媒体 URL/响应字段由它在媒体阶段定版，提示词阶段不阻塞网关。
- `go-api-gateway` 最后执行，负责 Go HTTP 协议层和 Next 薄代理；不得提前删除旧路径。
- 子任务内部可对独立测试、文档和实现模块使用多个代理；同一文件由单一代理拥有。

## 4. 全局质量闸门

- [ ] 每个 CRITICAL/WARNING 审查结论回到实际数据源和调用链验证，避免信任边界误判。
- [ ] 每个 schema/config 值修改前全仓搜索所有消费者，并同步 Node、Go、Compose、README 和测试。
- [ ] 所有新增状态/错误字段有单一 owner、规范化函数和往返测试。
- [ ] 每个子任务的验收矩阵、命令输出和外部环境证据写入任务目录的 `verification/`；仓库内验证与需用户授权的 Zeabur/S3/真实渠道验证分开标记。
- [ ] `git diff --check` 通过，无无关用户改动被覆盖。
- [ ] 全量测试、类型检查、lint、Go vet/test/build、生产 build、Compose/E2E 验证均有记录。
- [ ] 真实上游/S3/Zeabur 验证仅在用户授权和安全配置具备时执行；不得把敏感值输出到日志。

## 5. 父任务最终验收

- [ ] 四个子任务均完成并归档，父 PRD 的跨子任务验收全部满足。
- [ ] 更新 `docs/go-backend-migration-plan.md`，准确标记已完成、保留边界和后续项。
- [ ] 将稳定的跨层规范写入 `.trellis/spec/`，避免未来再次出现双轨漂移。
- [ ] 完成一次集成审查：Web 生成、外部 API、退款、媒体、提示词同步、部署迁移和回滚。
- [ ] 最终提交前由 Trellis check 子代理进行全范围复核。
