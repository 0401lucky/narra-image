import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { FOOTER_CREATION_LINKS, FOOTER_EXPLORE_LINKS } from "./constants";
import styles from "./homepage.module.css";

type HomeFooterProps = { isAuthenticated: boolean };

export function HomeFooter({ isAuthenticated }: HomeFooterProps) {
  return (
    <footer id="footer" className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <a href="#hero" className={styles.footerWordmark} aria-label="Narra Image 返回首页顶部"><strong>NARRA</strong><span>Image</span></a>
            <p>在“叙事性”的光影中，编织属于你的灵感画面。融合视觉生成与温暖的画布交互，让每一帧想象找到自己的故事。</p>
          </div>
          <nav className={styles.footerColumns} aria-label="页脚导航">
            <div>
              <h2>创作空间</h2>
              <ul>{FOOTER_CREATION_LINKS.map((link) => <li key={link.href}><Link href={link.href} prefetch={false}>{link.label}</Link></li>)}</ul>
            </div>
            <div>
              <h2>工具与账户</h2>
              <ul>
                <li><Link href="/works" prefetch={false}>个人作品{isAuthenticated ? "" : "（需登录）"}</Link></li>
                <li><Link href="/settings" prefetch={false}>账户设置{isAuthenticated ? "" : "（需登录）"}</Link></li>
                <li><Link href={isAuthenticated ? "/api-keys" : "/login"} prefetch={false}>{isAuthenticated ? "开发者 API" : "登录账号"}</Link></li>
              </ul>
            </div>
            <div>
              <h2>发现 Narra</h2>
              <ul>{FOOTER_EXPLORE_LINKS.map((link) => <li key={link.href}><a href={link.href} {...(link.href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{link.label}{link.href.startsWith("https:") ? <ArrowUpRight aria-hidden /> : null}</a></li>)}</ul>
            </div>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>Narra Image · 为每一帧想象留一束光</span>
          <span>Crafted for visual storytellers &amp; dreamers.</span>
        </div>
      </div>
    </footer>
  );
}
