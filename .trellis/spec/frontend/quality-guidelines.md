# 前端质量指南

## 1. 适用范围与触发条件

- 适用于 lint、类型检查、测试与生产构建的约定和验证入口。
- 新增测试文件、修改 lint 配置、调整验证脚本或提交代码前，必须先读本规范。

## 2. 工具链（现状）

- **lint**：ESLint 9 + `eslint-config-next`（`core-web-vitals` + `typescript`），`eslint.config.mjs` 管理；`pnpm lint`。
- **类型检查**：`pnpm exec tsc --noEmit`（严格模式，项目 `tsconfig.json`）。
- **测试**：Vitest 4 + Testing Library（`@testing-library/react`、`@testing-library/jest-dom`），环境 `jsdom`；`pnpm exec vitest run`。
- **生产构建**：`pnpm build`（Next 生产构建，验证所有 route 可编译）。
- **契约验证**：`pnpm verify:*` wrapper（见 operations/release-hardening.md 与各验证脚本）。

## 3. 测试组织与写法

- 测试位置：`src/tests/unit/`（服务/组件/路由）、`src/tests/integration/`（真实依赖）、`src/tests/contracts/`（共享契约 fixtures）。
- 组件测试用 `.test.tsx` 并渲染真实组件 + `@testing-library/user-event` 交互；服务/路由测试用 `.test.ts`。
- 可见反馈和后续effect副作用是不同完成边界。提示词复制回退先显示manual消息，再由 `GalleryCard` 的effect聚焦并全选textarea；测试应在 `waitFor` 中一起等待focus与selectionStart/End，保留完整文本断言。仅等待消息出现后同步检查焦点会与提交后的effect竞争；不能改产品focus逻辑或删除选择范围断言来消除测试失败。
- **依赖 mock 用 `vi.mock` + `vi.hoisted`** 声明 mock 函数，模块级 mock 放在 import 之前：

```ts
// src/tests/unit/external-v1-routes.test.ts
const { mockRequireApiUser, mockRunExternalGeneration } = vi.hoisted(() => ({
  mockRequireApiUser: vi.fn(),
  mockRunExternalGeneration: vi.fn(),
}));
vi.mock("@/lib/generation/external-api", () => ({ runExternalGeneration: mockRunExternalGeneration }));
```

- 测试环境变量：直接或间接需要 `getEnv()` 的测试在 `beforeEach` 用 `vi.stubEnv` 显式设置合成 `AUTH_SECRET` / `DATABASE_URL` 等，并在 `afterEach` 用 `vi.unstubAllEnvs()` 恢复原值或缺失状态；不依赖 `.env`、外层 runner 默认值或其他 suite。
- `parseEnv({ ... })` 接受 `NodeJS.ProcessEnv`，对象测试夹具必须显式提供 `NODE_ENV`，包括只验证其他字段报错的负例。Zod 的 `NODE_ENV` 默认值不会放宽输入类型；Vitest 转译与 Next 构建通过也不能替代独立 `tsc --noEmit`（缺失时为 TS2345）。
- `server-only` 在测试中由 `vitest.config.ts` alias 到 `src/tests/setup/server-only.ts`。
- DB 集成测试必须带哨兵（`WORKER_CONTRACTS_REQUIRE_DB=1` + `TEST_DATABASE_URL`），禁止回退开发库（见 `generation-worker-contracts.md`）。

## 4. 验证命令

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run --testTimeout=30000 # 非 DB 全量；默认排除 Worker/Canvas/Image 带哨兵 DB suites
pnpm build
pnpm verify:ci                  # 一揽子：发布脚本单测 + tsc + lint + vitest + 契约 + go + build
pnpm verify:worker-contracts:ts/go/db
pnpm verify:canvas-contracts:db
pnpm verify:gateway:ts/go/db
pnpm verify:migrations
pnpm verify:e2e
```

- GitHub Actions 验证阶段只调用仓库内 wrapper（`.github/workflows/verify.yml`），不复制场景命令；依赖和明确的测试基础镜像准备在独立前置步骤执行，wrapper 自身仍不自动拉镜像。
- `git diff --check` 提交前必须通过（无空白错误）。
- 未暂存新文件不会出现在普通 `git diff --check` 中；提交前另用 `git diff --no-index --check -- NUL <file>`（Windows）检查候选新文本。difference退出1且无diagnostics与真实空白错误要分开处理。新SQL不得增加whitespace例外；shared migration链同时核对LF检出规则、原字节SHA与两份manifest。函数body测试的CRLF规范化不能证明Prisma原文件checksum稳定，详见 [Image Storage](../operations/image-storage.md)。
- 新增文件也要执行 `git diff --cached --check`。原始 OFL 许可和 `.before` 取证副本必须保留字节；`.gitattributes` 的空白例外仅限这些明确路径，不能扩展到真实源码、任务脚本或自行编写的文档。真实源码末尾多余空行应修正，并以新哈希重新绑定验证，不能把旧回执标作新字节的验证结果。
- 已绑定 SHA256 的机器回执/上游取证快照可用 task-local `-text` 保留 Git blob 原始字节；CRLF 回执用 `whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol` 识别行尾 CR，仍拒绝真实尾空格和多余末尾空行。普通源码/脚本/作者文档不加豁免；临时 index 的正例、尾空格/空行及脚本/文档负例和 raw blob 哈希必须一起核对，不修改全局 Git 配置。
- `eslint.config.mjs` 仅将 `.trellis/tasks/**` 的历史测试夹具、第三方参考代码和生成快照排除于常规源码 lint；`src/`、生产 `scripts/` 和非任务工具不能随之被排除。`eslint-scope.test.ts` 用真实 `ESLint.isPathIgnored()` 保留任务路径负例与应用/测试/脚本正例。提交任务记录前需在凭证隔离、包含候选任务工具的 checkout 上执行 `eslint .`，不能只凭不含 metadata 的源代码快照宣称根目录 lint 通过。

## 5. 已知约束

- 全量 vitest 需 `--testTimeout=30000`（部分组件测试冷启动较慢）；默认和 CI 排除 `worker-contracts-db.test.ts` 及只承载 DB suites/runner 的 `integration/canvas-contracts/`。后者包含 `canvas-contracts-db.test.ts`、`image-storage-db.test.ts`、`image-retention-db.test.ts`、`image-history-db.test.ts`，由独立 Canvas wrapper 显式固定目标、按文件串行执行；不能把排除当成 DB 验证通过，新增 DB 文件必须同时加入 runner 固定清单。
- 多个隔离测试/构建同时运行导致 Node worker OOM 时，保留失败回执，先串行调度重任务，再用 `vitest run --testTimeout=30000 --maxWorkers=2` 重跑完整非 DB 清单并记录有限总截止。不得将部分完成的测试数合并成全量通过，也不能删除测试或修改生产内存限制来掩盖检查进程崩溃。
- 若本机 commit capacity 仍不足，可在任务验证 harness 内进一步降为 `--maxWorkers=1`，并仅为测试子进程设置更小的 V8 old/semi-space 上限以促进回收；逐项日志用于定位失败用例。完整用例/断言和总截止不变，原生 OOM 与断言失败须分开记录。不得终止用户其他应用、修改系统分页配置或将本地限制带入生产配置；资源有界重试只有取得实际成功回执才算通过。
- 低可用内存、原生 OOM 或退出 124 本身不能证明失败只来自环境。首次重试仍异常时记录 module/case 的开始和完成，找到未完成的具体用例；最后一条 React warning 可能属于已完成文件。检查对应缓存合并/订阅/effect 是否收敛，再决定调整验证资源；不要反复只减并发。追加 `NODE_OPTIONS` 必须保留既有 deny-env preload，不能覆盖隔离保护。
- Next 16.2.4 的默认构建 CPU 数读取 `CIRCLE_NODE_TOTAL` 后减一。15-worker page-data 阶段因本机 commit capacity OOM 时，可仅在凭证隔离的验证子进程启动前设置 `CIRCLE_NODE_TOTAL=3` 得到 2 workers；先用已安装 `config-shared.js` 验证，再执行完整原始 `next build`、核对真实退出和源/配置哈希。不得改 `next.config`、依赖、生产内存限制或继承到测试/生产环境，也不得跳过类型/页面收集。默认失败和资源有界重试分别留回执；这不是默认并发或生产资源验收。
- 同一已审计的本地构建参数允许 `CIRCLE_NODE_TOTAL=2` 得到 1 worker；如果完整 CI 仅最终构建因内存失败，单独重跑同一源码快照的完整 build，分别保留两份回执并准确描述组合验证，不能声称原失败的 CI 命令通过。
- managed Canvas 的历史年龄夹具仅可在 runner 哨兵、owner 和精确 ID 核对后的 disposable DB 准备；事务本地 replica 仅调整允许的时间列，立即恢复并断言 `origin`，其他完整字段保持不变。资格/领取/回执/重放全部使用生产 guards，详细列边界见 [Image Storage](../operations/image-storage.md)。
- Canvas DB wrapper 使用独立 360 秒截止及 20 秒清理预留，不嵌套到 Worker 的 57 秒父截止。缺少哨兵或 runner 自建 localhost 数据库必须失败；本地镜像缺失返回前置条件失败，不拉取镜像、不回退 `.env`。
- 验证环境显式隔离构建与测试：仅构建注入非 loopback 的测试 `APP_URL`；要求缺失/默认环境的测试不得继承它。Prisma 使用隔离 config 或精确 `.env` 读取保护，禁止读取开发凭证。
- Windows wrapper 会通过命令 shell 执行 `pnpm`；含 `=>`、重定向等字符的内联 JavaScript 不得经 `pnpm exec node -e` 传入。改用脚本文件和直接 Node argv，防止意外重定向写入工作区。
- Vitest 直接导入带 shebang 的 CLI `.mjs` 时，脚本必须保留 LF 换行。Vite 8 的 SSR shebang 匹配不消费 CRLF 的 `\r`，可能把绑定插在 `#!` 前并报 `Invalid or unexpected token`；`node --check` 仍可能通过。`.gitattributes` 已固定三个 Canvas CLI / fixture 路径，验证须实际加载原测试套件，不能删除 shebang 或绕过测试。
- 每个验证 wrapper 保留真实退出码并受全局截止保护（见各 `verify-*.mjs`）。
- 跨进程 CLI 的测试夹具要对照真实 stdout 序列化结构，不能仅复制内部服务返回类型。图片历史命令的条目在 `historyCommandResult.progress.items`；真实 CLI 拓扑回归须验证与单测相同的公开外壳，避免消费者与 mock 同时错误仍让完整 CI 通过。字段、状态与退出码见 [Image Storage](../operations/image-storage.md) §9。
- 环境变量修改必须先改 `contracts/runtime/v1/environment.json` 再同步 `src/lib/env.ts`、`.env.example`、README 与测试（`runtime-environment-contract.test.ts` 会校验一致性）。

## 6. 禁止与常见错误

- 禁止跳过 lint/tsc 提交；warning 可接受但 error 必须清零。
- 禁止测试直接连接开发/生产数据库；DB 测试只连 runner 自建 disposable PostgreSQL。
- 禁止测试内 `console.log` 残留、`it.only` / `test.only` / `describe.only`。
- 禁止在测试里断言实现细节（如 mock 调用次数）替代行为验证——优先断言响应/渲染结果。
- Canvas DOM 测试的 ResizeObserver 必须保留真实尺寸变化语义；不能每次 observe 都伪造新 resize 而掩盖受控节点丢失 measured 的 hidden 回归。IME 除最终文本外还需检查原生 setter 未短暂恢复旧值，并补真实 Next/browser 检查；fake API 浏览器不是真实账户/DB/Worker E2E。

## 7. 手机画布与浏览器证据

- 修改 mobile editor 时保留真正 readOnly/owner/ready/deleting、单 poller、captured Save/Run、原图 lease 和旧 result suppression 回归。只改过时的 width=permission 断言，不能删除后端/计费/保留规则。
- `canvas-node-editor` 的 regression 必须覆盖外部 canonical 参数更新期间的 focused native composition、accepted auto/空 Custom 区分、outside pointerup/cancel 后再次 Move、实际 checkbox label 的 44px 关联目标与 editable/read-only uncancelled panel touch。jsdom/CSS source 断言不是浏览器 computed/native arbitration。
- 浏览器 fixture 必须复制/hash 当次 production inputs 和 build/helper inputs，验证 prebuild/postbuild/prebrowser/postbrowser 与包链接；source 改变使旧 browser/build verdict 失效。只复制 installed dependencies 的临时 fixture 直接通过 pinned Node 调 copied Next，不能用可能隐式 install 的 `pnpm exec`。
- 浏览器动作先 native scroll，求 visible/clipping intersection，再 `elementFromPoint` 确认真实 control。fixed overlay 使用实际 viewport/containing boundary，不与无关祖先误交集。连接后立即断言 edge + 无新 Run；不能用 DOM `.click()` 绕过被覆盖控件。
- 选择嵌套 scroller 的原生 wheel 起点时，先命中该 scroller 的可见边缘/空白，避开内部可滚动或 `overscroll-behavior:contain/none` 的 textarea；在其中心滚轮可能只滚文本而无法到达父面板控件。这是动作校准问题，不能用程序 `scrollTop` 或改产品 overflow 制造通过。
- 图片优先 fixture 必须在截图/命中前断言实际 `<img>.complete && naturalWidth>0`，不能让破图的 IMG hit target 冒充视觉通过。fake thumbnail endpoint 可给出隔离 fixture 原图 bytes，但须明确不是生产 Next optimizer/存储认证的验证；仅无 JS exception 不代表媒体已加载。
- CDP `Runtime.evaluate(returnByValue)` 只返回 scalars/plain projections，DOM-reference setup 用 `void`；selector 用 `JSON.stringify`，避免内外引号损坏或循环 DOM 序列化。gesture 不可靠先用 plain allowed/blocked controls 校准，不把 unsupported command、程序设置 scale 或 screenshot 当 native pass。
- 分别报告 native IndexedDB、exact original download bytes、fake loopback identity/HTTP、desktop-CDP dimensions/touch/composition、真实手机/native IME/OS chooser/download、真实服务和 actual CI。物理 iOS/Android 缺证据时 MA/device/rollout 保持 pending，不由自动化 mock pass 填充。
- 保存 red receipts 和独立 exit/deadline/duration/stdout/stderr；使用新标签不覆盖旧失败。task-owned before-image source copies加 `.before` 后缀，保持 exact bytes/hash，避免 `.ts/.mjs` 备份意外进入 lint/type inputs。未提交 baseline 以 byte identities 归属，不能用 `git diff HEAD` 认领已存在 untracked 源码。
- 合一创作卡的浏览器验证须区分 canonical 两节点与默认一张可见卡。覆盖完整/共享/独立 graph 切换、同卡关闭再点、低/高 zoom 下外层 Flow wrapper 的 inert/焦点/命中、原生 hand-pan 后底部图片 toolbar 与 dock/camera 无遮挡。无单测失败不等于这些组合交互已经正确；新增 component 后 fixture 的生产文件集合也须重新枚举，不能只同步旧 manifest 已知路径。

## 8. 隔离检查与 Node API 包装

- 非 DB Vitest 默认排除真实数据库套件，不代表其入口不会读取 dotenv。隔离复制当前源文件、依赖和生成输出；初始 Node 启动前清除继承的 preload、凭证及代理配置，仅精确允许已核验的公开 `.env.example`。
- 防御性 filesystem preload 不是操作系统 sandbox。包装 API 时保留返回值、回调签名、异步错误与 `util.promisify.custom`；`fs.exists` 的 callback 只有 boolean，不是 error-first。丢失其 custom promisifier 会让 `promisify(fs.exists)(existingFile)` 拒绝 `true`，Prisma CLI 因而只显示 `Error: undefined`。
- 安全回归必须覆盖同步、callback、Promise、promisified、ESM named import 和 child Node 的调用。精确公开例外为 true、隐藏 dotenv 为 false、普通存在/缺失文件保持原义；不能为工具通过而放宽 dotenv 或真实凭证边界。
- 修复检查器本身后重新执行受影响的产品门禁，保存修复前失败和修复后通过的独立回执。生成 Prisma Client 不等于数据库迁移；验证必须证明输出位于独立依赖副本，不写回正在使用的客户端。
- 合成环境保证凭证隔离，但不等于干净 CI 的前置条件。验证缺失环境问题时，必须在子进程启动前移除对应 runner 合成值，并保留 deny-env preload；不能把带全局 `AUTH_SECRET` / `DATABASE_URL` 的本地通过当作测试已自行声明依赖的证明。
- 浏览器字体证据应区分 CSS 声明、成功网络加载和实际自定义字体参与字形绘制，并记录实际请求字节数。整包字体大小不能当作首屏传输大小。
- 倾斜/过渡中的控件先用原生指针接近，再重新测量裁切交集和 `elementFromPoint`，命中后才按下。已复现的 3D/blur 合成场景中，`elementsFromPoint` 的首项可能与实际点击目标不同，不能用它放宽失败；保留原生 pointerdown/up/click 目标与真实操作结果，区分测试动作竞争和产品遮挡。
- `hover(selector, ..., [xFraction, yFraction])` 必须校验实际分数坐标，而不只是目标存在一小块可见区域；先原生滚动，再检查视口/嵌套裁切及真实命中，变换后重新测量。普通视口、嵌套滚动正例和被遮盖控件负例分别校准，不能把视口外 mouseMoved 当作成功悬停。
- 带阶梯入场的截图先等最大延迟加动画时长，必要时检查最后追加卡片及祖先的 opacity/transform；静态截图既不能证明动画经过，也不能单独证明暂时不可见是永久故障。
- 动画 cleanup 的回归要检查下一帧及后续帧，不只检查同步最终样式。真实 Motion 调度测试在帧间让出微任务，并在两个帧时间之间中断，避免库的事件循环时间缓存掩盖 stop 的迟到 render；正常完成、延迟中断和未重播是独立对照。`homepage-reveal.test.tsx` 保留真实 animate/stop，仅控制时钟、RAF 和浏览器可见性输入；真实浏览器的 MutationObserver 时间线补充验证最终 DOM 行为。

### 测试夹具的环境所有权

1. **适用范围**：单测调用真实服务/解析器，动态 import 链可能经过 auth、`db.ts` 或 `getEnv()` 时。
2. **入口**：`parseGenerateRequest(request)` 的 opt-in 路径会加载 `canvas/http -> current-user -> db -> getEnv()`；fixture 使用 `vi.stubEnv(name, value)` / `vi.unstubAllEnvs()`，不替换真实解析器。
3. **契约**：fixture 自行提供满足 schema 的公开合成 AUTH_SECRET，以及指向 `127.0.0.1:1` 的不可用测试数据库 URL。此路径只构造客户端、不查询数据库；测试结束恢复环境，不向 CI workflow 或全局 test setup 添加凭据默认值。
4. **错误矩阵**：缺少 fixture 设置且无外层变量时应能复现环境 ZodError；设置后，重复 JSON media type 仍必须拒绝为 `CANVAS_INVALID_INPUT`，单一 JSON media type 必须返回原始 `canvasRun`。
5. **Good / Base / Bad**：Good 是 fixture 自给配置、清理后恢复原状态；Base 是完整保留真实 parser 和原有正反断言；Bad 是全局补变量、mock 掉 getEnv、跳过用例或放宽媒体类型检查。
6. **必测**：`canvas-e2e-runtime-fixture.test.ts` 的真实 parser 正反例；在无 ambient AUTH_SECRET/DATABASE_URL 的独立进程执行旧文件失败、新文件通过、仅隔离副本回退旧文件再次失败，并执行完整非 DB 清单。
7. **错误与正确示例**：不要用外层 `env={AUTH_SECRET: dummy, DATABASE_URL: dummy}` 的通过证明干净 CI；应先从子进程环境移除两项，再由 suite 的 beforeEach 设置并由 afterEach 恢复，保留 dotenv 读取保护。

### 原生键盘输入与校准

- 修改 CDP 键盘辅助器或判断键盘可访问性失败时，先在独立空白 fixture 上校准普通 enabled/disabled 按钮，再操作真实页面；不能用产品控件上的 `.focus()`、`.click()` 或合成 DOM 事件替代原生输入。
- `tab.key(key, modifiers = 0)` 的第二参数直接传给 `Input.dispatchKeyEvent`，不是布尔值或枚举序号。使用共享命名位掩码 `CDP_MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }`；组合键用按位或，调用点不写含糊的数字常量。
- 一次按键发送配对 `keyDown` / `keyUp`，保留 `key`、`code`、虚拟键码和 modifiers。当前 Chromium 的 Enter `keyDown` 还需 `text: "\r"` / `unmodifiedText: "\r"` 才具有完整字符激活语义；只有 keydown/keyup 记录不能证明按钮已收到可激活的 Enter。

| 校准条件 | 必需断言 |
| --- | --- |
| 普通 enabled 按钮收到完整 Enter | 恰好一次可信 `click`，并有可信 `keypress` |
| 同一按钮 disabled 后收到 Enter | 不新增 click，不借程序聚焦恢复它 |
| Tab / Shift+Tab 遍历普通控件 | 前进/后退目标正确，两向跳过 disabled，均不激活按钮 |
| Alt+Tab 负对照 | 事件 `altKey=true`、`shiftKey=false`，不计作反向遍历 |
| Chrome GPU 退出或 CDP 在校准前关闭 | 记录为启动/环境失败，不判产品可访问性失败或通过 |

- 保存每步前后 active element、可信事件、修饰键状态、禁用控件跳过及真实业务结果。校准本身必须有负对照；修复辅助器后重跑受影响专项和完整矩阵，保留旧失败回执。
- 正例：命名 Shift 位掩码通过普通控件校准后，再验证三场景完整提示词复制和返回所选 tab；基线：未改的产品源码仍按独立哈希归属；反例：为错误的 Alt+Tab 修改页面 tabindex，或通过程序点击把失败变绿。

```js
// Wrong: raw CDP modifier 1 is Alt, not Shift.
await tab.key("Tab", 1);

// Correct: use the shared CDP bitmask after native traversal calibration.
await tab.key("Tab", CDP_MODIFIERS.Shift);
```
