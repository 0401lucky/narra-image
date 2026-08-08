# 前端组件指南

## 1. 适用范围与触发条件

- 适用于 `src/components/` 下所有 React 组件的编写、props 约定与组合方式。
- 新增组件、修改现有组件 props 或样式系统前，必须先读本规范。

## 2. 基础约定

- **命名导出**，禁止 default export。每个文件导出 1 个主要组件（`export function Alert(...)`）。
- 组件顶层写 `"use client"`（仅当使用 hooks/事件时）；纯展示组件不需要。
- **中文字面量**：UI 文案、`aria-label`、错误提示直接写中文（如 `aria-label="关闭"`）。
- 类名合并统一用 `cn()`（`@/lib/utils`，基于 clsx + tailwind-merge），禁止模板字符串拼接条件类名。

```tsx
// src/components/ui/skeleton.tsx
import { cn } from "@/lib/utils";

type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & { delay?: number };

export function Skeleton({ className, delay, style, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn("skeleton-shimmer rounded-md", className)}
      style={delay != null ? { ...style, animationDelay: `${delay}ms` } : style}
      {...props}
    />
  );
}
```

## 3. Props 约定

- props 类型用命名的 `type XxxProps`（放在组件上方），不要 inline 匿名对象。
- 可透传 DOM 属性时继承 `React.HTMLAttributes<...>` 并展开 `...props`。
- `children` 类型用 `ReactNode`。
- 可选 props 提供默认值（解构默认值），如 `variant = "error"`。

```tsx
// src/components/ui/alert.tsx
type AlertProps = {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
};
```

## 4. Variant 模式

- 多视觉形态的组件用**字面量联合类型** + `variantStyles` Record 映射（不用条件散落 className）。
- `variantStyles` 里同时存 container / icon / 图标组件，保证变体属性集中。

```tsx
export type AlertVariant = "error" | "warning" | "success" | "info";

const variantStyles: Record<AlertVariant, {
  container: string;
  icon: string;
  Icon: typeof AlertCircle;
}> = {
  error:   { container: "border-rose-200 bg-rose-50/80 text-rose-700", icon: "text-rose-500", Icon: AlertCircle },
  warning: { container: "border-amber-200 bg-amber-50/80 text-amber-800", icon: "text-amber-500", Icon: AlertTriangle },
  success: { container: "border-emerald-200 bg-emerald-50/80 text-emerald-800", icon: "text-emerald-600", Icon: CheckCircle2 },
  info:    { container: "border-sky-200 bg-sky-50/80 text-sky-800", icon: "text-sky-600", Icon: Info },
};
```

## 5. 无障碍约定

- 装饰性图标必须 `aria-hidden`（lucide-react 图标加 `aria-hidden`）。
- 按语义设置 `role`：错误用 `role="alert"` + `aria-live="assertive"`，状态用 `role="status"` + `aria-live="polite"`。
- 图标按钮必须有中文 `aria-label`。
- 交互按钮显式 `type="button"`（避免表单内默认 submit）。

## 6. 组合与文件边界

- **容器组件**（如 `create/generator-studio.tsx`）只负责状态编排与子组件接线，逻辑拆分到同目录的 `hooks/`、`parts/`、`utils.ts`、`constants.ts`。
- feature 内部引用用相对路径（`./parts/composer`、`./hooks/use-sessions`）。
- 动画用 `motion/react`（`AnimatePresence` + `motion`）；懒加载用 `next/dynamic`。

## 7. 禁止与常见错误

- 禁止在组件里写内联样式堆叠替代 `cn()` + Tailwind 类。
- 禁止把 UI 常量（选项数组、标签文案）写死在组件内——放 feature `constants.ts`。
- 禁止组件直接 `fetch` 数据库——数据来自 props / hooks（hooks 调 `/api/*`）。
- 禁止无 `key` 的列表渲染、禁止装饰图标不带 `aria-hidden`。
