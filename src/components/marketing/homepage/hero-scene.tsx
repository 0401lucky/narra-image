"use client";

/* eslint-disable @next/next/no-img-element */

import { useId, useRef, type KeyboardEvent } from "react";
import { ArrowUpRight, Check, ImageOff, Pause, Play, RotateCcw, Sparkle } from "lucide-react";

import { cn } from "@/lib/utils";

import { HERO_SCENES } from "./constants";
import { useHeroScene } from "./hooks/use-hero-scene";
import { useHomeDust } from "./hooks/use-home-dust";
import { useHomeMotion } from "./hooks/use-home-motion";
import { useHomeTypewriter } from "./hooks/use-home-typewriter";
import { useHomeVisibility } from "./hooks/use-home-visibility";
import { usePointerDepth } from "./hooks/use-pointer-depth";
import { usePromptClipboard } from "./hooks/use-prompt-clipboard";
import styles from "./homepage.module.css";

export function HeroScene() {
  const { scene, imageState, imageRevision, requestedId, failedId, requestScene, imageFailed } = useHeroScene();
  const { ref: visibilityRef, visible } = useHomeVisibility<HTMLDivElement>();
  const frameRef = usePointerDepth<HTMLDivElement>({ enabled: visible });
  const dustRef = useHomeDust(visible && imageState === "ready");
  const motion = useHomeMotion();
  const { visualText, typing } = useHomeTypewriter({ text: scene.prompt, identity: scene.id, visible });
  const clipboard = usePromptClipboard({ text: scene.prompt, identity: `hero:${scene.id}` });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const instanceId = useId();
  const pendingScene = HERO_SCENES.find((item) => item.id === requestedId);
  const failedScene = HERO_SCENES.find((item) => item.id === failedId);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % HERO_SCENES.length;
    else if (event.key === "ArrowLeft") nextIndex = (index + HERO_SCENES.length - 1) % HERO_SCENES.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = HERO_SCENES.length - 1;
    else return;
    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
    requestScene(HERO_SCENES[nextIndex].id);
  }

  return (
    <div ref={visibilityRef} className={styles.heroArt}>
      <div
        ref={frameRef}
        className={styles.heroFrame}
        data-home-hero-frame
        data-scene-id={scene.id}
        data-image-state={imageState}
        data-effect-active={motion.enabled && visible}
      >
        <div className={styles.sceneToolbar}>
          <span className={styles.sceneSignature}><i aria-hidden />Narra Studio · 叙事光影画布</span>
          <div role="tablist" aria-label="示意画面风格" className={styles.sceneTabs}>
            {HERO_SCENES.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => { tabRefs.current[index] = element; }}
                id={`${instanceId}-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={scene.id === item.id}
                aria-controls={`${instanceId}-scene`}
                tabIndex={scene.id === item.id ? 0 : -1}
                data-pending={requestedId === item.id}
                className={styles.sceneTab}
                onClick={() => requestScene(item.id)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >{item.label}</button>
            ))}
          </div>
        </div>

        <div
          id={`${instanceId}-scene`}
          role="tabpanel"
          aria-labelledby={`${instanceId}-tab-${scene.id}`}
          aria-busy={requestedId !== null}
          className={styles.sceneStage}
        >
          <div className={styles.sceneViewport} data-home-hero-viewport>
            <img
              key={`${scene.id}:${imageRevision}`}
              data-home-scene-image
              src={scene.image}
              alt={scene.alt}
              width={scene.width}
              height={scene.height}
              loading="eager"
              fetchPriority={scene.id === "film" ? "high" : "auto"}
              decoding="async"
              draggable={false}
              className={cn(styles.sceneImage, imageState === "error" && styles.imageUnavailable)}
              onError={() => imageFailed(scene.id, imageRevision)}
            />
            <div className={styles.sceneVignette} aria-hidden />
            <canvas ref={dustRef} className={styles.dust} data-home-dust aria-hidden />
            <span className={styles.sceneLightLabel}>风格示意 · {scene.lightLabel}</span>

            {imageState === "ready" ? (
              <>
                <div className={styles.inpaintAnchor} aria-hidden>
                  <div className={styles.inpaintRing}>
                    <i className={styles.inpaintScan} />
                    <span><Sparkle aria-hidden />局部补光 · 示意</span>
                  </div>
                </div>
                <div className={styles.preset}>
                  <span className={styles.presetEyebrow}>视觉语言 · Style</span>
                  <strong>{scene.preset}</strong>
                  <span className={styles.presetNote}>固定示意图 · 非模型参数</span>
                </div>
              </>
            ) : imageState === "error" ? (
              <div className={styles.sceneFallback}>
                <ImageOff aria-hidden />
                <p>示意图暂时无法加载</p>
                <button type="button" onClick={() => requestScene(scene.id)}><RotateCcw aria-hidden />重试图片</button>
              </div>
            ) : null}
          </div>

          <div className={styles.promptOverlay}>
            <div className={styles.promptToolbar}>
              <span className={styles.aspectLabel}>4:3 · 叙事示意画幅</span>
              <button type="button" onClick={() => void clipboard.copy()} disabled={clipboard.status === "copying"}>
                {clipboard.status === "copied" ? <Check aria-hidden /> : <ArrowUpRight aria-hidden />}
                {clipboard.status === "copied" ? "已复制完整提示词" : clipboard.status === "copying" ? "正在复制" : "复用画面灵感"}
              </button>
            </div>
            <p className={styles.promptText}>
              <span className={styles.srOnly}>{scene.prompt}</span>
              <span aria-hidden data-home-typewriter>{visualText}</span>
              {typing ? <span className={styles.typeCursor} aria-hidden /> : null}
            </p>
          </div>
        </div>

        <div className={styles.sceneFeedback} aria-live="polite" role="status">
          {pendingScene ? `正在载入${pendingScene.label}示意图…` : failedScene ? (
            <span>{failedScene.label}示意图加载失败{failedId !== scene.id ? "，已保留当前场景" : "，提示词仍可阅读与复制"}。
              {failedId !== scene.id ? <button type="button" onClick={() => requestScene(failedScene.id)}>重试</button> : null}
            </span>
          ) : clipboard.status === "copied" ? "已复制当前场景的完整提示词。" : null}
        </div>
        {clipboard.status === "manual" ? (
          <div className={styles.manualCopy}>
            <p role="status">无法自动复制，请选择下方完整提示词手动复制。</p>
            <label htmlFor={`${instanceId}-copy`}>完整场景提示词</label>
            <textarea id={`${instanceId}-copy`} readOnly value={scene.prompt} onFocus={(event) => event.currentTarget.select()} rows={4} />
            <button type="button" onClick={clipboard.reset}>收起手动复制</button>
          </div>
        ) : null}
      </div>
      <div className={styles.sceneCaption}>
        <p>画面与光影交互为示意，非站内生成记录。</p>
        <button
          type="button"
          onClick={motion.togglePaused}
          aria-pressed={motion.paused}
          aria-label={motion.paused ? "恢复装饰动效" : "暂停装饰动效"}
          className={styles.motionToggle}
          data-home-motion-toggle
        >
          {motion.paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {motion.paused ? "恢复动效" : "暂停动效"}
        </button>
      </div>
    </div>
  );
}
