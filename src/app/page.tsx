import Link from "next/link";
import { unstable_cache } from "next/cache";

import { serializeUser } from "@/lib/prisma-mappers";
import { SiteHeader } from "@/components/marketing/site-header";
import { FeaturedGallery } from "@/components/marketing/featured-gallery";
import { CapabilitySection } from "@/components/marketing/homepage/capability-section";
import { HomeFooter } from "@/components/marketing/homepage/home-footer";
import { HomeHero } from "@/components/marketing/homepage/home-hero";
import { HomeMotionProvider } from "@/components/marketing/homepage/home-motion-provider";
import { HomeReveal } from "@/components/marketing/homepage/home-reveal";
import { GALLERY_PAGE_SIZE } from "@/components/marketing/homepage/gallery-constants";
import styles from "@/components/marketing/homepage/homepage.module.css";
import "@/components/marketing/homepage/fonts.css";

// 首页依赖登录态与精选作品运行时数据，不在构建阶段预渲染。
export const dynamic = "force-dynamic";

type FeaturedPage = Awaited<
  ReturnType<typeof import("@/lib/server/works").listFeaturedWorksPage>
>;
type FeaturedBootstrap = { page: FeaturedPage; failed: boolean };

const EMPTY_FEATURED_PAGE: FeaturedPage = {
  hasMore: false,
  items: [],
  nextCursor: null,
};

// 匿名缓存不含账户数据；登录后的点赞快照必须按 viewer 单独读取。
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

async function getHomeFeaturedPage(userId?: string | null): Promise<FeaturedBootstrap> {
  try {
    if (!userId) {
      return { page: await getAnonymousFeaturedPage(GALLERY_PAGE_SIZE), failed: false };
    }
    const { listFeaturedWorksPage } = await import("@/lib/server/works");
    return { page: await listFeaturedWorksPage({ limit: GALLERY_PAGE_SIZE, viewerId: userId }), failed: false };
  } catch (error) {
    console.error("[Home] Failed to load featured works", error);
    return { page: EMPTY_FEATURED_PAGE, failed: true };
  }
}

export default async function Home() {
  const user = await getHomeUserRecord();
  const currentUser = user ? serializeUser(user) : null;
  const { page: featuredPage, failed } = await getHomeFeaturedPage(user?.id);

  return (
    <HomeMotionProvider>
      <SiteHeader currentUser={currentUser} variant="home" activeHref="/" />
      <main>
        <HomeHero />
        <CapabilitySection />
        <HomeReveal as="section" id="gallery" className={styles.gallery}>
          <div className={styles.container}>
            <div className={styles.galleryHeader}>
              <div>
                <p className={styles.eyebrow}><span>02</span><i aria-hidden /><span>CURATED WORKS · 佳作展映</span></p>
                <div className={styles.galleryTitle}><h2 className={styles.sectionTitle}>社区精选</h2><span>Exhibitions</span></div>
                <p className={styles.sectionDescription}>浏览创作者用 Narra Image 编织的光影故事，展开作品卡片，阅读与复用获准公开的灵感。</p>
              </div>
              <Link href="/create" prefetch={false} className={styles.primaryButton}>开启灵感创作</Link>
            </div>
            <FeaturedGallery
              key={currentUser?.id ?? "guest"}
              works={featuredPage.items}
              initialHasMore={featuredPage.hasMore}
              initialNextCursor={featuredPage.nextCursor}
              initialError={failed}
              isAuthenticated={Boolean(currentUser)}
            />
          </div>
        </HomeReveal>
      </main>
      <HomeFooter isAuthenticated={Boolean(currentUser)} />
    </HomeMotionProvider>
  );
}
