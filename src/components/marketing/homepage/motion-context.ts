"use client";

import { createContext } from "react";

import type { HomeMotionState } from "./types";

export const HomeMotionContext = createContext<HomeMotionState>({
  reducedMotion: false,
  paused: false,
  pageVisible: true,
  finePointer: false,
  enabled: false,
  togglePaused: () => {},
});
