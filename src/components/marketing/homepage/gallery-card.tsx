"use client";

/* eslint-disable @next/next/no-img-element */

import { type SyntheticEvent, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, Copy, Heart, LockKeyhole, User } from "lucide-react";

import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";
import { getThumbSrcSet, getThumbUrl } from "@/lib/image-url";
import type { SerializedFeaturedWork } from "@/lib/prisma-mappers";
import { cn } from "@/lib/utils";

import { GALLERY_CASCADE_DELAY, GALLERY_MESSAGES, GALLERY_PAGE_SIZE, GALLERY_REMIX_MAX_TARGET_BYTES } from "./gallery-constants";
import { HomeReveal } from "./home-reveal";
import { useHomeMotion } from "./hooks/use-home-motion";
import { useHomeVisibility } from "./hooks/use-home-visibility";
import { usePointerDepth } from "./hooks/use-pointer-depth";
import { usePromptClipboard } from "./hooks/use-prompt-clipboard";
import { useWorkLike } from "./hooks/use-work-like";
import styles from "./gallery.module.css";

type GalleryCardProps = {
  work: SerializedFeaturedWork;
  index: number;
  isAuthenticated: boolean;
  remixHintId: string;
};

function fallbackToOriginalImage(
  event: SyntheticEvent<HTMLImageElement>,
  originalSrc: string,
  onUnavailable: () => void,
) {
  const image = event.currentTarget;
  if (!originalSrc || image.dataset.originalFallback === "true" || image.getAttribute("src") === originalSrc) {
    onUnavailable();
    return;
  }
  image.dataset.originalFallback = "true";
  image.removeAttribute("srcset");
  image.src = originalSrc;
}

function promptHref(prompt: string | null) {
  if (prompt === null) return null;
  try {
    const target = `/create?prompt=${encodeURIComponent(prompt)}`;
    // Successful encoding is ASCII; count the full request target, including its prefix.
    return target.length <= GALLERY_REMIX_MAX_TARGET_BYTES ? target : null;
  } catch {
    // Do not replace malformed Unicode or silently change the author's text.
    return null;
  }
}

export function GalleryCard({ work, index, isAuthenticated, remixHintId }: GalleryCardProps) {
  const promptId = useId();
  const titleId = `${promptId}-title`;
  const remixFallbackId = `${promptId}-remix-fallback`;
  const { enabled } = useHomeMotion();
  const { ref: visibilityRef, visible } = useHomeVisibility<HTMLElement>();
  const tiltRef = usePointerDepth<HTMLDivElement>({ enabled: enabled && visible, maxTilt: 7.5, perspective: 950 });
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const open = pinned || (!dismissed && (hovered || focused));
  const publicPrompt = work.showPromptPublic === true && typeof work.prompt === "string" && work.prompt.trim()
    ? work.prompt
    : null;
  const remixHref = promptHref(publicPrompt);
  const clipboard = usePromptClipboard({ text: publicPrompt ?? "", identity: `work:${work.id}` });
  const like = useWorkLike(work);

  function closePrompt() {
    setPinned(false);
    setDismissed(true);
    clipboard.reset();
  }

  useEffect(() => {
    if (clipboard.status === "manual" && open) {
      promptRef.current?.focus();
      promptRef.current?.select();
    }
  }, [clipboard.status, open]);

  return (
    <HomeReveal className={styles.entrance} delay={(index % GALLERY_PAGE_SIZE) * GALLERY_CASCADE_DELAY}>
      <article
        ref={visibilityRef}
        data-gallery-card
        data-work-id={work.id}
        data-prompt-public={publicPrompt !== null}
        aria-labelledby={titleId}
        className={styles.card}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          setHovered(true);
          setDismissed(false);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHovered(false);
        }}
        onFocusCapture={(event) => {
          // Explicit touch disclosure must not toggle closed because focus opened it first.
          if (event.target !== disclosureRef.current) setFocused(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(false);
            setDismissed(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing || !open) return;
          event.preventDefault();
          event.stopPropagation();
          closePrompt();
          disclosureRef.current?.focus();
        }}
      >
        <div ref={tiltRef} data-gallery-tilt data-motion-enabled={enabled && visible} className={styles.tilt}>
          <div data-gallery-image-layer className={styles.imageClip}>
            {imageFailed ? (
              <div className={styles.imageUnavailable}>图片暂时无法加载<br />仍可打开作品详情</div>
            ) : (
              <img
                data-gallery-image
                src={getThumbUrl(work.image, 1080)}
                srcSet={getThumbSrcSet(work.image, [640, 828, 1080, 1200, 1920])}
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                alt={work.title}
                width={640}
                height={800}
                loading={index < 4 ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={index < 2 ? "high" : "auto"}
                className={styles.image}
                onError={(event) => fallbackToOriginalImage(event, work.image, () => setImageFailed(true))}
              />
            )}
            <div aria-hidden className={styles.shade} />
          </div>

          <Link
            href={`/works/${encodeURIComponent(work.id)}`}
            prefetch={false}
            aria-label={`查看作品 ${work.title}`}
            className={styles.detailLink}
          >
            <span aria-hidden className={styles.workNumber}>{String(index + 1).padStart(2, "0")}</span>
            <ArrowUpRight aria-hidden className={styles.viewIcon} />
          </Link>
          <div aria-hidden data-gallery-glare className={styles.glare} />
          <button
            type="button"
            data-gallery-like
            disabled={like.pending}
            aria-busy={like.pending}
            aria-pressed={like.likedByMe}
            aria-label={`${like.likedByMe ? "取消点赞" : "点赞"} ${work.title}`}
            onClick={() => void like.toggleLike()}
            className={cn(styles.likeButton, like.likedByMe && styles.liked)}
          >
            <Heart aria-hidden className={cn(styles.smallIcon, like.likedByMe && styles.filledHeart)} />
            <span>{like.likeCount}</span>
          </button>
          {like.error ? <p role="alert" className={styles.likeError}>{like.error}</p> : null}

          <div data-gallery-info data-open={open} className={styles.info}>
            <h3 id={titleId} className={styles.title}>{work.title}</h3>
            <div className={styles.byline}>
              <span className={styles.author}>
                {work.authorAvatar && !avatarFailed ? (
                  <img
                    src={getThumbUrl(work.authorAvatar, 48)}
                    alt=""
                    width={24}
                    height={24}
                    loading="lazy"
                    decoding="async"
                    className={styles.avatar}
                    onError={(event) => fallbackToOriginalImage(event, work.authorAvatar ?? "", () => setAvatarFailed(true))}
                  />
                ) : <span className={styles.avatar}><User aria-hidden className={styles.smallIcon} /></span>}
                <span className={styles.authorName}>{work.authorName}</span>
              </span>
              <button
                ref={disclosureRef}
                type="button"
                data-gallery-disclosure
                aria-expanded={open}
                aria-controls={promptId}
                aria-label={`${open ? "收起" : "查看"}提示词 ${work.title}`}
                className={styles.disclosure}
                onClick={() => {
                  if (open) closePrompt();
                  else {
                    setPinned(true);
                    setDismissed(false);
                  }
                }}
              >
                {publicPrompt === null ? <LockKeyhole aria-hidden className={styles.smallIcon} /> : null}
                <span>{open ? "收起" : "灵感词"}</span>
                <ChevronDown aria-hidden className={cn(styles.smallIcon, open && styles.chevronOpen)} />
              </button>
            </div>
            <div id={promptId} data-open={open} aria-hidden={!open} inert={!open} className={styles.drawer}>
              <div className={styles.drawerClip}>
                <div className={styles.drawerBody}>
                  {publicPrompt === null ? (
                    <p className={styles.promptExplanation}>
                      {work.showPromptPublic === true ? GALLERY_MESSAGES.emptyPrompt : GALLERY_MESSAGES.hiddenPrompt}
                    </p>
                  ) : (
                    <>
                      <label htmlFor={`${promptId}-text`} className={styles.promptLabel}>公开提示词 · 完整内容</label>
                      <textarea
                        ref={promptRef}
                        id={`${promptId}-text`}
                        data-gallery-prompt
                        aria-label={`完整公开提示词 ${work.title}`}
                        aria-describedby={remixHref ? undefined : remixFallbackId}
                        readOnly
                        spellCheck={false}
                        rows={3}
                        value={publicPrompt}
                        className={styles.promptText}
                      />
                      {!remixHref ? (
                        <p id={remixFallbackId} data-gallery-remix-fallback className={styles.promptExplanation}>
                          {GALLERY_MESSAGES.remixFallback} {GALLERY_MESSAGES.manualModeHint}
                          {publicPrompt.length > GENERATION_PROMPT_MAX_LENGTH ? <> {GALLERY_MESSAGES.manualPromptLimit}</> : null}
                        </p>
                      ) : null}
                      <div className={styles.promptActions}>
                        <button
                          type="button"
                          data-gallery-copy
                          disabled={clipboard.status === "copying"}
                          aria-describedby={remixHref ? undefined : remixFallbackId}
                          onClick={() => { if (publicPrompt !== null) void clipboard.copy(); }}
                          className={styles.copyButton}
                        >
                          {clipboard.status === "copied" ? <Check aria-hidden className={styles.smallIcon} /> : <Copy aria-hidden className={styles.smallIcon} />}
                          {clipboard.status === "copying" ? "复制中" : clipboard.status === "copied" ? "已复制" : "复制提示词"}
                        </button>
                        {remixHref ? (
                          <Link
                            data-gallery-remix
                            href={isAuthenticated ? remixHref : "/login"}
                            prefetch={false}
                            aria-describedby={remixHintId}
                            className={styles.remixButton}
                          >
                            {isAuthenticated ? "做同款" : "登录后做同款"}<ArrowUpRight aria-hidden className={styles.smallIcon} />
                          </Link>
                        ) : (
                          <Link
                            data-gallery-manual-create
                            href={isAuthenticated ? "/create" : "/login"}
                            prefetch={false}
                            aria-describedby={remixFallbackId}
                            className={styles.remixButton}
                          >
                            {isAuthenticated ? GALLERY_MESSAGES.manualCreate : GALLERY_MESSAGES.manualLogin}<ArrowUpRight aria-hidden className={styles.smallIcon} />
                          </Link>
                        )}
                      </div>
                      {clipboard.status === "manual" || clipboard.status === "copied" ? (
                        <p role="status" aria-live="polite" className={styles.copyStatus}>
                          {clipboard.status === "manual" ? GALLERY_MESSAGES.clipboardManual : "完整提示词已复制。"}
                        </p>
                      ) : null}
                      {remixHref && publicPrompt.length > GENERATION_PROMPT_MAX_LENGTH ? (
                        <p className={styles.copyStatus}>{GALLERY_MESSAGES.remixPrefillLimit}</p>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    </HomeReveal>
  );
}
