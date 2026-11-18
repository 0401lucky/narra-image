"use client";

// 后台全局轻量通知 Hook。
// 1) 若在 AdminToastProvider 内调用，推送右上角动态堆叠通知；
// 2) 若在独立组件单元测试（未包裹 Provider）中调用，返回安全空操作契约，避免测试崩溃。
import { useContext } from "react";

import {
  AdminToastContext,
  type AdminToastContextValue,
} from "../ui/admin-toast-context";

const fallbackToastApi: AdminToastContextValue = {
  dismiss: () => {},
  error: () => "noop",
  info: () => "noop",
  push: () => "noop",
  success: () => "noop",
  warning: () => "noop",
};

export function useAdminToast(): AdminToastContextValue {
  const ctx = useContext(AdminToastContext);
  return ctx ?? fallbackToastApi;
}
