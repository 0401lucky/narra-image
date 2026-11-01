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
- **依赖 mock 用 `vi.mock` + `vi.hoisted`** 声明 mock 函数，模块级 mock 放在 import 之前：

```ts
// src/tests/unit/external-v1-routes.test.ts
const { mockRequireApiUser, mockRunExternalGeneration } = vi.hoisted(() => ({
  mockRequireApiUser: vi.fn(),
  mockRunExternalGeneration: vi.fn(),
}));
vi.mock("@/lib/generation/external-api", () => ({ runExternalGeneration: mockRunExternalGeneration }));
```

- 测试环境变量：需要 `getEnv()` 的测试在 `beforeEach` 显式设置 `process.env.AUTH_SECRET` / `DATABASE_URL` 等（不依赖 `.env`）。
- `server-only` 在测试中由 `vitest.config.ts` alias 到 `src/tests/setup/server-only.ts`。
- DB 集成测试必须带哨兵（`WORKER_CONTRACTS_REQUIRE_DB=1` + `TEST_DATABASE_URL`），禁止回退开发库（见 `generation-worker-contracts.md`）。

## 4. 验证命令

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run --testTimeout=30000 # 非 DB 全量；默认排除两个带哨兵的 DB suite
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
- 新增文件也要执行 `git diff --cached --check`。原始 OFL 许可和 `.before` 取证副本必须保留字节；`.gitattributes` 的空白例外仅限这些明确路径，不能扩展到真实源码、任务脚本或自行编写的文档。真实源码末尾多余空行应修正，并以新哈希重新绑定验证，不能把旧回执标作新字节的验证结果。
- `eslint.config.mjs` 仅将 `.trellis/tasks/**` 的历史测试夹具、第三方参考代码和生成快照排除于常规源码 lint；`src/`、生产 `scripts/` 和非任务工具不能随之被排除。`eslint-scope.test.ts` 用真实 `ESLint.isPathIgnored()` 保留任务路径负例与应用/测试/脚本正例。提交任务记录前需在凭证隔离、包含候选任务工具的 checkout 上执行 `eslint .`，不能只凭不含 metadata 的源代码快照宣称根目录 lint 通过。

## 5. 已知约束

- 全量 vitest 需 `--testTimeout=30000`（部分组件测试冷启动较慢）；默认和 CI 都排除 `worker-contracts-db.test.ts`、`canvas-contracts-db.test.ts`，分别由独立 wrapper 和显式 runner config 覆盖，不能把排除当成 DB 验证通过。
- 多个隔离测试/构建同时运行导致 Node worker OOM 时，保留失败回执，先串行调度重任务，再用 `vitest run --testTimeout=30000 --maxWorkers=2` 重跑完整非 DB 清单并记录有限总截止。不得将部分完成的测试数合并成全量通过，也不能删除测试或修改生产内存限制来掩盖检查进程崩溃。
- Canvas DB wrapper 使用独立 360 秒截止及 20 秒清理预留，不嵌套到 Worker 的 57 秒父截止。缺少哨兵或 runner 自建 localhost 数据库必须失败；本地镜像缺失返回前置条件失败，不拉取镜像、不回退 `.env`。
- 验证环境显式隔离构建与测试：仅构建注入非 loopback 的测试 `APP_URL`；要求缺失/默认环境的测试不得继承它。Prisma 使用隔离 config 或精确 `.env` 读取保护，禁止读取开发凭证。
- Windows wrapper 会通过命令 shell 执行 `pnpm`；含 `=>`、重定向等字符的内联 JavaScript 不得经 `pnpm exec node -e` 传入。改用脚本文件和直接 Node argv，防止意外重定向写入工作区。
- 每个验证 wrapper 保留真实退出码并受全局截止保护（见各 `verify-*.mjs`）。
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
- CDP `Runtime.evaluate(returnByValue)` 只返回 scalars/plain projections，DOM-reference setup 用 `void`；selector 用 `JSON.stringify`，避免内外引号损坏或循环 DOM 序列化。gesture 不可靠先用 plain allowed/blocked controls 校准，不把 unsupported command、程序设置 scale 或 screenshot 当 native pass。
- 分别报告 native IndexedDB、exact original download bytes、fake loopback identity/HTTP、desktop-CDP dimensions/touch/composition、真实手机/native IME/OS chooser/download、真实服务和 actual CI。物理 iOS/Android 缺证据时 MA/device/rollout 保持 pending，不由自动化 mock pass 填充。
- 保存 red receipts 和独立 exit/deadline/duration/stdout/stderr；使用新标签不覆盖旧失败。task-owned before-image source copies加 `.before` 后缀，保持 exact bytes/hash，避免 `.ts/.mjs` 备份意外进入 lint/type inputs。未提交 baseline 以 byte identities 归属，不能用 `git diff HEAD` 认领已存在 untracked 源码。

## 8. 隔离检查与 Node API 包装

- 非 DB Vitest 默认排除真实数据库套件，不代表其入口不会读取 dotenv。隔离复制当前源文件、依赖和生成输出；初始 Node 启动前清除继承的 preload、凭证及代理配置，仅精确允许已核验的公开 `.env.example`。
- 防御性 filesystem preload 不是操作系统 sandbox。包装 API 时保留返回值、回调签名、异步错误与 `util.promisify.custom`；`fs.exists` 的 callback 只有 boolean，不是 error-first。丢失其 custom promisifier 会让 `promisify(fs.exists)(existingFile)` 拒绝 `true`，Prisma CLI 因而只显示 `Error: undefined`。
- 安全回归必须覆盖同步、callback、Promise、promisified、ESM named import 和 child Node 的调用。精确公开例外为 true、隐藏 dotenv 为 false、普通存在/缺失文件保持原义；不能为工具通过而放宽 dotenv 或真实凭证边界。
- 修复检查器本身后重新执行受影响的产品门禁，保存修复前失败和修复后通过的独立回执。生成 Prisma Client 不等于数据库迁移；验证必须证明输出位于独立依赖副本，不写回正在使用的客户端。
- 浏览器字体证据应区分 CSS 声明、成功网络加载和实际自定义字体参与字形绘制，并记录实际请求字节数。整包字体大小不能当作首屏传输大小。
- 倾斜/过渡中的控件先用原生指针接近，再重新测量裁切交集和 `elementFromPoint`，命中后才按下。已复现的 3D/blur 合成场景中，`elementsFromPoint` 的首项可能与实际点击目标不同，不能用它放宽失败；保留原生 pointerdown/up/click 目标与真实操作结果，区分测试动作竞争和产品遮挡。
- `hover(selector, ..., [xFraction, yFraction])` 必须校验实际分数坐标，而不只是目标存在一小块可见区域；先原生滚动，再检查视口/嵌套裁切及真实命中，变换后重新测量。普通视口、嵌套滚动正例和被遮盖控件负例分别校准，不能把视口外 mouseMoved 当作成功悬停。
- 带阶梯入场的截图先等最大延迟加动画时长，必要时检查最后追加卡片及祖先的 opacity/transform；静态截图既不能证明动画经过，也不能单独证明暂时不可见是永久故障。
- 动画 cleanup 的回归要检查下一帧及后续帧，不只检查同步最终样式。真实 Motion 调度测试在帧间让出微任务，并在两个帧时间之间中断，避免库的事件循环时间缓存掩盖 stop 的迟到 render；正常完成、延迟中断和未重播是独立对照。`homepage-reveal.test.tsx` 保留真实 animate/stop，仅控制时钟、RAF 和浏览器可见性输入；真实浏览器的 MutationObserver 时间线补充验证最终 DOM 行为。

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
