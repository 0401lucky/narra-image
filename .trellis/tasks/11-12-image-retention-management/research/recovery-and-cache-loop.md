# Bug Analysis: Canvas 恢复顺序与会话缓存回写循环

2026-11-15，C2 最终验证中的复盘。Canvas 修复已通过真实 DB；缓存修复通过 89 项专项与 2065 项全量单测。后续原生完整构建与真实浏览器回归也已通过，详见任务 verification 的独立回执。

## 1. Root Cause Category

- **B / E — 跨层契约与隐含假设**：Canvas 的删除令牌续期不仅依赖自身状态，还要求关联 ImageAsset 仍为 DELETING。先把 ImageAsset 完成为 DELETED，再续 Canvas token，即使最终预期状态正确，也会被原 guard 拒绝。
- **C / E — 变更传播与身份假设**：C2 给会话任务合并加入图片可用性时，无条件复制已有任务。工作台原本把 useStudioJobs 返回的 canonical 对象交回会话缓存，以引用相等停止同步；复制破坏了这个收敛条件，两个缓存经 effect 反复回写。
- 独立 hook 的数据断言不能证明组合后的 publish/effect 会收敛。仓库已有完整组件用例覆盖这个组合，必须实际运行并正确定位其失败，不能只引用专项通过。

## 2. Why Fixes Failed

1. C1 曾出现构建并发 OOM，本轮主机也观察到低可用 commit 和普通 PowerShell 分配失败，因此最初将全量测试 OOM 优先视为环境问题。这些现象不排除应用循环造成额外内存压力。
2. 由两个 worker 降为一个，再收紧测试 V8 堆，只改变了症状：OOM 减少，但单个用例仍无法结束，最终命中 300 秒总截止。资源参数不能修复不收敛的数据流。
3. 最后一条 stderr 的 Canvas React warning 并不等于当前卡点。对该 suite 进行 C1 指纹核对排除了它的相关改动，却没有覆盖另一个仍未完成的工作台用例。
4. task-local reporter 记录每个 module/case 的开始和结束后，`074004-ci-bounded-aa02a2` 明确停在 `generator-studio-origins.test.tsx:251` 的 same-owner fresh props 用例；据此追到 register → canonical → merge → publish 的闭环。
5. 一次本地小堆试验覆盖了原 NODE_OPTIONS；该失败结果没有被采纳为隔离验证通过。后续 harness 改为追加参数并保留 deny-env preload。完整测试范围和原总截止均保留。

没有预先记录数值化先验概率；本记录只保留实际观测和推断的变化，不回填事后置信数字。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | 真实恢复测试 | 保留 managed Canvas UNKNOWN、旧物理 token、过期逻辑 token、全部副本完成后的减量与重复回执；修复在两逻辑行 DELETING 时先续 token。 | DONE：`073819-canvas-db-0941d9`，full/additive 各 60 项通过 |
| P0 | 缓存收敛 | 没有新媒体事实时保留 canonical 对象；有实际可用性变化时才产生必要的新值；旧终态/时间优先级不变。 | DONE：两 hook 共用原任务语义比较，仅真实变化 publish |
| P0 | 组合回归 | 原样执行 generator-studio-origins 的同账户新 props、终态/迟到响应及本地草稿保留测试；追加真正覆盖重复 canonical 的回归。 | DONE：075011 的 89 专项，075820 的 2065 全量单测通过 |
| P1 | 诊断证据 | 异常全量测试记录 module/case start/end；OOM/timeout 不直接归为纯环境问题。 | DONE：任务 reporter 和 quality spec |
| P1 | 规范 | 文档记录关联状态的中间转换与 canonical 身份收敛要求。 | DONE：下列 specs |

## 4. Systematic Expansion

- **Similar Issues**：useStudioJobs、useConversationGenerations、Canvas runtime 的图片可用性合并、MyWorksBoard 的窄 server-props 合并。审查重复输入时的数据值和 publish 行为，不把所有新对象都认作有效更新。
- **Design Improvement**：外部输入在拥有者边界复制；内部权威对象在没有额外投影变化时保留身份。相关数据库状态机的每个中间 UPDATE 都要满足现有跨行 guard，而不只检查事务最终形状。
- **Process Improvement**：区分完整套件、专项、真实 DB、模拟 IO 与真实浏览器证据；保存旧失败，不把部分测试计数相加为全量成功。出现第二次同类异常时优先收集能区分假设的具体用例证据。

## 5. Knowledge Capture

- [x] `.trellis/spec/frontend/state-management.md`：图片状态单调性与 canonical 回写收敛。
- [x] `.trellis/spec/frontend/quality-guidelines.md`：定位未完成用例、环境归因边界及 NODE_OPTIONS 保护。
- [x] `.trellis/spec/operations/image-storage.md`、`canvas-contracts.md`：续期与两层终态的合法顺序。
- [x] `.trellis/spec/guides/cross-layer-thinking-guide.md`：值相等不代表转换收敛，合法最终状态不代表中间转换合法。
- [x] 模板判断：本业务仓库不存在 `src/templates/markdown/spec/`；不创建 Trellis 上游模板树。
- [x] 缓存修复和完整 CI/browser 最终回执补入本任务 verification。
- [ ] 按已批准父任务范围完成 C3 后，纳入 Phase 3.4 的具体提交计划并请求一次确认；本轮没有提交、推送或生产操作。
