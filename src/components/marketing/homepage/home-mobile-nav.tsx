"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUpRight, Menu, X } from "lucide-react";

import { LogoutButton } from "@/components/auth/logout-button";
import { CheckInButton } from "@/components/benefits/check-in-button";
import { PetToggle } from "@/components/pet/pet-toggle";
import { getThumbUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

import { GITHUB_URL, HOME_MOTION } from "./constants";
import { GithubMark } from "./github-mark";
import { useHomeMotion } from "./hooks/use-home-motion";
import { useHomeNavDialog } from "./hooks/use-home-nav-dialog";
import type { HomeHeaderProps } from "./types";
import styles from "./header.module.css";
import homeStyles from "./homepage.module.css";

export function HomeMobileNav({ currentUser, links, activeHref, checkInSummary }: HomeHeaderProps) {
  const [open, setOpen] = useState(false);
  const onClose = useCallback(() => setOpen(false), []);
  const { triggerRef, dialogRef, portalRef } = useHomeNavDialog({ open, onClose });
  const motionState = useHomeMotion();
  const pathname = usePathname();
  const id = useId();
  const displayName = currentUser?.nickname || currentUser?.id.slice(0, 8);

  return (
    <div className={styles.mobileNav}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className={styles.menuTrigger} aria-label="打开导航菜单" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}><Menu aria-hidden /></button>
      {open ? createPortal(
        <div ref={portalRef} className={cn(homeStyles.scope, styles.headerScope, styles.portal)} data-home-nav-portal>
          <div className={styles.backdrop} onClick={onClose} aria-hidden />
          <motion.div
            ref={dialogRef}
            id={id}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            tabIndex={-1}
            initial={motionState.enabled ? { x: 28, opacity: 0 } : false}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: motionState.enabled ? 0.25 : 0, ease: HOME_MOTION.ease }}
            className={styles.drawer}
          >
            <div className={styles.drawerHeading}>
              <h2 id={`${id}-title`} className={styles.wordmark}><strong>NARRA</strong><span>Image</span><span className={homeStyles.srOnly}>导航菜单</span></h2>
              <button type="button" onClick={onClose} className={styles.menuTrigger} aria-label="关闭导航菜单"><X aria-hidden /></button>
            </div>
            <nav className={styles.drawerLinks} aria-label="移动端主导航">
              {links.map((link) => <Link key={link.href} href={link.href} prefetch={false} onClick={onClose} aria-current={(activeHref || pathname) === link.href ? "page" : undefined}><span>{link.label}</span><ArrowUpRight aria-hidden /></Link>)}
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" onClick={onClose}><span>GitHub 仓库</span><GithubMark /></a>
            </nav>
            {currentUser ? (
              <div className={styles.drawerAccount}>
                <Link href="/settings" prefetch={false} onClick={onClose} className={styles.drawerProfile}>
                  <span className={styles.avatar}>{currentUser.avatarUrl ? <img src={getThumbUrl(currentUser.avatarUrl, 64)} alt="头像" /> : displayName?.[0]?.toUpperCase()}</span>
                  <span><strong>{displayName}</strong><small>{currentUser.role === "admin" ? "管理员 · 个人设置" : "创作者 · 个人设置"}</small></span>
                </Link>
                <div className={styles.drawerCredits}><span>剩余积分 <strong>{currentUser.credits}</strong></span>{checkInSummary ? <CheckInButton checkedInToday={checkInSummary.checkedInToday} rewardCredits={checkInSummary.checkInReward} variant="compact" /> : null}</div>
                <div className={styles.drawerActions}><PetToggle /><LogoutButton /></div>
              </div>
            ) : (
              <div className={styles.drawerGuest}>
                <Link href="/login" prefetch={false} onClick={onClose} className={styles.login}>登录账号</Link>
                <Link href="/register" prefetch={false} onClick={onClose}>注册新账号</Link>
              </div>
            )}
          </motion.div>
        </div>, document.body,
      ) : null}
    </div>
  );
}
