"use client";

import { HERO_STATS } from "./constants";
import { useHomeCountUp } from "./hooks/use-home-count-up";
import { useHomeVisibility } from "./hooks/use-home-visibility";
import styles from "./homepage.module.css";

function formatValue(value: number, format: (typeof HERO_STATS)[number]["format"]) {
  if (format === "decimal") return value.toFixed(1);
  if (format === "comma") return Math.floor(value).toLocaleString("en-US");
  return Math.floor(value).toString();
}

export function HeroStats() {
  const { ref, visible } = useHomeVisibility<HTMLDivElement>();
  const progress = useHomeCountUp(visible);

  return (
    <div ref={ref} className={styles.stats} aria-label="首页展示数据" aria-describedby="home-stats-note">
      <dl className={styles.statGrid}>
        {HERO_STATS.map((stat) => (
          <div key={stat.id} className={styles.stat}>
            <dt className={styles.statLabel}>{stat.label}</dt>
            <dd className={styles.statValue}>
              <span className={styles.srOnly}>{stat.prefix}{formatValue(stat.value, stat.format)}{stat.suffix}</span>
              <span aria-hidden data-home-stat={stat.id}>{stat.prefix}{formatValue(stat.value * progress, stat.format)}{stat.suffix}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p id="home-stats-note" className={styles.statsNote}>沿用首页展示文案，非实时统计或服务测速。</p>
    </div>
  );
}
