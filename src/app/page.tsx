/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { Wand2, Layers, Sparkles, Cpu, ArrowUpRight } from "lucide-react";

import { serializeUser } from "@/lib/prisma-mappers";
import { SiteHeader } from "@/components/marketing/site-header";
import { FeaturedGallery } from "@/components/marketing/featured-gallery";
import { getThumbUrl } from "@/lib/image-url";

const FEATURED_HOME_PAGE_SIZE = 16;

// 首页依赖登录态与精选作品运行时数据，不在构建阶段预渲染。
export const dynamic = "force-dynamic";

type FeaturedPage = Awaited<
  ReturnType<typeof import("@/lib/server/works").listFeaturedWorksPage>
>;

const EMPTY_FEATURED_PAGE: FeaturedPage = {
  hasMore: false,
  items: [],
  nextCursor: null,
};

// 匿名首屏：渠道一致，可按页大小作 key 缓存，管理员改动 60 秒内生效。
const getAnonymousFeaturedPage = unstable_cache(
  async (limit: number) => {
    const { listFeaturedWorksPage } = await import("@/lib/server/works");

    return listFeaturedWorksPage({ limit });
  },
  ["featured-home-anonymous"],
  { revalidate: 60, tags: ["featured-works"] },
);

async function getHomeUserRecord() {
  try {
    const { getCurrentUserRecord } = await import("@/lib/server/current-user");

    return await getCurrentUserRecord();
  } catch (error) {
    console.error("[Home] Failed to load current user", error);
    return null;
  }
}

async function getHomeFeaturedPage(userId?: string | null): Promise<FeaturedPage> {
  try {
    if (!userId) {
      return await getAnonymousFeaturedPage(FEATURED_HOME_PAGE_SIZE);
    }

    const { listFeaturedWorksPage } = await import("@/lib/server/works");

    return await listFeaturedWorksPage({
      limit: FEATURED_HOME_PAGE_SIZE,
      viewerId: userId,
    });
  } catch (error) {
    console.error("[Home] Failed to load featured works", error);
    return EMPTY_FEATURED_PAGE;
  }
}

export default async function Home() {
  const user = await getHomeUserRecord();
  const currentUser = user ? serializeUser(user) : null;
  const featuredPage = await getHomeFeaturedPage(user?.id);
  const works = featuredPage.items;

  // 使用精选作品中的第一张作为 Hero 屏模拟工作台展示大图，避免空白 placeholder。
  const heroImageSrc = works.length > 0 ? getThumbUrl(works[0].image, 1080) : null;
  const heroImagePrompt = works.length > 0 ? works[0].prompt : "A poetic and beautiful landscape painting in warm paper style...";
  const heroImageTitle = works.length > 0 ? works[0].title : "山河漫笔";

  return (
    <main className="relative pb-24 overflow-x-hidden">
      {/* 顶部柔和呼吸感发光气泡 */}
      <div className="absolute top-0 left-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-[#d9643a]/12 to-[#9b5a20]/0 blur-[120px] pointer-events-none" />
      <div className="absolute top-20 right-10 -z-10 h-[450px] w-[450px] rounded-full bg-gradient-to-br from-[#9a77c7]/8 to-[#f1b99a]/0 blur-[100px] pointer-events-none" />

      <SiteHeader currentUser={currentUser} />

      {/* 1. 艺术首屏 (Editorial Hero Section) */}
      <section className="mx-auto max-w-7xl px-5 pt-8 pb-16 md:px-8 md:pt-14 md:pb-24">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-8">
          
          {/* 左侧：品牌价值主张与双 CTA */}
          <div className="flex flex-col text-center lg:col-span-6 lg:text-left">
            <div className="mx-auto flex items-center gap-1.5 rounded-full border border-[#2f1e10]/8 bg-[#fffaf2]/60 px-4 py-1.5 text-xs font-semibold text-[#635347] shadow-[0_4px_12px_rgba(84,52,29,0.03)] backdrop-blur-md lg:mx-0 lg:w-fit">
              <span className="text-[var(--accent)]">✦</span>
              <span>Narra Image 画廊级 AI 影像创作系统</span>
            </div>
            
            <h1 className="mt-6 text-[2.5rem] font-medium tracking-tight text-[var(--ink)] leading-[1.12] sm:text-5xl lg:text-6xl">
              在 <span className="font-serif italic font-semibold text-[var(--accent)] tracking-normal">“叙事性”</span> 的光影中，<br />
              <span className="font-semibold">编织属于你的灵感画面</span>
            </h1>
            
            <p className="mt-6 text-base leading-relaxed text-[var(--ink-soft)] max-w-2xl mx-auto lg:mx-0 lg:max-w-xl">
              Narra Image 融合了前沿的图像生成算法与极具人文温度的画布交互。不论是细致入微的社论写实、天马行空的意象插画，还是优雅温润的多轮细节修补，在这里，每一帧想象都有温度。
            </p>
            
            <div className="mt-10 flex flex-col sm:flex-row sm:items-center justify-center lg:justify-start gap-4">
              <Link
                href="/create"
                prefetch={false}
                className="group relative flex items-center justify-center gap-2 rounded-full bg-[#21170f] px-8 py-4 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(33,23,15,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[var(--accent)]"
              >
                <span>开启我的创作</span>
                <span className="text-lg leading-none transition-transform duration-300 group-hover:translate-x-1">✦</span>
              </Link>
              
              <Link
                href="#gallery"
                className="flex items-center justify-center gap-1.5 rounded-full border border-[var(--line)] bg-[#fffaf2]/30 px-8 py-4 text-sm font-semibold text-[var(--ink)] shadow-[0_8px_20px_rgba(84,52,29,0.02)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#fffaf2]/80"
              >
                <span>探索灵感画廊</span>
                <ArrowUpRight className="size-4 opacity-60" />
              </Link>
            </div>
          </div>

          {/* 右侧：高度拟真的创作台 UI 浮板窗 */}
          <div className="relative mx-auto w-full max-w-lg lg:col-span-6 lg:max-w-none">
            {/* 后方装饰圆环线 */}
            <div className="absolute -inset-4 rounded-[2.5rem] border border-[#2f1e10]/5 [mask-image:radial-gradient(circle_at_bottom,black_40%,transparent_90%)] pointer-events-none" />
            
            {/* 工作台拟态窗口 */}
            <div className="studio-card relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_32px_80px_rgba(94,58,33,0.14)] backdrop-blur-3xl transition-transform duration-500 hover:scale-[1.01]">
              
              {/* 拟态窗口头部工具条 */}
              <div className="mb-3.5 flex items-center justify-between border-b border-[var(--line)] pb-3 px-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-rose-400" />
                  <span className="size-2.5 rounded-full bg-amber-400" />
                  <span className="size-2.5 rounded-full bg-emerald-400" />
                </div>
                <div className="font-mono text-[var(--ink-soft)]/60 select-none">
                  narra-studio // canvas_v2.0
                </div>
                <div className="size-4 shrink-0 rounded bg-[#21170f]/5" />
              </div>

              {/* 核心画布大图展示 */}
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[#fffaf2]/40 shadow-inner">
                {heroImageSrc ? (
                  <img
                    src={heroImageSrc}
                    alt={heroImageTitle}
                    className="size-full object-cover select-none pointer-events-none"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-gradient-to-br from-[#fffaf2] to-[#ebe1d1]/50 text-[var(--ink-soft)]/40 text-xs">
                    精美影像正在展厅装载...
                  </div>
                )}
                
                {/* 装饰图层线 & 辅助十字线 */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-60" />
                <div className="absolute left-4 top-4 select-none rounded bg-black/60 px-2 py-0.5 font-mono text-[9px] font-semibold text-white tracking-widest uppercase">
                  Render Active
                </div>
                
                {/* 浮动 UI 气泡 1: Prompt 提示词展示 */}
                <div className="absolute left-4 right-4 bottom-4 select-none rounded-xl border border-white/10 bg-black/55 p-3 text-white shadow-xl backdrop-blur-md">
                  <div className="flex items-center justify-between gap-2 text-[10px] text-white/50">
                    <span className="font-mono">PROMPT STUDIO</span>
                    <span className="font-semibold text-[var(--accent-soft)]">叙事优化已启用</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs leading-normal font-medium text-white/90">
                    &ldquo;{heroImagePrompt}&rdquo;
                  </p>
                </div>
              </div>

              {/* 外层浮动标签 2: 模式参数展示 (悬漂在窗口外部右下方) */}
              <div className="absolute -right-4 top-1/4 hidden select-none md:flex flex-col gap-1.5 rounded-2xl border border-[var(--line)] bg-[var(--card-strong)] p-3 shadow-lg backdrop-blur-md xl:-right-8 animate-bounce-[duration:6s]">
                <div className="text-[10px] font-semibold text-[var(--ink-soft)]/50">生成参数</div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                  <span className="size-1.5 rounded-full bg-[var(--accent)]" />
                  <span>Narra Editorial XL</span>
                </div>
                <div className="text-[9px] font-mono text-[var(--ink-soft)]">
                  Steps: 30 · CFG: 7.0
                </div>
              </div>

              {/* 外层浮动标签 3: 分辨率比例 (悬漂在窗口外部左下方) */}
              <div className="absolute -left-6 bottom-16 hidden select-none items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card-strong)] px-3 py-1.5 shadow-md backdrop-blur-md md:flex animate-bounce-[duration:8s]">
                <span className="text-xs text-[var(--accent)]">✦</span>
                <span className="text-xs font-semibold text-[var(--ink)] font-mono">Aspect Ratio: 4:3</span>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* 2. 核心特性栅格 (Feature Grid) */}
      <section className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
        <div className="mb-12 flex flex-col items-center text-center">
          <span className="text-xs font-bold tracking-[0.2em] text-[var(--accent)] uppercase">
            PRODUCT FEATURES // 产品核心能力
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">
            不止于画作生成，更是创作的无限延伸
          </h2>
          <p className="mt-3 text-base text-[var(--ink-soft)] max-w-xl">
            我们致力于打破死板的技术界限，将极致艺术质感融入交互中，提供有温度的影像生成系统。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          
          {/* Card 1: Narrative Gen */}
          <div className="studio-card group flex flex-col rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:bg-[var(--card-strong)] hover:shadow-[0_22px_45px_rgba(94,58,33,0.08)]">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] transition-colors group-hover:bg-[var(--accent)] group-hover:text-white">
              <Wand2 className="size-5" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--ink)]">画笔写意 / 叙意生图</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-soft)]">
              精准提炼文字深层的情感与构图隐喻，捕捉极具叙事张力与细腻光影温湿度的高清数字影像。
            </p>
          </div>

          {/* Card 2: Interactive Studio */}
          <div className="studio-card group flex flex-col rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:bg-[var(--card-strong)] hover:shadow-[0_22px_45px_rgba(94,58,33,0.08)]">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] transition-colors group-hover:bg-[var(--accent)] group-hover:text-white">
              <Layers className="size-5" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--ink)]">创作迭代台 / 画布微调</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-soft)]">
              告别繁琐的指令，支持多轮对话迭代与图生图融合。无论是画面重构还是局部抹除微调，体验均自然优雅。
            </p>
          </div>

          {/* Card 3: Pet Companion */}
          <div className="studio-card group flex flex-col rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:bg-[var(--card-strong)] hover:shadow-[0_22px_45px_rgba(94,58,33,0.08)]">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] transition-colors group-hover:bg-[var(--accent)] group-hover:text-white">
              <Sparkles className="size-5" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--ink)]">灵动数字宠物伴读</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-soft)]">
              内置精心绘制的桌面拟真动效小宠物，在您每次灵感迸发、生图成功的瞬间愉快庆祝，为工作环境注入一丝愉悦。
            </p>
          </div>

          {/* Card 4: Lighting Fast API */}
          <div className="studio-card group flex flex-col rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:bg-[var(--card-strong)] hover:shadow-[0_22px_45px_rgba(94,58,33,0.08)]">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] transition-colors group-hover:bg-[var(--accent)] group-hover:text-white">
              <Cpu className="size-5" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--ink)]">极速开发者 API</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-soft)]">
              高并发、低延迟生成能力轻松接驳。利用我们提供的高度弹性与可靠架构，将强大的生成力无缝嵌入您的应用。
            </p>
          </div>

        </div>
      </section>

      {/* 3. 数据丰碑墙 (Stats Panel) */}
      <section className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        <div className="rounded-[2rem] border border-[var(--line)] bg-[#fffaf2]/32 px-8 py-10 md:py-12 backdrop-blur-md">
          <div className="grid grid-cols-1 gap-8 text-center sm:grid-cols-3 sm:divide-x sm:divide-[var(--line)]">
            
            <div className="flex flex-col items-center">
              <span className="font-serif text-4xl font-semibold text-[var(--accent)] tracking-tight md:text-5xl">
                150,000 +
              </span>
              <span className="mt-2 text-xs font-semibold text-[var(--ink-soft)]">
                精美影像已在画布上诞生
              </span>
            </div>

            <div className="flex flex-col items-center">
              <span className="font-serif text-4xl font-semibold text-[var(--ink)] tracking-tight md:text-5xl">
                120 +
              </span>
              <span className="mt-2 text-xs font-semibold text-[var(--ink-soft)]">
                精细融合生成与光影模型
              </span>
            </div>

            <div className="flex flex-col items-center">
              <span className="font-serif text-4xl font-semibold text-[var(--ink)] tracking-tight md:text-5xl">
                &lt; 4.2s
              </span>
              <span className="mt-2 text-xs font-semibold text-[var(--ink-soft)]">
                生成响应延迟，极速出图
              </span>
            </div>

          </div>
        </div>
      </section>

      {/* 4. 艺术展厅与社区精选 (Curated Gallery) */}
      <section id="gallery" className="mx-auto mt-16 max-w-7xl px-5 md:px-8 md:mt-24">
        <div className="mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-5 border-b border-[var(--line)] pb-8">
          <div>
            <span className="text-xs font-bold tracking-[0.2em] text-[var(--accent)] uppercase">
              Curated Works // 现代画廊
            </span>
            <h2 className="mt-2.5 text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">
              社区精选 <span className="font-serif italic font-medium text-[var(--ink-soft)] text-2xl sm:text-3xl ml-1">Exhibitions</span>
            </h2>
            <p className="mt-3 text-sm text-[var(--ink-soft)] max-w-xl">
              探索由全球杰出创作者用画笔与算法共同编织出的绝妙画面，点击即可探寻背后的生成灵感。
            </p>
          </div>
          <Link
            href="/create"
            prefetch={false}
            className="w-full sm:w-fit text-center rounded-full bg-[var(--ink)] px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[var(--accent)] whitespace-nowrap"
          >
            开启我的创作
          </Link>
        </div>

        {works.length > 0 ? (
          <FeaturedGallery
            initialHasMore={featuredPage.hasMore}
            initialNextCursor={featuredPage.nextCursor}
            works={works}
          />
        ) : (
          <div className="studio-card rounded-[2rem] border border-dashed border-[var(--line)] p-12 text-center">
            <h3 className="text-2xl font-semibold text-[var(--ink)]">精选作品还在审核中</h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
              当前还没有公开展示的作品。登录后去创作台生成图片，再到作品页投稿精选。
            </p>
          </div>
        )}
      </section>

    </main>
  );
}
