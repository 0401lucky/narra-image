import Link from "next/link";
import { ArrowUpRight, Sparkle } from "lucide-react";

import { HeroScene } from "./hero-scene";
import { HeroStats } from "./hero-stats";
import styles from "./homepage.module.css";

export function HomeHero() {
  return (
    <section id="hero" className={styles.hero} data-home-hero aria-labelledby="home-title">
      <div className={styles.container}>
        <div className={styles.heroGrid}>
          <div className={styles.heroText}>
            <div>
              <span className={styles.heroBadge}>
                <Sparkle aria-hidden className={styles.badgeIcon} />
                Narra Image 叙事级 AI 影像创作系统
              </span>
            </div>
            <h1 id="home-title" className={styles.headline}>
              <span className={styles.headlineLine}>
                在<span className={styles.emphasis}>“叙事性”<svg aria-hidden viewBox="0 0 100 12" preserveAspectRatio="none"><path d="M2 9 Q50 1 98 8" /></svg></span><span className={styles.headlineTail}>的光影中，</span>
              </span>
              <span className={styles.headlineLine}>编织属于你的灵感画面</span>
            </h1>
            <p className={styles.heroDescription}>
              Narra Image 融合了前沿的图像生成算法与极具人文温度的画布交互。无论是细腻入微的电影级胶片写实、天马行空的绘本插画，还是优雅直观的多轮细节修补，在这里，每一帧想象都有温度。
            </p>
            <div className={styles.heroActions}>
              <Link href="/create" prefetch={false} className={styles.primaryButton}>
                开始我的创作 <Sparkle aria-hidden className={styles.actionSparkle} />
              </Link>
              <a href="#gallery" className={styles.secondaryButton}>
                探索灵感画廊 <ArrowUpRight aria-hidden className={styles.actionIcon} />
              </a>
            </div>
            <HeroStats />
          </div>
          <HeroScene />
        </div>
      </div>
    </section>
  );
}
