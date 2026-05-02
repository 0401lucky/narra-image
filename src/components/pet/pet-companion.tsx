"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

import { usePetEnabled } from "@/components/pet/pet-state";

// 精灵图基本参数：原图 1136 × 1385，缩放后用作单个角色显示窗口
// 这里只取第一行第一个 Q 版小人，用 CSS 偏移裁剪
const SPRITE_URL = "/pet/character.png";
const SPRITE_DISPLAY_WIDTH = 600; // 整图缩放后的宽度（像素）
const PET_FRAME_WIDTH = 78; // 显示窗口宽
const PET_FRAME_HEIGHT = 96; // 显示窗口高
// 第一行第一个角色在缩放后图中的左上偏移（经验值，可微调）
const SPRITE_OFFSET_X = -10;
const SPRITE_OFFSET_Y = -6;

// 屏幕安全边距：避免宠物贴边或被 header 遮挡
const SAFE_TOP = 96;
const SAFE_BOTTOM = 24;
const SAFE_HORIZONTAL = 24;

// 走动节奏控制：到点后停留一段时间再选下一个目标
const PAUSE_MIN_MS = 1200;
const PAUSE_MAX_MS = 3200;
const MOVE_MIN_MS = 800;
const MOVE_MAX_MS = 2200;

// 点击时随机展示的气泡台词
const REACTION_BUBBLES = [
  "嗨～你看到我啦！",
  "陪你创作呀 ✦",
  "今天画点什么？",
  "继续加油哦",
  "嘿嘿 被发现了",
  "灵感正在路上…",
];

type Position = { x: number; y: number };

// 在屏幕安全区内随机选一个目标点
function pickRandomTarget(): Position {
  if (typeof window === "undefined") return { x: 80, y: 200 };
  const maxX = Math.max(
    SAFE_HORIZONTAL,
    window.innerWidth - PET_FRAME_WIDTH - SAFE_HORIZONTAL,
  );
  const maxY = Math.max(
    SAFE_TOP,
    window.innerHeight - PET_FRAME_HEIGHT - SAFE_BOTTOM,
  );
  const x = SAFE_HORIZONTAL + Math.random() * (maxX - SAFE_HORIZONTAL);
  const y = SAFE_TOP + Math.random() * (maxY - SAFE_TOP);
  return { x, y };
}

// 屏幕悬浮宠物：跟随主题缩放，可点击触发反应；通过开关组件控制显隐
export function PetCompanion() {
  const enabled = usePetEnabled();
  // position 等只在客户端使用；初始化用屏幕右下角作为出场位置
  const [position, setPosition] = useState<Position>(() => {
    if (typeof window === "undefined") return { x: 200, y: 400 };
    return {
      x: window.innerWidth - PET_FRAME_WIDTH - 32,
      y: window.innerHeight - PET_FRAME_HEIGHT - 64,
    };
  });
  const [facing, setFacing] = useState<"left" | "right">("left");
  const [isReacting, setIsReacting] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);

  // 用 ref 保存定时器引用，避免点击/反应期间被走动覆盖
  const reactionTimerRef = useRef<number | null>(null);
  const stepTimerRef = useRef<number | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  // 跟踪当前位置，避免在 setState updater 中调用其他 setState（React 反模式）
  const positionRef = useRef<Position>(position);

  // 走动调度：开启后周期性挑选下一个目标点；通过订阅回调更新 state，符合 effect 规范
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    function scheduleNextStep(delay: number) {
      if (cancelled) return;
      stepTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        const target = pickRandomTarget();
        const prev = positionRef.current;
        // 朝向：根据 X 增量切换；相等时维持上次朝向
        if (target.x < prev.x) setFacing("left");
        else if (target.x > prev.x) setFacing("right");
        positionRef.current = target;
        setPosition(target);
        const moveMs = MOVE_MIN_MS + Math.random() * (MOVE_MAX_MS - MOVE_MIN_MS);
        const pauseMs =
          PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS);
        scheduleNextStep(moveMs + pauseMs);
      }, delay);
    }

    // 初次启用稍候即走第一步
    scheduleNextStep(400);

    return () => {
      cancelled = true;
      if (stepTimerRef.current) {
        window.clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    };
  }, [enabled]);

  // 卸载时清理所有定时器
  useEffect(() => {
    return () => {
      if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      if (stepTimerRef.current) window.clearTimeout(stepTimerRef.current);
    };
  }, []);

  // 点击宠物：随机气泡 + 跳跃动画
  function handlePetClick() {
    const text =
      REACTION_BUBBLES[Math.floor(Math.random() * REACTION_BUBBLES.length)];
    setBubble(text);
    setIsReacting(true);

    if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);

    reactionTimerRef.current = window.setTimeout(() => {
      setIsReacting(false);
      reactionTimerRef.current = null;
    }, 600);
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubble(null);
      bubbleTimerRef.current = null;
    }, 2400);
  }

  if (!enabled) return null;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label="桌面宠物，点击有反应"
      onClick={handlePetClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handlePetClick();
        }
      }}
      className="fixed z-40 cursor-pointer select-none focus:outline-none"
      style={{
        width: PET_FRAME_WIDTH,
        height: PET_FRAME_HEIGHT,
      }}
      initial={{ x: position.x, y: position.y, scale: 1 }}
      animate={{
        x: position.x,
        y: position.y,
        scale: isReacting ? 1.15 : 1,
        rotate: isReacting ? [0, -8, 8, -4, 0] : 0,
      }}
      transition={{
        x: { duration: 1.6, ease: "easeInOut" },
        y: { duration: 1.6, ease: "easeInOut" },
        scale: { duration: 0.3, ease: "easeOut" },
        rotate: { duration: 0.6, ease: "easeOut" },
      }}
      whileHover={{ scale: 1.08 }}
    >
      {/* 走步颠簸：内层做轻微 Y 浮动，循环播放 */}
      <motion.div
        className="relative h-full w-full"
        animate={{ y: [0, -4, 0, -2, 0] }}
        transition={{ duration: 0.7, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* 气泡 */}
        <AnimatePresence>
          {bubble ? (
            <motion.div
              key={bubble}
              initial={{ opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-2xl border border-[var(--line)] bg-[var(--card-strong)] px-3 py-1.5 text-xs text-[var(--ink)] shadow-[var(--shadow)]"
            >
              {bubble}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* 角色精灵：通过 transform 做水平翻转表示朝向 */}
        <div
          className="relative h-full w-full overflow-hidden"
          style={{
            transform: facing === "right" ? "scaleX(-1)" : "scaleX(1)",
            transformOrigin: "center",
            filter: "drop-shadow(0 6px 8px rgba(94, 58, 33, 0.25))",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={SPRITE_URL}
            alt=""
            draggable={false}
            style={{
              width: SPRITE_DISPLAY_WIDTH,
              height: "auto",
              maxWidth: "none",
              position: "absolute",
              left: SPRITE_OFFSET_X,
              top: SPRITE_OFFSET_Y,
              userSelect: "none",
              pointerEvents: "none",
            }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
