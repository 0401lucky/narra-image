# 首页交互与隔离契约

## 1. 适用范围与触发条件

修改首页视觉、精选分页、提示词操作、共享导航的首页变体或装饰动效时阅读本规范。首页代码位于 `src/components/marketing/homepage/`，不能借此改变创作台、全局主题、账户鉴权或画布草稿。

## 2. 入口与签名

- `Home` 保持动态 Server Component，匿名精选使用 60 秒标签缓存；登录用户带 `viewerId` 独立读取。
- `FeaturedGallery({ works, initialHasMore?, initialNextCursor?, initialError?, isAuthenticated? })` 接收共享 `SerializedFeaturedWork[]`，父页面以 `currentUser?.id ?? "guest"` 为 key。
- `useFeaturedGallery()` 返回普通命令 `loadMore(source?: "manual" | "auto")`；按钮和 IntersectionObserver 调用同一个命令，不从按钮调用 effect-only 回调。
- `requestGalleryJson(url, { controller, method? }): Promise<unknown>` 统一约束 fetch 和 JSON 解析；`useWorkLike()` 独立持有每张作品的真实点赞结果。
- `SiteHeader`、`HeaderShell`、`MobileNav` 的 `variant` 为 `"default" | "home"`，默认分支保留既有行为。

## 3. 状态、数据与样式契约

### 精选与提示词

- 每页 16 项、首页最多 72 个唯一 ID。按返回顺序合并，不在客户端解码或另排服务端复合游标。
- `featuredPageResponseSchema` 校验分页响应，`featuredWorkResponseSchema` 将缺失的公开权限标记默认设为 `false`，`workLikeResponseSchema` 校验点赞 ACK。公开数据规则见 [Public Work Data](./public-work-data.md)。
- 挂载后的数组、游标和点赞结果属于本地会话；同用户 `router.refresh()` 不覆盖它们。实际 viewer 改变通过父 key 重挂载隔离。
- 同步 ref 持有请求锁和权威快照。下一游标必须在释放锁前提交，不能依赖 React render/transition 何时完成。
- 首次读取失败与真实空画廊分开。后续请求失败保留作品与重试游标；失败或仅返回重复记录时暂停自动翻页，保留显式操作。
- 复制使用完整、获准公开的正向提示词；`usePromptClipboard({ text, identity })` 返回 `idle | copying | copied | manual`。权限拒绝、无 Clipboard API 或 5 秒等待超时进入可选择的完整文本降级，不能提前显示成功。
- 做同款仅使用现有 `/create?prompt=`，不附带负向提示词、模型、参考图、会话创建或运行请求。匿名用户登录后返回重选，不添加暗中续接；保留画布模式，手动切回对话查看预填。
- 已批准的画廊链接预算由 `GALLERY_REMIX_MAX_TARGET_BYTES = 8192` 单点定义。先用原始全文构造 `/create?prompt=${encodeURIComponent(prompt)}`，编码成功后结果全为 ASCII，其 length 就是请求目标字节数；必须计入路径/query 前缀。不超过预算才渲染预填链接，超过预算或孤立 surrogate 编码失败则改用完整复制／手动粘贴，不改写或静默截断原文。
- 手动路径保留完整 textarea、复制成功/拒绝/缺失/超时及全选降级，并用 `aria-describedby` 将解释关联到文本、复制按钮和普通入口。成员入口仅 `/create`，访客仅 `/login`，不带 prompt、next 或隐式续接；复制不导航，进入创作台不自动粘贴或覆盖草稿，保存画布模式时仍由用户手动切回对话。
- create 的前 8000 个 JS 单元预填及输入上限保持不变。允许的 8001 ASCII 链接保留既有预填截取说明；手动文本超出输入上限时说明先缩短再粘贴，但复制始终是完整原文。大量中文/表情直接构造的 URL 仍可能 HTTP 431：这是未改的传输边界，不把 8192 字节策略当成所有反向代理都能通过的保证，也不能为此扩大 HTTP 限制。

### 固定示意素材

- `HERO_SCENES` 的 `image` 指向 `public/marketing/home/` 下版本化的本地 PNG，`width` / `height` 必须等于最终文件的实际尺寸，而不是生图请求尺寸。当前三图实际为 1448x1086，原请求 1536x1152；保持 4:3 画框并给真实 `<img>` 下发相同尺寸。
- 场景、标签、完整 Prompt 和图片仍按一次解码结果原子提交，不从真实精选里随机取图替代固定示例。候选图的来源、请求提示词、实际尺寸和 SHA-256 留在任务证据中；不携带凭证或伪造站内生成记录。
- 有缺陷的候选保留在任务证据，不发布到 `public/`。当前雨巷采用 `jiangnan-rain-v2.png`，不得把被拒绝的 v1 复制成另一个已获验收的同名文件。
- 文件头/尺寸测试只证明静态文件契约，不能代替真实浏览器解码和画面检查。字体文件名也不是内容哈希；保留独立来源/字节哈希记录，用 WOFF2 长度、CSS 声明和实际字形验证交付。

### 首页隔离

- 暖纸色、纹理、字体应用在 CSS Module 的首页 scope 内，不替换 `:root`、`body` 或已有字体变量。
- 使用自托管的 `NarraHomeCormorant`、`NarraHomeNotoSerifSC`、`NarraHomeJakarta` 别名；保留官方 WOFF2、Unicode ranges 和许可证。别名防止路由残留 CSS 激活其他页面的全局字体回退。
- 首页 header 不随向下滚动隐藏；默认变体继续原逻辑。首页抽屉通过 body portal 避免毛玻璃/变换祖先限制，恢复既有 inert、滚动样式与焦点。
- 共享页面转场门板的离屏阴影曾留在首页边缘。只用首页局部 `:has(.page)` 条件隐藏其兄弟 gate，不改共享布局、不提升首页至极高 z-index；默认路由仍保留其 gate。
- 画廊入场 wrapper 与 3D tilt root、裁切图片层、glare/info 景深层分开。只裁切图片，不能把整个 preserve-3d 根放入会扁平化的滤镜/裁切容器。
- 首屏与画廊的景深边界不同：`heroFrame` 保留整体倾斜，`sceneStage` 通过 `isolation: isolate`、`transform-style: flat` 和 `translateZ(0)` 形成内部合成平面，`sceneViewport` / `promptOverlay` 分别位于 z-index 0 / 1。真实图片的缩放动画和面板 blur 不能穿过该边界拦截复制按钮；不要靠移除倾斜、禁用真实图片或强制点击掩盖命中错误。
- 手机宽度不超过 639px 时，提示词面板在图片下方正常排版；4:3 约束属于 `sceneViewport`，不是图片与文本合计高度。640px 起保留画内面板。完整 Prompt、复制、重试和打字机不因版式变化被截断或移除；检查提灯与雨巷倒影没有被手机面板盖住。
- `HomeReveal` 保留原有一次性播放、delay、duration、ease 和位移常量，使用 `animate(0, 1, { onUpdate })` 驱动局部 opacity / translateY。回调先检查 disposed；cleanup 先失效回调，再 stop，最后恢复 opacity 1 / transform none。不要改回 `animate(element, ...)` 后仅同步覆盖样式：Motion 的 DOM VisualElement 可在 stop 后下一帧把中间值写回来，导致内容永久半透明；换成 cancel 也不自动保证最终可读状态。

## 4. 校验与错误矩阵

| 条件 | 结果 |
| --- | --- |
| 按钮与 observer 同 tick 请求 | 一次在途请求，不重放旧游标 |
| 相同/已消费游标，分页形状错误 | 保留已有数据并显示可重试错误 |
| 合法下一页仅重复 ID | 推进服务端游标但暂停自动循环，允许手动继续 |
| 已达 72 / 服务端已结束 | 分别标注展示上限 / 当前精选结束，不伪造总量 |
| fetch 或 JSON 15 秒未完成 | 中断等待、释放 loading/锁；即使底层忽略 abort 也拒绝迟到状态写入 |
| 点赞 401 / 非法 ACK / 请求失败 | 沿用登录跳转 / 保留原状态并如实报错；不自动重试切换式 PUT |
| 公开标记 false/缺失或文本空白 | 不提供提示词复制/做同款，不请求隐藏详情绕过权限 |
| 场景图片失败/超时 | 保留一致的已提交图像与文案，提示错误；不冒充场景加载成功 |
| 全文编码请求目标超过 8192 字节或编码失败 | 不渲染预填 href；保留原文复制、明确手动粘贴说明及无 query 的普通创作台/登录入口 |
| observer 不可用或抛错 | 内容仍可见，手动分页仍可用 |
| 减少动效、暂停、离屏、隐藏标签或卸载 | 停止对应装饰工作，主要按钮仍可操作 |

## 5. Good / Base / Bad

- Good：延迟提交的 React 渲染期间再触发翻页，仍请求下一正确游标；账户切换不显示上个账户的点赞状态。
- Base：桌面四列 4:5 缩略图居中裁切，详情继续使用完整原图；鼠标、触摸和键盘能分别查看、点赞、展开、复制。
- Bad：把未公开提示词说明当作可用 Prompt；将错误页当空数据；每张卡片建立无限 idle RAF；用静态截图证明动画生命周期。

## 6. 必需测试与动效检查

- `featured-gallery.test.tsx`、`use-featured-gallery.test.tsx`、`featured-gallery-likes.test.tsx`、`featured-response-validation.test.ts`：页数/上限、同步竞争、延迟渲染、循环游标、异常/超时/忽略 abort、viewer 切换、完整公开文案及独立控制。
- `gallery-remix-fallback.test.tsx`：包括前缀的 8191/8192/8193 字节边界、保留空白/换行/保留字符/组合 Unicode、8000/8001 ASCII、长中文/表情和非法 surrogate；成员/访客、严格公开权限、复制完成前不报成功、Clipboard 失败/缺失/超时全选、无导航/请求/存储副作用、键盘和关联说明。浏览器另验真实画廊入口、原生触摸/键盘、复制全文、无 query 跳转及保存模式/草稿不被覆盖。
- `homepage-hero.test.tsx`：三场景原子提交、快速往返与迟到 decode、同 URL 重试重挂载、完整提示词复制；受控图片测试不证明真实素材已交付。
- `homepage-assets.test.ts`：只解析受限本地素材路径并验证 realpath 仍在公开根目录内；检查三图 PNG/IHDR/IEND、实际尺寸与场景声明相同、4:3、独立内容及被拒绝文件未发布。字体覆盖全部本地 URL、WOFF2 长度、原始样式/字重/Unicode shards 和三份 OFL；浏览器另验自然尺寸、真实渲染及实际字形。
- `homepage-motion.test.tsx`：暂停/reduced/hidden/coarse、指针帧合并、粒子 DPR/数量边界、定时器/RAF/observer cleanup、追加卡片不重播已有入场、剪贴板跨 identity 清理。
- `homepage-reveal.test.tsx`：使用真实 Motion 调度器，先证明正常/延迟入场，再在离屏、隐藏、reduced、暂停、卸载时中断；逐帧检查清理后的最终样式不被迟到渲染覆盖，恢复状态不重播且帧队列最终清空。同步 mock 的 stop 和即时样式断言不足以覆盖该竞争。
- `homepage-header-footer.test.tsx`、`homepage-page.test.tsx`：真实账户组件接线、default/home 隔离、抽屉焦点/滚动/inert 恢复、SSR cache/viewer/error/空态及实际链接。
- 浏览器检查真实字体加载与实际字形、正常/受限动效、触摸命中和页面导航。等入场最大 delay 加 duration 后才能拍 settled 截图；不要把中途 opacity=0 当作永远隐藏，也不要只凭最终截图证明运动。
- 首屏复制必须用已解码的最终图片验证：三场景打字未完成、快速往返和各倾斜方向的鼠标操作，以及暂停/reduced、触摸、键盘下均复制完整已提交文本。CSS 源码或 `fireEvent.click()` 回归不能代替原生命中；缺图路径通过也不能证明真实图片合成后按钮可点击。320/390/768/1024/1440 完整画框截图及 639/640 边界另验图片比例和提示词布局。
- 六组动效分别验证：首屏倾斜/浮尘、切图/打字机、数字缓动、能力追光/微交互、画廊反光/景深、楼层渐显/级联。
- 真实浏览器另验入场中断与级联：正常滚动或暂停后卡片完全可见，后续帧不回退到半透明/残余位移。保留原生滚动、样式变更时间线及红/绿证据，不能因为测试 hover 坐标有问题就忽略独立复现的动画清理缺陷。

## 7. 错误与正确示例

```tsx
// Wrong: deferred UI commits can leave the old cursor visible after unlock.
startTransition(() => setNextCursor(page.nextCursor));
inFlight.current = false;

// Correct: publish the authoritative command state before releasing its lock.
snapshot.current = { ...snapshot.current, nextCursor: page.nextCursor };
setView(snapshot.current);
inFlight.current = false;
```

页面/服务模拟、固定图片示意和真实服务 E2E 必须分别报告。工具未产出的图片、已知长 URL 失败及未运行的固定版本验证不能由其它绿色测试填补。
