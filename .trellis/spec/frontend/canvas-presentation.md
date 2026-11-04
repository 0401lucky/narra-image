# 画布展示与工具契约

## 1. 适用范围

修改 `renderer-adapter`、generation/card/editor、底部工具栏、图片工具栏或
screen-space placement 时必读；与 [Canvas Studio](./canvas-studio.md) 的
owner、scene v1、Run/Save、输入和租约规则同时适用。本文件只管理展示与交互，
不定义第二份存储、运行或提示词模型。

## 2. 签名

```ts
type CanvasViewMode = "creation" | "graph";
type CanvasTool = "select" | "pan";
canvasGenerationPrompt(scene, generationId); // {prompt, sourceId, sharedPromptCount}
canvasVisibleNodeId(scene, nodeId, view); // canonical visible ID or null
canvasFlowNodes(active, readOnly, actions, measurements, presentation);
canvasFlowEdges(scene, readOnly, selectedEdgeId, selectedNodeId, view);
// presentation: {touch, capturedDrag?, editorNodeId?, view?, tool?, preview?}
```

这些类型归属 feature renderer；view/tool/measurements 不写入 scene。

## 3. 展示与交互契约

- 默认 `creation` 展示隐藏 prompt 卡及 `prompt-input` 渲染边，每个 generation 对应一张创作卡；`graph` 展示全部原图谱。`canvasFlowNodes` / `canvasFlowEdges` 的兼容默认仍为 graph，CanvasStage 显式传入当前 view。仅改变受控投影，不删除 domain 节点、改 source ID、复制提示词或迁移 scene v1。
- `canvasGenerationPrompt` 从 canonical prompt edge/source 派生文本与共享数量；独立 source 是权威，生成卡不保存第二份提示词。共享 source 下一次运行仍同时受编辑影响，编辑器先显示共享提示。冻结运行不变。
- `canvasVisibleNodeId` 在 creation 视图中只将单 target 的 prompt 映射到对应 generation；独立/多 target prompt 返回 null。明确选择/编辑/Locate prompt 进入 graph；切回 creation 时映射唯一 target，无法无歧义映射则关闭该可见编辑/选择，不丢草稿。保留的 prompt editor/selection 恢复时须展示 graph。
- Fit 只针对当前渲染节点；folded 节点的 measurements 仍以 canonical live IDs 保留。Locate 折叠 source 先展开，等待实际 Flow 节点挂载再定位。切换 view 或打开 editor 本身不修改 camera，显式 Locate/Fit 才修改。
- 合一只表示用户界面：移动、删除仍指向 generation ID。删除生成卡不级联删除提示词、结果、原图或任务；遗留 source 可从高级图谱/节点列表访问。
- 桌面选中 generation 后，唯一屏幕尺寸 editor 占据该卡的屏幕锚点；原预览保留尺寸但不可见。必须同时禁用 Flow **外层 wrapper** 的 focusable/selectable/draggable/connectable，设置 inert/aria-hidden 与 pointer-events:none；只隐藏/inert 内层 article 会留下不可见点击区和 Tab 停靠点。手机保持可见预览加独立 native-scroll sheet。
- 关闭 editor 不清除 selection；再次点击同一 generation 或合法的低于拖动阈值的 pointer release，必须显式 reopen。不能只依赖 selected ID 变化的 effect，否则同卡无法重新打开。拖动结束、第二指和取消不被当成这次点击，且不触发 Run/Save。
- `CanvasGenerationSettings` 是从 inspector 提取的唯一参数 UI，复用原 CommitField/registry；主区展示模型与尺寸，更多设置/连接用原生 details。非法隐藏字段先展开再 focus，Run/Save 仍先验证全部捕获字段。primary 只有一个 prompt textarea 和显式 Generate，卡片预览不是第二套编辑状态。
- `CanvasDock` 提供实际选择/平移、新建、捕获导入、图谱和所选操作；文档名称/保存留在上方，节点查找是紧凑浮层，camera 控件位于角落。按钮是实际能力，不添加尚未实现的撤销/视频等占位。真实只读时不挂载导入 input。
- 桌面 select 允许选中/整卡拖动，空白仍可平移；pan 可从卡片表面平移而不写 node position，不能只切换光标。tool/view 切换取消未完成移动；手机 Browse/显式 Move 不因桌面工具切换而改变。graph 端口修改还需 editable、非 preview、graph view 与非 pan，保留字段/键盘 opt-out。
- editor 和所选图片 toolbar 必须测量 `[data-canvas-dock]`、`[data-canvas-camera]`，保留可见区域中的 dock 顶部间隔。图片 toolbar 还测量自身高度并监听自身/dock resize、visualViewport；固定 62px 假设不足以处理换行/小屏。低处或部分离屏图片的 View/Download/Continue 不能落到更高 z-index 的 dock 下面，布局只改 CSS 不移动图片。
- 布局与工具分组改编自 `basketikun/infinite-canvas` MIT 源码时，维护 `THIRD_PARTY_NOTICES.md` 的上游 commit/文件和完整许可。不能借 UI 复用引入上游 provider/store/文档格式或覆盖现有保存机制。

## 4. 校验与错误边界

| 条件 | 行为 |
| --- | --- |
| creation 隐藏的 source 为独立或多 target prompt | `canvasVisibleNodeId` 返回 null；明确选 source 时进入 graph，折叠时保留数据/草稿，不猜测目标。 |
| 真 readOnly / 未就绪 / deleting | 沿用控制器拒绝；工具布局或图谱模式不能赋权，导入 input 不挂载。 |
| 隐藏 wrapper 或低处图片 toolbar | 禁用外层命中/焦点；按真实 dock/toolbar/visualViewport 重新定位，不改 domain 坐标或绕过遮挡点击。 |
| 非法 raw field / source 过期 | 复用 Canvas Studio 的 applyPending / expected binding 拒绝；不能静默回退。 |

## 5. Good / Base / Bad

- Good：默认一张创作卡，高级图谱能找到原 prompt 和 edges；移动/删除不级联修改来源。
- Base：手机 Browse/显式 Move 与桌面 select/pan 分离，原生输入和单 editor registry 不变。
- Bad：把视觉折叠实现为删除数据；仅改 cursor 冒充 hand tool；只隐藏 article 却留下外层点击区。

## 6. 必需回归

- `canvas-unified-view`、`canvas-renderer-adapter`：private/shared/standalone 映射、切换不变 scene/camera、同卡关闭重开、外层 inert 与关闭后恢复、真实只读。
- `canvas-image-first-stage`：迟挂载/移除、toolbar 自身/两个 dock 高度变化、视口边界和布局零 domain 写入。
- `generator-studio-canvas`：root/lazy/owner/Run/Save 回归不能因折叠展示删掉；旧 source 测试显式切 graph。
- Native browser：先真实 pan 至底部边缘再 hit-test View/Continue/Download；高 zoom 检查隐藏 wrapper 的 Tab/屏幕命中；一 textarea 在 360/390/430 与短/横屏下保留 composition/raw fields。
- 完整执行点、夹具和物理设备证据区分见 [Canvas Studio](./canvas-studio.md) 第 6 节和 [Quality Guidelines](./quality-guidelines.md)。

## 7. 错误与正确示例

```ts
// Wrong: CSS opacity on the article alone leaves Flow's wrapper interactive.
const presentation = { editorReplacesCard: true };

// Correct: disable the wrapper, retaining canonical ID/position/measurements.
const wrapper = { focusable: false, selectable: false, draggable: false,
  connectable: false, domAttributes: { inert: true, "aria-hidden": true },
  style: { pointerEvents: "none" as const } };
```
