"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, Layers, PawPrint, PenLine, Sparkle, Terminal } from "lucide-react";

import { CAPABILITIES, PET_IDEAS, PROMPT_PILLS, VERSION_STEPS } from "./constants";
import { HomeReveal } from "./home-reveal";
import { useHomeCycle } from "./hooks/use-home-cycle";
import { useHomeVisibility } from "./hooks/use-home-visibility";
import { usePointerDepth } from "./hooks/use-pointer-depth";
import styles from "./homepage.module.css";

const capabilityIcons = { prompt: PenLine, versions: Layers, pet: PawPrint, api: Terminal };
type CapabilityCardProps = { capability: (typeof CAPABILITIES)[number]; visible: boolean; children: ReactNode };

function CapabilityCard({ capability, visible, children }: CapabilityCardProps) {
  const ref = usePointerDepth<HTMLElement>({ enabled: visible, maxTilt: 0 });
  const Icon = capabilityIcons[capability.id];
  return (
    <article ref={ref} className={styles.capabilityCard} data-home-demo={capability.id}>
      <div className={styles.capabilityCopy}>
        <span className={styles.capabilityIcon}><Icon aria-hidden /></span>
        <h3>{capability.title}</h3>
        <p>{capability.description}</p>
      </div>
      <div className={styles.miniature}>{children}</div>
    </article>
  );
}

export function CapabilitySection() {
  const { ref, visible } = useHomeVisibility<HTMLDivElement>();
  const cycle = useHomeCycle(PROMPT_PILLS.length, visible);
  const [petIdea, setPetIdea] = useState(0);

  return (
    <section id="capabilities" className={styles.capabilities} aria-labelledby="home-capabilities-title">
      <HomeReveal className={styles.container}>
        <div ref={ref} className={styles.linenPanel}>
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}><span>01</span><i aria-hidden /><span>CORE CAPABILITIES · 严选核心能力</span></p>
            <h2 id="home-capabilities-title" className={styles.sectionTitle}>不止于画作生成，更是创作的无限延伸</h2>
            <p className={styles.sectionDescription}>将叙事艺术感融入每一次构思与微调，提供有温度的影像创作体验。</p>
          </div>
          <div className={styles.capabilityGrid}>
            {CAPABILITIES.map((capability) => (
              <CapabilityCard key={capability.id} capability={capability} visible={visible}>
                {capability.id === "prompt" ? (
                  <>
                    <div className={styles.miniatureCaption}><span>从词语开始一束光</span><span>灵感示意</span></div>
                    <div className={styles.promptPills} aria-label="光影灵感词示例">
                      {PROMPT_PILLS.map((pill, index) => <span key={pill} data-active={cycle === index}>{pill}</span>)}
                    </div>
                  </>
                ) : capability.id === "versions" ? (
                  <>
                    <div className={styles.miniatureCaption}><span>迭代示意</span><span data-home-version-label>{VERSION_STEPS[cycle].description}</span></div>
                    <div className={styles.versionSteps} aria-label="创作版本演进示意">
                      {VERSION_STEPS.map((step, index) => <div key={step.title}><span data-active={cycle === index}>{step.title}</span>{index < VERSION_STEPS.length - 1 ? <ArrowRight aria-hidden /> : null}</div>)}
                    </div>
                  </>
                ) : capability.id === "pet" ? (
                  <button type="button" className={styles.petIdea} onClick={() => setPetIdea((index) => (index + 1) % PET_IDEAS.length)} aria-label="换一条构图灵感">
                    <PawPrint aria-hidden className={styles.petIdeaIcon} />
                    <span><strong aria-live="polite">“{PET_IDEAS[petIdea]}”</strong><small>点击换条灵感 · 不改变宠物设置</small></span>
                    <Sparkle aria-hidden className={styles.petIdeaSparkle} />
                  </button>
                ) : (
                  <>
                    <div className={styles.miniatureCaption}><span>接口响应示意</span><span>非实时请求</span></div>
                    <div className={styles.apiDemo}><code>POST /v1/images/generations</code><span><i aria-hidden />200 OK <small>示例响应</small></span></div>
                  </>
                )}
              </CapabilityCard>
            ))}
          </div>
        </div>
      </HomeReveal>
    </section>
  );
}
