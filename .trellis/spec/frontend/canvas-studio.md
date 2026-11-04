# 画布创作台前端契约

## 1. 适用范围与触发条件

- 修改 `create/generator-studio.tsx`、`create/canvas/`、画布 hooks/parts 或会话加载器时必读。服务端、原图 roots/GC 与 readiness 见 `operations/canvas-contracts.md`。
- React Flow 12.12.0 MIT core 只负责受控渲染，不能承载业务任务生命周期、另建应用全局 store 或复制 Pro 示例。沿用中文、奶油色/橙色视觉与命名导出。
- 已挂载、已启用且就绪的手机画布支持核心编辑。宽度/指针/键盘只决定展示，不能授予或撤销控制器权限；真正的只读、账户、加载和删除守卫仍不可绕过。真机目标验收与自动化实现证据分开。

## 2. 签名与所有权

```ts
type CanvasJobOrigin = Readonly<{
  ownerId: string; canvasId: string; nodeId: string; runId: string;
}>;
type CanvasJobsPort = {
  register(origin: CanvasJobOrigin, job: GenerationItem): GenerationItem;
  read(jobId: string): GenerationItem | null;
  subscribe(listener: (origin: CanvasJobOrigin, job: GenerationItem) => void): () => void;
};
type CanvasTransientLeaseInput = {
  origin: CanvasJobOrigin;
  parameters: CanvasGenerationParametersV1;
  reason: "run" | "transport-retry";
  signal: AbortSignal;
};
type CanvasEditorTarget = Readonly<{
  ownerId: string; canvasId: string; nodeId: string;
}>;
type CanvasParameterField = "model" | "size" | "outputCompression" | "negativePrompt" | "seed";
type CanvasFieldDraft = Readonly<{ text: string; base: string; invalid: boolean }>;
type CanvasViewMode = "creation" | "graph"; // Renderer-local; never scene fields.
type CanvasTool = "select" | "pan";
canvasGenerationPrompt(scene, generationId); // {prompt, sourceId, sharedPromptCount}
canvasVisibleNodeId(scene, nodeId, view); // visible canonical node ID or null
// Existing controller method; local edit only, no HTTP or new scene field.
controller.replaceConnection(canvasId, edgeId, sourceNodeId, expectedSource); // optional fourth argument; void
type CanvasInsertionBounds = { minX: number; maxX: number; minY: number; maxY: number };
type CanvasQuickGenerationInput = {
  position: CanvasPositionV1;
  placementBounds?: CanvasInsertionBounds;
  promptText?: string;
  sourceNodeIds?: readonly string[];
  parameters?: Partial<CanvasGenerationParametersV1>;
};
controller.createQuickGeneration(canvasId, quickInput); // {canvasId,promptNodeId,generationNodeId,promptEdgeId,imageEdgeIds}
controller.updateGenerationPrompt(canvasId, generationNodeId, {
  text, expectedPromptNodeId, // string | null; captured source, not latest selection
}); // {promptNodeId}
type CanvasReferenceBatchInput = {
  files: readonly File[];
  position: CanvasPositionV1;
  placementBounds?: CanvasInsertionBounds;
  attachToGenerationNodeId?: string;
};
controller.importReferences(canvasId, importInput); // {canvasId,referenceNodeIds,imageEdgeIds}
// Mounted editor port; synchronous validation before captured commands.
editor.applyPending(canvasId, nodeId); // target Run
editor.applyPending(canvasId); // all pending fields of this canvas before Save
```

- 以 `studio-bridge.ts` 为类型所有者。`useStudioJobs` 是 owner-keyed 工作台唯一 canonical cache/poller；`useCanvasDocuments` 挂载在模式切换之上，控制器不随懒加载 CanvasStage 销毁。
- `runNode(canvasId,nodeId)` 是手动新运行；`retryTransport(canvasId,runId)` 只重发原冻结意图；`recoverRuns(canvasId)` 只读。生成仍经已有 `/api/generate` 的共享 encoder/headers。
- 管理/编辑命令显式带 canvas/node ID，不能在异步回调中读取“当前选中画布”作为归属。New 在 shell ACK 前发布局部 UUID，UI 错误同样捕获该 UUID。
- `CanvasDraftStore.commit({key,expected,envelope,putBlobs,deleteBlobIds})` 只在原生事务 complete 后确认；`key=[ownerId,canvasId]`，write stamp CAS 与永久 tombstone 阻止覆盖/复活。
- `editor-state.ts` 拥有字段/目标类型；`useCanvasEditor(view,controller): CanvasEditorPort` 在懒 renderer 之上按 owner/controller 生命周期挂载，使用 `useSyncExternalStore` 订阅 feature-local registry，不引入应用全局状态库。
- `replaceConnection(canvasId: string, edgeId: string, sourceNodeId: string, expectedSource?: string): void` 经 `applyCanvasEdit` 的 `replace-connection` 分支在复制场景上校验；只替换 source，保留 edge ID/kind/target/ordinal，成功才发布。延迟缩略图替换传入旧 source，当前绑定已变则拒绝。
- `beginCanvasMove` / `previewCanvasMove` / `finishCanvasMove` 只处理捕获目标、pointer/client/world/camera；完成函数返回合法位置或 null，不执行持久化/请求。`useCanvasMobileViewport(scope?,enabled?)` 只返回 visible bounds 和 CSS variables。

## 3. 状态与持久化契约

- `GeneratorStudio` 通过 owner key 销毁旧账户请求/草稿/预览；模式与画布选择偏好挂载后读取。SSR 首屏为对话，当前 owner 挂载确认前画布只读。`canvasReadOnly = !canvasEnabled || mountedOwner !== ownerId`；媒体查询不能参与授权。新画布为空；切换不导入、不生成。
- 会话内容按 owner/conversation 分页，不读取全局/孤儿列表兜底。server props 仅 bootstrap；`router.refresh()` 更新账户信息不能覆盖草稿/选择。canvas acceptance/terminal 状态触发有界、合并的账户余额刷新。
- 场景仅保存 domain nodes/edges/viewport/accepted run bindings。任务 DTO、URL、凭证、验证码、回调、React Flow store/尺寸均为 runtime。结果 ID 为 `result:<imageId>`；完整终态批次和 `outputsHandled` 一起持久化，删除卡片不重置抑制位。
- 本地 IndexedDB `narra-canvas-drafts` v1 包含 `drafts` 与 `blobs`；Blob 原图独立 structured clone，不放进 JSON。未确认 outbox 保留非秘密冻结 projection，刷新只查原 run，不能自动 POST。
- 恢复 registered/uncertain shell 的旧本地草稿时，owner GET 的精确 `CANVAS_DELETED` 必须在 outbox/runtime 恢复之前撤销组织归属并尝试本地 tombstone。写入仍遵守原 writer CAS；失败保留诊断，不能强写其他标签页，也不能清除较新的选择。404、5xx、网络失败不是删除证明，保留原草稿/outbox。
- 批量 hydrate 之后只对当前场景绑定的 canonical cache 再做终态处理：较早结果可能曾因较晚绑定的 count 未知而被容量保护拦下。仍未知的绑定继续预留/阻止新增；pending 使用原 count。失败或结果已存在的零新增批次可标记 `outputsHandled`，不能被无关未知容量卡住；不得枚举全部 runs 或自动 POST。
- Save 捕获 scene/editRevision/deletionEpoch/expectedRevision/saveId。包括未连接、未运行的原图；上传后固定 `resolvedScene`，丢 ACK 重试使用相同输入。保存中继续编辑只改变下一次快照，不能把新编辑标为 saved。
- 相同原图复用 upload/asset 映射。旧原图失效可用本地 Blob 重新登记；清除旧映射前把 imported source 重新绑定本地 locator。未知旧运行的 transport retry 不能改写冻结身份。
- 凭证按节点仅内存保留，验证码按一次运行租约持有。等待队列、AbortSignal、旧 widget 回调及账户/只读切换必须正确释放；不能借用对话设置/验证码，不能写入 scene/outbox。
- 卡片、查看器与下载分别持有预览租约。查看器仍打开时删除卡片不使已捕获原图不可下载；`downloadCurrent` 独立 retain 到下载结束。画布查看器不显示对话“加入编辑”。
- renderer-only `CanvasNodeMeasurements` 按当前 owner/canvas 生命周期和 live IDs 缓存 dimensions，再投影到受控 Flow nodes。忽略尺寸的 domain 持久化不等于丢弃渲染尺寸；否则旧节点在无真实 resize 的刷新后会永久 hidden。
- 提示词在原生输入事件内同步本地 value，同时立即更新捕获的控制器；Flow 的被动 store 更新不得先恢复旧 textarea value。外部 canonical 文本变更仍需有守卫地接收，不能只等 compositionend 才存草稿。
- 关闭库的 document-global Delete，删除只来自聚焦 viewport；控件带 `nodrag nopan nowheel nokey`。Ctrl/Cmd+S 在字段验证/commit 后冒泡捕获快照，非法字段阻止 Save；IME keyCode229/isComposing 不触发快捷命令。
- `commands.ts` 的纯 `canvasInsertionPosition(occupied,preferred,bounds?)` 同时供创建、导入、手动插入和终态批次使用；默认间距 320x360、列距380。无 bounds 时保留旧单列扫描；有 bounds 时搜索相邻可见列，无空位则在有限可见区域重叠，而非把主要操作推出屏幕。bounds 是捕获的合法 world top-left 范围，不进 scene；旧布局不自动重排，也不承诺任意卡片无碰撞打包。

### 3.1 手机展示、字段与键盘

- `touchPresentation` 对应 `(max-width:767px), (pointer:coarse), (hover:none)`，只切换样式/手势。不能因横竖屏、visualViewport 或键盘变化重建 controller/jobs/lease，也不能改变已有冻结输入。
- 点击图片只选择，查看/下载显式执行；桌面非控件整卡片可拖动，手机保持 Browse 与显式 Move 分离。New image / Continue 直接打开不随场景缩放的唯一生成 composer；普通 Edit 与节点/来源 chooser、Locate 仍可管理旧图谱，后台终态不抢相机。端口和键盘行为保留。
- 参数 registry 以 `JSON.stringify([ownerId,canvasId,nodeId])` 为 key，仅保存五种非秘密 raw string 与 custom-size 意图。Close/选择/模式/懒卸载/布局改变不清除；删除目标、禁用或 owner 销毁只清除对应失效内容。未应用参数仅内存，不宣称刷新/驱逐可恢复。
- `CanvasPromptField` 原生事件内同步本地 text 并立即更新捕获控制器，迟到 acknowledgement 不覆盖新输入。它和 `CommitField` 接收外部 canonical 更新时必须保护 focused composition，保留字段 DOM/caret/selection；不能等 compositionend 才保存已接受提示词。
- canonical size 为 `auto` 且没有现有 size draft 时选择 Custom，先创建空的 pending size，Run/Save 不得静默使用 `auto`。从有效 preset 打开 Custom 保留该 canonical size；已有 raw draft 仍保留。共享 normalizer 接受的 `auto`/旧别名应用后显示 canonical size；preset 选择才明确清除旧 custom draft。
- `applyPending` 先验证该次捕获范围的所有 pending fields，再应用参数；成功才调用已有 Save/Run。非法值保留 raw draft，标 invalid 并打开/focus 对应节点字段；不发送请求。Save 可保存未连好的 domain 草稿，Run 仍要求完整就绪输入。
- 面板覆盖背景 Save 时使用可见 Close -> toolbar Save。Close 本身不 Save/Run，registry 仍在上层；Save 仍验证/apply 相同 pending fields。晚到 Save ACK 不能确认更新后的 raw/domain 编辑。
- 字段 Enter/IME candidate Enter229 不执行 Run；对话原有 Enter/Shift+Enter 语义保留。弹窗禁止隐式 form submit，但独立 Run/confirmation 按钮可显式键盘激活；Escape/Tab 尊重 composition 和 busy。
- 可见区域是 studio/visualViewport 的有限交集，resize/scroll/observer 更新 CSS 而不是 scene camera。短高度切换同一面板的整块 native scroll，不替换 focused DOM。非缩放字段 >=16px，主按钮、select 和 checkbox 关联 label 的有效目标 >=44x44 CSS px，考虑 safe-area。
- `.nodeEditor`、实际 `.inspectorScroll`、其 editable/read-only prompt 使用 `pan-y pinch-zoom`；目标及相关祖先共同允许 browser accessibility zoom。它们是 `.viewport` 的 sibling，不在 Flow 手势树内；事件 stopPropagation 不等于 preventDefault。画布 viewport/preview 的 `touch-action:none` 保留，不将其扩展到对话或面板。

### 3.2 连接与完成移动

- 面板提供显式来源选择、替换、断开和上下排序；image ordinal 从 1 连续排序。一个来源可连多个 target，但单 target 的 canonical duplicate、错误类型/provenance 和缺失来源都拒绝。
- replacement 必须一次复制/验证/发布，禁止先 disconnect 后 connect。controller 检查 canonical result image/job/URL 和可用 local original 或 READY asset；拒绝保持旧 edge/顺序/scene，无中间删除、上传、Run 或容量释放。
- 手机默认 browse 单指 pan/双指 scene pinch，节点不可拖动；Move 捕获 owner/canvas/node/pointer/start camera，whole-card 临时坐标仅 renderer-local。有效单指 drop 经 `moveNode` 接受一次；Done 回 browse，不手动 Save。
- 取消、第二指、失去目标、起点/相机改变、模式/布局中断不接受未完成 preview。window pointerup/pointercancel 清理离开 viewport 的指针；外部结束只能取消，不能提交位置。pointer capture 会把物理外部 release 重新路由到 viewport，因此接受路径还须检查 clientX/clientY 在真实 viewport rect 内，不能仅看 event target。监听器与 pointer state 在对应生命周期清理。
- 桌面 whole-card drag 与手机 Move 共用纯手势数学，但来源独立：桌面无需 editor Move intent，手机仍需捕获目标的 Move intent。threshold 一旦跨越便保持 moved，pointerup 用最新坐标；禁用 Flow pointer-position 写入，键盘移动由聚焦节点显式处理（10px，Shift 40px），不重新放开泛化 position callback。

### 3.3 图片优先创建与上下文控件

- 空 New 仍为空；`createQuickGeneration` 在一次 `creation-group` 候选校验/发布中创建私有 prompt、generation、prompt edge 和有序 image edges，返回捕获 ID 后选择新 generation 并打开 composer。创建、选择、导入和打开面板不调用 Run、Save 或上传。Continue 使用同画布可用图片作为 input，原图与旧结果不覆盖。
- 新参数使用账户 canvas defaults/共享 schema，不借用对话或另一个节点的秘密配置。组合增长计入未处理/未知输出预留，再验证完整 graph/refined local scene/512KiB；失败保持原 scene、selection、original map、outbox 和 reservations，无中间半组节点。
- generation 没有内嵌提示词。`updateGenerationPrompt` 先比较捕获 `expectedPromptNodeId`；存在则编辑原共享 source，并显示使用数量；expected null 且无 edge 时才在首次明确输入修复私有 prompt+edge。只打开面板不修复。textarea 按 generation target 保持 DOM，接受的修复 ID 在下个 native input 之前同步；focused 期间外部改绑拒绝旧输入，不静默改写新 source。
- `importReferences` 暂存并验证全部 File（MIME/size）、目标、容量、边和序列化场景，成功后才一起发布 originals 与节点/附加边；已有 edge ID/ordinal 不变，新输入追加。旧 `importReference` 是单文件兼容包装。原图容器/CRC 的服务端校验没有迁到浏览器。
- 工具栏/粘贴/参考图 chooser 捕获 world position 与 placementBounds；chooser 打开后的 camera 变化不能重新解释它们。显式 spatial drop 不传 bounds，继续保留真实落点/旧插入扫描。共享插入 helper 的 bounds 必须传到 controller 的最终扫描，不能只在 UI 算一个可见 preferred point。
- chooser 是明确会话：无捕获、cancel、unmount、owner/controller/readOnly 失效后不读取 latest callback。存活会话只操作原 canvas/可选 generation；删除目标拒绝。既有图的重用按 source ID，不重新导入 bytes；替换缩略图带 edge 和 expected source。
- 生成 composer 复用唯一 editor intent、raw parameter registry、apply-before-Run/Save 和 native prompt writer；primary prompt/thumbnail add/replace/remove/reorder 可见，Advanced 保存旧连接和设置。折叠时非法字段仍阻止 Run/Save，并展开后定位字段。
- `canvasComposerPlacement` / `useCanvasComposerPlacement` 使用实际节点 screen rect 与 studio/visualViewport 交集，在 Flow 缩放/手势树之外定位 fixed overlay。选择/打开仅改 CSS，不缩小 viewport、不改 camera；短手机布局切换同一 DOM 的 native scroll。所选图片 toolbar 的 View/Download 分别使用已有租约。
- 新节点可能晚于 placement effect 的首次测量进入 Flow DOM。不能在 effect 开头永久捕获一个 null node 后只观察 viewport resize；child-list mount observer 重新发现当前 target，并切换 ResizeObserver 的节点，cleanup 同时释放两者。无需伪造 resize/改 camera，首次创建的 composer 也应回到实际节点对应的可用位置（generation 按 3.4 attached）。
- 所选图片的 `CanvasImageToolbar` 同样按捕获 node ID 重新发现迟挂载/移除的 Flow card，并转移 ResizeObserver；不能只修 composer 而让新导入图片的工具栏永久停在 fallback。移除 card 后回到有限可达位置，cleanup 同时断开 mount/resize observers；原图 lease、权限和场景相机不随定位变化。

### 3.4 合一创作卡与底部工具栏

展示投影、默认创作/高级图谱、同卡重新打开、外层 wrapper inert、底部 dock
和图片控件避让契约见 [Canvas Presentation](./canvas-presentation.md)。修改
这些 renderer/UI/placement 时与本文件同时读取；存储和运行边界仍由本文件负责。

## 4. 校验与错误矩阵

| 条件 | 必须行为 |
| --- | --- |
| 断开/错误端口、重复来源、超过16张、原图未就绪 | 中文错误阻止 Run，不忽略输入、不自动运行上游。 |
| 功能关闭、当前 owner 未挂载、真实 readOnly/loading/deleting | `inactive` / `readOnly` / `loading` 或 `CANVAS_DELETED` 拒绝 mutation；不能以窄屏隐藏按钮代替守卫，也不能把窄屏本身当拒绝条件。 |
| replacement 错误类型/provenance、重复、不可用原图/结果 | `CANVAS_INVALID_CONNECTION` / `CANVAS_DUPLICATE_INPUT` / `CANVAS_INPUT_UNAVAILABLE`，原 edge ID/source/ordinal 与容量不变。 |
| quick creation/批量导入超总容量、>16输入、重复 canonical source | `CANVAS_OUTPUT_CAPACITY_EXCEEDED` / `CANVAS_LIMIT_EXCEEDED` / `CANVAS_DUPLICATE_INPUT`，完整候选不发布，不能先创建半组或先添加原图。 |
| expected prompt/edge source 已变、目标删除或错误类型 | `CANVAS_INVALID_CONNECTION` 或原删除守卫；不改新绑定、不回退最新 selection/chooser callback。 |
| 非有限/反向 placementBounds 或非法 position | `CANVAS_INVALID_INPUT`，旧 scene/originals/selection 保留；密集可见范围允许有限重叠，不移动旧节点来腾位置。 |
| raw parameter 非法或显式空 Custom | 不发送 Save/Run，保留 pending/invalid 并定位字段；不能使用上一次 canonical 参数冒充已保存。 |
| focused composition 期间外部参数更新 | 不调用 native setter 写回外部值；compositionend/blur 后再有守卫同步。 |
| Move 取消/第二指/由 viewport 接受路径以外的 window handler 处理结束/捕获目标过期 | 丢弃 preview，无 domain move/Save/Run；最近已接受位置仍保留。合法捕获 drop 可有离屏坐标，不能把有限离屏位置一概拒绝。 |
| creation 切换时选中独立或多 target prompt | 关闭对应可见编辑/选择，原 source/edge/draft 保留；不随意选一个 generation 或自动重绑。 |
| 桌面 editor 替代卡片、pan tool 或底部 dock 遮挡 | 禁用不可见 wrapper 命中/焦点；pan 不移动节点；按实际 dock/toolbar 尺寸重算位置，不能用清空选择、改 camera 或程序点击绕过。 |
| 本地 quota/blocked/timeout/版本错误 | 保留内存和原记录，显示未确认/失败；禁止空场景替换或假报持久化。 |
| 同浏览器 writer CAS 或云 revision 冲突 | 保留本地草稿，不自动 merge/force-save；显式警告后才重载账户快照。 |
| Save ACK 晚于编辑/删除/账户切换 | 仅确认对应捕获快照；新编辑仍 dirty，删除内容不复活，其他账户不接收。 |
| 生成 fetch/JSON 超时或 ACK 不明 | 保留原 outbox/runId，只读恢复或用户显式原请求重试，不换 runId。 |
| 待接受/未处理输出容量未知 | 保留原 count 预留或阻止增加节点，不用当前编辑 count 覆盖原任务容量。 |
| 删除 node/canvas 后成功 | canonical job 保留在作品；移除组织，不发送 cancel/refund/媒体删除。 |
| 云端已删除但本地 tombstone 曾失败 | 精确 owner 删除响应先关闭恢复/结果归属；CAS 写墓碑失败仍不显示旧组织，不强制覆盖其他 writer。 |
| renderer 渲染失败 | 可原地重试或返回对话，保留上层控制器/草稿，不重发任务。 |
| `ChunkLoadError` | Turbopack 会缓存被拒绝的 chunk promise；新建 lazy loader 不代表能重试网络。明确提示先保留未发送内容、确认本地保存后手动刷新；保留返回对话，不显示无效重试、不自动刷新或提交。 |

客户端 fetch **和 JSON 解析**均受 deadline/epoch/abort 限制：`STUDIO_READ_TIMEOUT_MS` 统一普通画布/会话读取30秒、原图90秒、提交120秒。会话超时释放 loading，保留已加载内容并重试原分页游标；切换/卸载即使底层忽略 abort 也要结束等待且拒绝迟到写回。shared poller 每次读取15秒，并保持原有退避、隐藏暂停、前台补拉、终态停止和次数上限。

## 5. Good / Base / Bad

- Good：对话草稿未发送时切换画布，保存未使用原图；另一浏览器只恢复成功 snapshot 并运行该原图，不重新上传。
- Base：功能关闭仍使用既有对话编辑/重试/取消；启用且就绪的手机编辑同一 scene v1，真实只读状态仅浏览。
- Good：Close 保留非法 seed，重新打开仍可修正；显式 Save/Run 验证同一捕获目标。拒绝重复来源替换后原 edge/顺序仍可用。
- Good：空画布一次 New image 打开已连接 composer，Enter 只换行，明确 Run 才发送；从图片 Continue 新建目标，旧图/结果仍可查看下载。
- Good：默认只有一张创作卡，完整 prompt/source/edges 仍存在；高级图谱可编辑共享/独立提示词，切回默认不改变原布局和任务。
- Base：旧共享提示词依然共享；远处旧 prompt 与密集旧列不影响可见 primary insertion，旧 node/edge/coordinate 保留，chooser 在相机变化后仍使用捕获 world 范围。
- Bad：分别发布 prompt/generation/connect，导入最后一张失败却保留前几张；用 latest prompt/selection 替代捕获身份；仅换可见 preferred 点而让 controller 再次无界扫描到屏外。
- Bad：横屏变窄撤销 lease；移动途中写本地坐标；把空 Custom 当 `auto`；只给面板子元素允许 pinch 而父层仍禁止。
- Bad：刷新枚举所有 runs 重建画布；保存 metadata 就把 scene 标为 saved；丢 ACK 换 run；删除布局后取消任务；把 measured/URL/token 写进 scene。
- Bad：隐藏独立 prompt 就删除其数据；只 inert article 却留下 Flow 外层透明命中区；关闭 editor 后仅等待 selection change 重开；用固定 toolbar 高度导致底部动作被 dock 覆盖。

## 6. 必需回归

- `use-studio-jobs`、`use-image-poller`、`generator-studio-origins`：单 poller/owner epoch/迟到响应、终态单调、失败 Delete catch-up、不污染当前空间。
- `canvas-draft-store`、`canvas-controller-*`、`canvas-reference-runtime`、`canvas-client-api`：原生事务 ACK/CAS/Blob/tombstone、captured Save/继续编辑、原图复用/失效恢复、outbox/容量/一次 materialization。
- `canvas-controller-runs/documents`：删除 ACK 后本地 quota/CAS 失败再重载、uncertain shell 的精确删除与不可用负例；新设备无 outbox 的多个终态绑定全部恢复且只一次；未知/pending 同级绑定的容量保护及零新增失败收尾。
- `use-conversation-generations`：分别卡住 fetch 与 JSON，验证30秒超时后原游标重试；忽略 abort 的 Promise 不能保留 loading 或覆盖新的会话内容。
- 会话分页与删除后作品保留还需 `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts` 的真实 SQL 回归；mock loader 或画布 UI 测试不能证明旧会话完整恢复、owner 游标隔离或生产 DELETE 到作品查询的保留链路。断言边界见 `operations/canvas-contracts.md`。
- `generator-studio-canvas`、`use-canvas-runtime-lease`：真实 root/controller/encoder、节点凭证与一次性验证码、模式/账户/手机隔离、下载 hold、余额刷新与默认设置。
- `canvas-stage`、`canvas-renderer-adapter`、`canvas-terminal-placement`：端口/明确排序、IME native setter 不回写旧值、只读/键盘、尺寸变化仅 renderer-local、无额外 resize 后 Save/rename/run 仍可见、重跑结果不覆盖旧坐标。
- 原生浏览器必须验证真实 Next SSR/lazy hydration、原生 IndexedDB/F5、桌面/手机视图和 IME/焦点。jsdom ResizeObserver 不得在无尺寸变化时伪造通知掩盖问题；settled value 断言不能证明 composition 未被打断。
- 懒加载恢复需真实拦截 production chunk 请求：确认错误被捕获、没有无效原地重试/自动刷新、返回对话保留未发送草稿，用户明确刷新后可重新打开且不重发任务。仅 mock `dynamic()` 成功不能证明 bundler 网络恢复。
- 真实账户/数据库/Worker/存储测试与 fake HTTP 浏览器 fixture 分开报告；未执行 SQL/GC/runtime 门禁不算通过。
- `canvas-controller-connections`：prompt/image 原子替换、错误类型/provenance/canonical duplicate/missing source 原 scene 不变；边 ID/ordinal、容量、原结果反馈和多 target 复用保留，无 Run。
- `use-canvas-editor`、`canvas-node-editor`：实际 root/controller、五种 raw drafts/空 Custom、accepted auto 显示、Close/mode/owner/delete 边界、apply-before-capture 和 newer Save ACK；native setter/selection 覆盖 focused external composition。
- `canvas-mobile-interaction`、`canvas-mobile-viewport`、`canvas-stage`：whole-card preview 与一次完成、outside pointer completion 后下一次 Move、第二指/cancel/stale camera 零提交、测量清理/finite bounds/稳定 DOM；read-only 和 editable editor 都保留未取消 native touch defaults。
- `canvas-quick-creation`：完整一次发布、私有/共享/缺失提示词、expected source、原子批次与 invalid-last-file/capacity/bytes/source 拒绝、无自动 Run/Save/upload；非法 placementBounds 也不发布 originals。
- `canvas-image-first-stage`、`canvas-composer-placement`：真实 stage/composer 的原生输入/修复 ID 立即确认、缩略图原子顺序、整图选择/拖动、捕获 chooser、稳定 textarea/短 overlay；24-node/32-edge 密集旧图加 far-off prompt 和 zoom 必须验证新 generator 可见、旧布局不变、chooser bounds 冻结。只测一个离屏旧 prompt 不足以证明 dense placement。
- placement hook 先在 target DOM 不存在时得到 bounded fallback，再真实追加 Flow node、保持 camera/region dimensions 不变，必须跟随 actual node rect；桌面 generation 的 attached 模式验证同卡锚点，其他面板保留旁侧定位。不能只凭面板始终可见当作跟随证明。
- `canvas-unified-view` / `canvas-renderer-adapter`：default 一卡一编辑器、完整/共享/独立 graph 无损切换、唯一/歧义 source 映射、恢复 prompt selection、同卡关闭后 click/subthreshold reopen、pan 零 node move、readOnly 无文件 input；replaced 外层 wrapper 不可焦点/命中但保留 ID/尺寸，关闭后恢复。
- `canvas-image-first-stage` 与 native fixture：图片 top 接近 viewport bottom，toolbar 按自身高度避开两个 dock，resize/visualViewport 后仍可用；先 native hand-pan 到边缘，再实际 hit-test/打开 View，不能通过调整图片坐标或 DOM click 造通过。`generator-studio-canvas` 旧节点回归显式进入 graph，primary 回归用创作提示词而不是隐藏的 source textarea。
- 图片工具栏也需真实追加/移除 Flow card 的 regression，无额外 viewport resize；card 的 `getBoundingClientRect` fixture 只覆盖该实例，不能用共享 prototype spy 同时改掉 viewport 几何。测试 finally 移除额外 DOM，源码复核两个 observers 均在 cleanup 断开，避免后续 stage 测试被污染；当前行为回归不冒充独立的 observer-disconnect 断言。
- 真浏览器测量/命中 checkbox 关联 label 与短布局确认按钮；scroll 到实际可见区域并检查 hit target，不能向剪裁外坐标或被面板覆盖的 Save 点击后宣称正确操作。native page pinch 必须改变 browser scale 而保持 scene camera；scene pinch 应改变 scene camera。两者均不得触发 Run/Save。
- 新 source 冻结后重新复制/hash 真实组件/lib/contracts/CSS、直接使用 pinned Node + copied Next 构建并核对 package links。fixture browser 使用 loopback dummy identity/HTTP、原生 IndexedDB 和原图 bytes，不继承旧 renderer 浏览器通过记录。
- 手机主要目标是 iOS18+ Safari、Android12+ Chrome 当前/前一稳定主版本、>=360 CSS px；测试 360/390/430 portrait、landscape/short viewport、24-node/32-valid-edge 与 200-node smoke。模拟 dimensions/CDP IME/touch 不是物理机、原生输入法、OS chooser/download、实际 CI 或服务认证。
- 真实手机/native IME/keyboard/safe-area/accessibility zoom/OS 下载仍是 MA/device gate，未执行明确 pending；代码自动化可完成，但不能标全 MA、归档或宣称 rollout ready。

## 7. 错误与正确示例

```ts
// Bad: a transparent article leaves Flow's wrapper interactive.
data.editorReplacesCard = true;

// Good: retain canonical ID/measurements, disable the replaced wrapper too.
const wrapper = { focusable: false, selectable: false, draggable: false,
  connectable: false, domAttributes: { inert: true, "aria-hidden": true },
  style: { pointerEvents: "none" as const } };
```

```tsx
// Bad: Flow later forwards node.text; React may restore the prior native value.
<textarea value={node.text} onChange={(event) => actions.updatePrompt(node.id, event.target.value)} />

// Good: synchronous input value plus immediate captured domain update.
<textarea value={input.text} onChange={(event) => {
  const text = event.target.value;
  if (actions.updatePrompt(node.id, text)) setInput({ source: node.text, text });
}} />
```

```ts
// Bad: library data (measured/status/URL) becomes the saved document.
saveScene(flow.toObject());

// Good: keep measurements in renderer, save only the validated controller scene.
setMeasurements((current) => updateCanvasNodeMeasurements(current, liveNodeIds, changes));
controller.saveCanvas(capturedCanvasId);
```

```ts
// Bad: a rejected new source has already removed the old connection.
controller.disconnect(canvasId, edgeId);
controller.connect(canvasId, nextSource, targetId);

// Good: validate the copied candidate; rejection publishes nothing.
controller.replaceConnection(canvasId, edgeId, nextSource);
```

```ts
// Bad: viewport changes cancel editing capability and runtime leases.
const readOnly = !isDesktop;

// Good: capability and presentation have separate owners.
const { canvasReadOnly, touchPresentation } = useStudioMode(ownerId, canvasEnabled);
```

```ts
// Bad: the visible preferred point is lost in the controller's unbounded second scan.
controller.createQuickGeneration(canvasId, { position: visibleWorldPoint });

// Good: preserve the captured legal world region through final candidate placement.
const created = controller.createQuickGeneration(canvasId, {
  position: captured.position, placementBounds: captured.placementBounds,
  sourceNodeIds: captured.sourceNodeIds,
});
editor.open({ ownerId, canvasId, nodeId: created.generationNodeId });
// Explicit Run remains a separate command after pending-field validation.
```
