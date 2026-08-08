# 前端 Hook 指南

## 1. 适用范围与触发条件

- 适用于 `src/components/<feature>/hooks/` 与页面中自定义 React Hook 的命名、组织与编写。
- 新增 hook、修改现有 hook 的生命周期/清理逻辑前，必须先读本规范。

## 2. 组织与命名

- 文件名 kebab-case 且以 `use-` 前缀：`use-image-poller.ts`、`use-reference-images.ts`、`use-sessions.ts`。
- 每个 feature 的 hooks 放在该 feature 的 `hooks/` 子目录；跨 feature 复用时再上移到共享位置。
- 导出名用 camelCase 的 `useXxx`，与文件名对应（`use-image-poller.ts` → `useImagePoller`）。
- 文件顶部必须 `"use client"`。

## 3. 返回契约

- 需要外部命令式操作的 hook 返回**命令式函数集合**而非裸状态（便于调用方控制时机，不依赖 setState 闭包延迟）：

```ts
// src/components/create/hooks/use-reference-images.ts
type UseReferenceImagesResult = {
  referenceImages: ReferenceImage[];
  addFiles: (files: File[] | FileList | null) => AddFilesResult;
  removeImage: (id: string) => void;
  clear: () => void;
  moveImage: (id: string, direction: -1 | 1) => void;
  reorderImage: (sourceId: string, targetId: string) => void;
  setImages: Dispatch<SetStateAction<ReferenceImage[]>>;
};
```

- 返回类型用命名 `type UseXxxResult`，收窄成功/失败结果用字面量联合（如 `AddFilesResult = "ok" | "exceeded" | "empty"`）。

## 4. 生命周期与清理

- 所有定时器、事件监听、ObjectURL 必须在 `useEffect` cleanup 中释放，禁止泄漏：

```ts
// src/components/create/hooks/use-image-poller.ts
useEffect(() => {
  const pollers = pollersRef.current;
  return () => {
    pollers.forEach((entry) => clearTimeout(entry.handle));
    pollers.clear();
  };
}, []);
```

- 可变跨渲染状态用 `useRef`（如 `Map<string, PollerEntry>` 管理多个轮询器）。
- 监听全局事件（`visibilitychange`、`focus`、`pageshow`）必须在 cleanup 中移除。

## 5. 数据轮询模式（项目高频）

- 用 `setTimeout` + 退避延时替代固定 `setInterval`，避免后台浏览器节流造成重试堆积。
- 标签页隐藏时挂起轮询，可见时立即补拉（`visibilitychange` 处理），恢复前台后对仍 pending 的任务立即拉一次。
- 命中终态（succeeded/failed）即停止；超过最大尝试次数兜底放弃。

```ts
const POLL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
const POLL_MAX_ATTEMPTS = 12;
function nextDelay(attempts: number) {
  return POLL_DELAYS_MS[Math.min(attempts, POLL_DELAYS_MS.length - 1)];
}
```

## 6. 注释约定

- hook 顶部写中文注释块，说明职责与关键行为决策（为什么用某模式、边界是什么）：

```ts
// 单个 generation 任务的轮询 Hook。
// 1) setTimeout + 退避（POLL_DELAYS_MS）替代固定 setInterval；
// 2) 监听 visibilitychange/focus/pageshow，标签页隐藏时挂起，恢复后立即补拉；
// 3) 任务进入 succeeded/failed 即停止；超过 POLL_MAX_ATTEMPTS 兜底放弃。
```

## 7. 禁止与常见错误

- 禁止 `useEffect` 返回未清理的定时器/监听器（会导致重复请求或内存泄漏）。
- 禁止 hook 依赖值不稳定导致无限循环——外部传入的回调（`onUpdate`）应保持引用稳定或列入依赖。
- 禁止在 hook 内直接读写数据库——一律经 `/api/*` fetch。
- 禁止把 hook 放进组件文件——单独 `use-*.ts` 文件。
