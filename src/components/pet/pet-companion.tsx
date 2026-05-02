"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { motion, AnimatePresence } from "motion/react";

import {
  getPetById,
  type PetDefinition,
  type PetFrame,
  type PetMood,
} from "@/components/pet/pet-catalog";
import { usePetEnabled, useSelectedPetId } from "@/components/pet/pet-state";
import {
  getPetTurnaround,
  type PetDirection,
  type PetTurnaroundDefinition,
} from "@/components/pet/pet-turnaround";

// 统一的显示窗口：各角色原始尺寸不同，窗口略大一点，避免长发/耳朵被裁掉
const PET_FRAME_WIDTH = 112;
const PET_FRAME_HEIGHT = 128;
const PET_FLOOR_GAP = 4;
const FRAME_PADDING = 10;

// 屏幕安全边距：避免宠物贴边或被 header 遮挡
const SAFE_TOP = 96;
const SAFE_BOTTOM = 24;
const SAFE_HORIZONTAL = 24;

// 走动节奏控制：用短距离闲逛 + 较长停顿，避免“小人瞬移”的突兀感
const PAUSE_MIN_MS = 2400;
const PAUSE_MAX_MS = 5600;
const MOVE_MIN_MS = 1700;
const MOVE_MAX_MS = 4400;
const HOVER_REACTION_COOLDOWN_MS = 2200;
const HOVER_MOVE_DELAY_MS = 520;
const TURN_PAUSE_MS = 150;

const FRAME_DELAYS: Record<PetMood, number> = {
  idle: 980,
  react: 190,
  walk: 125,
};

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
type SpriteSheetDefinition = Pick<
  PetDefinition | PetTurnaroundDefinition,
  "naturalWidth" | "naturalHeight" | "scale"
>;
type ExpandedFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getExpandedFrame(
  frame: PetFrame,
  spriteSheet: SpriteSheetDefinition,
): ExpandedFrame {
  const x = Math.max(0, frame.x - FRAME_PADDING);
  const y = Math.max(0, frame.y - FRAME_PADDING);
  const right = Math.min(
    spriteSheet.naturalWidth,
    frame.x + frame.width + FRAME_PADDING,
  );
  const bottom = Math.min(
    spriteSheet.naturalHeight,
    frame.y + frame.height + FRAME_PADDING,
  );

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function getFrameWindowStyle(
  frame: PetFrame,
  spriteSheet: SpriteSheetDefinition,
): CSSProperties {
  const expandedFrame = getExpandedFrame(frame, spriteSheet);
  const renderedWidth = expandedFrame.width * spriteSheet.scale;
  const renderedHeight = expandedFrame.height * spriteSheet.scale;

  return {
    position: "absolute",
    left: (PET_FRAME_WIDTH - renderedWidth) / 2,
    top: PET_FRAME_HEIGHT - renderedHeight - PET_FLOOR_GAP,
    width: renderedWidth,
    height: renderedHeight,
    overflow: "hidden",
  };
}

function getSpriteImageStyle(
  frame: PetFrame,
  spriteSheet: SpriteSheetDefinition,
): CSSProperties {
  const expandedFrame = getExpandedFrame(frame, spriteSheet);

  return {
    width: spriteSheet.naturalWidth * spriteSheet.scale,
    height: "auto",
    maxWidth: "none",
    position: "absolute",
    left: -expandedFrame.x * spriteSheet.scale,
    top: -expandedFrame.y * spriteSheet.scale,
    userSelect: "none",
    pointerEvents: "none",
  };
}

function clampPosition(position: Position): Position {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(
      Math.max(position.x, SAFE_HORIZONTAL),
      Math.max(SAFE_HORIZONTAL, window.innerWidth - PET_FRAME_WIDTH - SAFE_HORIZONTAL),
    ),
    y: Math.min(
      Math.max(position.y, SAFE_TOP),
      Math.max(SAFE_TOP, window.innerHeight - PET_FRAME_HEIGHT - SAFE_BOTTOM),
    ),
  };
}

function getMoveDuration(prev: Position, target: Position): number {
  const distance = Math.hypot(target.x - prev.x, target.y - prev.y);
  return Math.min(MOVE_MAX_MS, Math.max(MOVE_MIN_MS, 900 + distance * 8.4));
}

// 在当前位置附近找一个自然的闲逛目标，少量位移更像小人自己走过去
function pickWanderTarget(current: Position): Position {
  if (typeof window === "undefined") return { x: 80, y: 200 };
  const direction = Math.random() > 0.5 ? 1 : -1;
  const distance = 90 + Math.random() * 220;
  const driftY = (Math.random() - 0.5) * 140;
  const target = clampPosition({
    x: current.x + direction * distance,
    y: current.y + driftY,
  });

  const movedEnough = Math.hypot(target.x - current.x, target.y - current.y) > 42;
  if (movedEnough) return target;

  return clampPosition({
    x: current.x - direction * distance,
    y: current.y - driftY,
  });
}

function getDirectionFromDelta(dx: number, dy: number): PetDirection {
  if (Math.hypot(dx, dy) < 8) return "front";

  const sector =
    Math.round(((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) %
    8;
  const directions: PetDirection[] = [
    "right",
    "front-right",
    "front",
    "front-left",
    "left",
    "back-left",
    "back",
    "back-right",
  ];

  return directions[sector];
}

// 屏幕悬浮宠物：跟随主题缩放，可点击触发反应；通过开关组件控制显隐
export function PetCompanion() {
  const enabled = usePetEnabled();
  const selectedPetId = useSelectedPetId();
  const pet = getPetById(selectedPetId);
  const turnaround = getPetTurnaround(pet.id);
  // position 等只在客户端使用；初始化用屏幕右下角作为出场位置
  const [position, setPosition] = useState<Position>(() => {
    if (typeof window === "undefined") return { x: 200, y: 400 };
    return {
      x: window.innerWidth - PET_FRAME_WIDTH - 32,
      y: window.innerHeight - PET_FRAME_HEIGHT - 64,
    };
  });
  const [facing, setFacing] = useState<"left" | "right">("left");
  const [direction, setDirection] = useState<PetDirection>("front");
  const [frameTick, setFrameTick] = useState(0);
  const [isWalking, setIsWalking] = useState(false);
  const [isReacting, setIsReacting] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [moveDurationMs, setMoveDurationMs] = useState(1600);

  // 用 ref 保存定时器引用，避免点击/反应期间被走动覆盖
  const reactionTimerRef = useRef<number | null>(null);
  const stepTimerRef = useRef<number | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const walkTimerRef = useRef<number | null>(null);
  const turnTimerRef = useRef<number | null>(null);
  const hoverMoveTimerRef = useRef<number | null>(null);
  const interactionHoldUntilRef = useRef(0);
  const hoverReactionAtRef = useRef(0);
  // 跟踪当前位置，避免在 setState updater 中调用其他 setState（React 反模式）
  const positionRef = useRef<Position>(position);
  const mood: PetMood = isReacting ? "react" : isWalking ? "walk" : "idle";
  const currentFrameSet = pet.frames[mood];
  const currentFrame = currentFrameSet[frameTick % currentFrameSet.length];
  const shouldUseTurnaround = Boolean(turnaround && mood === "idle");
  const renderedSpriteSheet =
    shouldUseTurnaround && turnaround ? turnaround : pet;
  const renderedFrame =
    shouldUseTurnaround && turnaround
      ? turnaround.frames[direction]
      : currentFrame;
  const renderedSpriteUrl =
    shouldUseTurnaround && turnaround ? turnaround.spriteUrl : pet.spriteUrl;

  const startWalkTo = useCallback((prev: Position, target: Position, moveMs: number) => {
    if (target.x < prev.x) setFacing("left");
    else if (target.x > prev.x) setFacing("right");
    setDirection(getDirectionFromDelta(target.x - prev.x, target.y - prev.y));
    setMoveDurationMs(moveMs);
    setIsWalking(false);

    if (turnTimerRef.current) window.clearTimeout(turnTimerRef.current);
    if (walkTimerRef.current) window.clearTimeout(walkTimerRef.current);

    turnTimerRef.current = window.setTimeout(() => {
      positionRef.current = target;
      setIsWalking(true);
      setPosition(target);
      turnTimerRef.current = null;

      walkTimerRef.current = window.setTimeout(() => {
        setIsWalking(false);
        walkTimerRef.current = null;
      }, moveMs);
    }, TURN_PAUSE_MS);
  }, []);

  // 走动调度：开启后周期性挑选下一个目标点；通过订阅回调更新 state，符合 effect 规范
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    function scheduleNextStep(delay: number) {
      if (cancelled) return;
      stepTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        const holdMs = interactionHoldUntilRef.current - Date.now();
        if (holdMs > 0) {
          scheduleNextStep(Math.min(holdMs + 300, 1300));
          return;
        }
        const prev = positionRef.current;
        const target = pickWanderTarget(prev);
        const moveMs = getMoveDuration(prev, target);
        startWalkTo(prev, target, moveMs);
        const pauseMs =
          PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS);
        scheduleNextStep(TURN_PAUSE_MS + moveMs + pauseMs);
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
  }, [enabled, startWalkTo]);

  // 根据当前动作状态循环精灵帧，让宠物真的“活”起来
  useEffect(() => {
    if (!enabled) return;
    const frameTimer = window.setInterval(() => {
      setFrameTick((tick) => tick + 1);
    }, FRAME_DELAYS[mood]);

    return () => {
      window.clearInterval(frameTimer);
    };
  }, [enabled, mood]);

  // 卸载时清理所有定时器
  useEffect(() => {
    return () => {
      if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      if (stepTimerRef.current) window.clearTimeout(stepTimerRef.current);
      if (walkTimerRef.current) window.clearTimeout(walkTimerRef.current);
      if (turnTimerRef.current) window.clearTimeout(turnTimerRef.current);
      if (hoverMoveTimerRef.current) window.clearTimeout(hoverMoveTimerRef.current);
    };
  }, []);

  function showReaction(duration = 1100) {
    const text =
      REACTION_BUBBLES[Math.floor(Math.random() * REACTION_BUBBLES.length)];
    setBubble(text);
    setIsReacting(true);
    interactionHoldUntilRef.current = Math.max(
      interactionHoldUntilRef.current,
      Date.now() + duration + 420,
    );

    if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);

    reactionTimerRef.current = window.setTimeout(() => {
      setIsReacting(false);
      reactionTimerRef.current = null;
    }, duration);
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubble(null);
      bubbleTimerRef.current = null;
    }, 2400);
  }

  function nudgeAwayFromPointer(clientX: number, clientY: number) {
    const current = positionRef.current;
    const centerX = current.x + PET_FRAME_WIDTH / 2;
    const centerY = current.y + PET_FRAME_HEIGHT / 2;
    let dx = centerX - clientX;
    let dy = centerY - clientY;
    const length = Math.hypot(dx, dy) || 1;
    if (length < 8) {
      dx = Math.random() > 0.5 ? 1 : -1;
      dy = -0.4;
    }
    const distance = 54 + Math.random() * 46;
    const target = clampPosition({
      x: current.x + (dx / length) * distance,
      y: current.y + (dy / length) * distance,
    });

    const moveMs = Math.min(1500, Math.max(980, 720 + distance * 6));
    interactionHoldUntilRef.current = Math.max(
      interactionHoldUntilRef.current,
      Date.now() + TURN_PAUSE_MS + moveMs + 500,
    );
    if (reactionTimerRef.current) {
      window.clearTimeout(reactionTimerRef.current);
      reactionTimerRef.current = null;
    }
    setIsReacting(false);
    startWalkTo(current, target, moveMs);
  }

  function handlePetPointerEnter(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const now = Date.now();
    if (now - hoverReactionAtRef.current < HOVER_REACTION_COOLDOWN_MS) return;
    hoverReactionAtRef.current = now;
    setDirection(
      getDirectionFromDelta(
        event.clientX - (positionRef.current.x + PET_FRAME_WIDTH / 2),
        event.clientY - (positionRef.current.y + PET_FRAME_HEIGHT / 2),
      ),
    );
    showReaction(1250);
    if (hoverMoveTimerRef.current) {
      window.clearTimeout(hoverMoveTimerRef.current);
    }
    const { clientX, clientY } = event;
    hoverMoveTimerRef.current = window.setTimeout(() => {
      nudgeAwayFromPointer(clientX, clientY);
      hoverMoveTimerRef.current = null;
    }, HOVER_MOVE_DELAY_MS);
  }

  // 点击宠物：随机气泡 + 跳跃动画
  function handlePetClick() {
    showReaction();
  }

  if (!enabled) return null;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label="桌面宠物，点击有反应"
      onClick={handlePetClick}
      onPointerEnter={handlePetPointerEnter}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handlePetClick();
        }
      }}
      className="fixed left-0 top-0 z-40 cursor-pointer select-none focus:outline-none"
      data-pet-direction={direction}
      data-pet-frame={renderedFrame.name}
      data-pet-id={pet.id}
      data-pet-mood={mood}
      data-pet-render-mode={shouldUseTurnaround ? "turnaround" : "action"}
      style={{
        width: PET_FRAME_WIDTH,
        height: PET_FRAME_HEIGHT,
      }}
      initial={{ x: position.x, y: position.y, scale: 1 }}
      animate={{
        x: position.x,
        y: position.y,
        scale: isReacting ? 1.08 : 1,
        rotate: isReacting ? [0, -5, 4, -2, 0] : 0,
      }}
      transition={{
        x: { duration: moveDurationMs / 1000, ease: "easeInOut" },
        y: { duration: moveDurationMs / 1000, ease: "easeInOut" },
        scale: { duration: 0.45, ease: "easeOut" },
        rotate: { duration: 0.9, ease: "easeOut" },
      }}
      whileHover={{ scale: 1.035 }}
    >
      {/* 内层负责身体起伏：走路更轻快，待机更像呼吸 */}
      <motion.div
        className="relative h-full w-full"
        animate={
          mood === "walk"
            ? { y: [0, -2, 0, -1, 0] }
            : mood === "react"
              ? { y: [0, -10, 0] }
              : { y: [0, -2, 0] }
        }
        transition={{
          duration: mood === "walk" ? 0.56 : mood === "react" ? 0.9 : 2.2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        {/* 气泡 */}
        <AnimatePresence>
          {bubble ? (
            <motion.div
              key={bubble}
              initial={{ opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-2xl border border-[var(--line)] bg-[var(--card-strong)] px-3 py-1.5 text-xs text-[var(--ink)] shadow-[var(--shadow)]"
            >
              {bubble}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* 角色精灵：站姿用 8 方向图，移动/反应用原动作帧 */}
        <div
          className="relative h-full w-full"
          style={{
            transform: shouldUseTurnaround
              ? "none"
              : facing === "left"
                ? "scaleX(-1)"
                : "scaleX(1)",
            transformOrigin: "center",
            filter: "drop-shadow(0 6px 8px rgba(94, 58, 33, 0.25))",
          }}
        >
          <div style={getFrameWindowStyle(renderedFrame, renderedSpriteSheet)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={renderedSpriteUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={getSpriteImageStyle(renderedFrame, renderedSpriteSheet)}
            />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
