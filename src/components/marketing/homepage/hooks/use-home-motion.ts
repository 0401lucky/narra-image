"use client";

import { useContext } from "react";

import { HomeMotionContext } from "../motion-context";
import type { HomeMotionState } from "../types";

// 首页共用可见性与动态偏好，不在每张卡片上重复订阅全局事件。
export function useHomeMotion(): HomeMotionState {
  return useContext(HomeMotionContext);
}
