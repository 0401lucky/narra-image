/* eslint-disable @next/next/no-img-element */

import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";
import { CheckInButton } from "@/components/benefits/check-in-button";
import { PetToggle } from "@/components/pet/pet-toggle";
import { getThumbUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

import { MobileNav } from "../mobile-nav";
import { GITHUB_URL } from "./constants";
import { GithubMark } from "./github-mark";
import type { HomeHeaderProps } from "./types";
import styles from "./header.module.css";
import homeStyles from "./homepage.module.css";

export function HomeHeader({ currentUser, links, activeHref, className, checkInSummary }: HomeHeaderProps) {
  const displayName = currentUser?.nickname || currentUser?.id;
  return (
    <header className={cn(homeStyles.scope, styles.headerScope, styles.header, className)}>
      <div className={styles.brand}>
        <Link href="/" prefetch={false} className={styles.wordmark} aria-label="Narra Image 首页"><strong>NARRA</strong><span>Image</span></Link>
        <a className={styles.github} href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub 仓库" title="GitHub 仓库"><GithubMark /></a>
      </div>
      <nav className={styles.navigation} aria-label="主导航">
        {links.map((link) => <Link key={link.href} href={link.href} prefetch={false} aria-current={activeHref === link.href ? "page" : undefined}>{link.label}</Link>)}
      </nav>
      <div className={styles.account}>
        {currentUser ? (
          <>
            <div className={styles.credits}><span>剩余积分</span><strong>{currentUser.credits}</strong></div>
            {checkInSummary ? <span className={styles.checkIn}><CheckInButton checkedInToday={checkInSummary.checkedInToday} rewardCredits={checkInSummary.checkInReward} variant="compact" /></span> : null}
            <span className={styles.pet}><PetToggle /></span>
            <Link href="/settings" prefetch={false} className={styles.avatar} aria-label="个人设置" title={displayName || "个人设置"}>
              {currentUser.avatarUrl ? <img src={getThumbUrl(currentUser.avatarUrl, 64)} alt="头像" loading="lazy" decoding="async" /> : <span>{displayName?.[0]?.toUpperCase()}</span>}
            </Link>
            <span className={styles.logout}><LogoutButton /></span>
          </>
        ) : <Link href="/login" prefetch={false} className={styles.login}>登录开启</Link>}
        <MobileNav variant="home" currentUser={currentUser} links={[...links]} activeHref={activeHref} checkInSummary={checkInSummary} />
      </div>
    </header>
  );
}
