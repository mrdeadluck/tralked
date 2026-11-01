import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CommunityRanking } from "@/components/news/CommunityRanking";
import { DailyQuestCard } from "@/components/news/DailyQuestCard";
import { DiscordCard } from "@/components/news/DiscordCard";
import { EditorialCard } from "@/components/news/EditorialCard";
import { HeroMain } from "@/components/news/HeroMain";
import { HeroSide } from "@/components/news/HeroSide";
import { NewsTabs } from "@/components/news/NewsTabs";
import { NewsWire } from "@/components/news/NewsWire";
import type { ArticleView } from "@/components/news/ArticleTags";
import { Card } from "@/components/ui/Card";
import { SectionHead } from "@/components/ui/SectionHead";
import { getSessionUser } from "@/lib/auth/session";
import {
  articleStory,
  buildNewsTabs,
  buildWireItems,
  getExternalHeadlines,
  getHomeNews,
  getLatestArticles,
  getMostRead,
  getTodayMission,
  getTopPlayers,
  NEWS_TAG,
  type ArticleCard,
} from "@/lib/queries/news";
import { getReleasesCard, RELEASES_TAG } from "@/lib/queries/releases";
import { ReleasesCard } from "@/components/releases/ReleasesCard";
import { timeAgo } from "@/lib/time-ago";

/** "Em circulação": latest articles and external headlines, cached. */
async function WireSection() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const [articles, external] = await Promise.all([getLatestArticles(10), getExternalHeadlines(6)]);
  const items = buildWireItems(articles, external, new Date());
  return (
    <NewsWire
      // A cached component's root is replayed inside the page's children: keyed, so development
      // React does not report it as a keyless list item.
      key="wire"
      items={items}
      description="Da redação e da imprensa de games, atualizado a cada hora"
      label="Notícias em movimento"
    />
  );
}

/** Main and side highlights, cached. */
async function HighlightsSection() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const { hero, side } = await getHomeNews();
  if (!hero) return null;
  const now = new Date();
  const view = (a: ArticleCard): ArticleView => ({ ...a, timeAgo: timeAgo(a.publishedAt, now) });
  return (
    <section aria-label="Destaques" className="flex flex-wrap gap-3">
      <HeroMain article={view(hero)} />
      {side.length > 0 ? (
        <div className="grid flex-[1_1_520px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {side.map((article) => (
            <HeroSide key={article.slug} article={view(article)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** "Últimas notícias" tabs and "Mais lidas", cached. */
async function LatestSection() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const [{ latest }, mostRead] = await Promise.all([getHomeNews(), getMostRead(5)]);
  const now = new Date();
  return (
    <section aria-label="Últimas notícias" className="flex min-w-0 flex-[1_1_600px] flex-col gap-1">
      <SectionHead title="Últimas notícias" aside={<Link href="/noticias">Todas as notícias →</Link>} />
      {latest.length > 0 ? (
        <NewsTabs tabs={buildNewsTabs(latest, now)} mostRead={mostRead.map((a) => articleStory(a, now))} />
      ) : (
        <p className="py-6 text-[15px] text-muted">Nenhuma notícia publicada ainda.</p>
      )}
    </section>
  );
}

/** "Lançamentos" (Plano 4, F10): latest and upcoming releases, PC first, cached. */
async function ReleasesSection() {
  "use cache";
  cacheLife("hours");
  cacheTag(RELEASES_TAG);

  const data = await getReleasesCard(new Date());
  return (
    <section key="releases" aria-label="Lançamentos" className="flex flex-col gap-4">
      <SectionHead title="Lançamentos" aside={<Link href="/lancamentos">Ver todos →</Link>} />
      <ReleasesCard data={data} />
    </section>
  );
}

async function RankingSection() {
  "use cache";
  cacheLife("minutes");

  return <CommunityRanking players={await getTopPlayers(5)} />;
}

/** Depends on the session cookie, so it renders at request time. */
async function QuestSection() {
  const user = await getSessionUser();
  const mission = user ? await getTodayMission(user.id, new Date()) : null;
  return <DailyQuestCard mission={mission} loggedIn={user !== null} />;
}

const sidebarFallback = <Card className="h-40" aria-hidden="true" />;

/*
 * The wire and the news are cached, so they render in the static shell itself, outside any
 * <Suspense>: a boundary that resolves after the shell is streamed as a hidden <div> that only a
 * script reveals, which would leave the home empty without JavaScript (and for crawlers that do
 * not run it). Only the per-visitor sidebar cards stream behind their own boundaries. No JSX is
 * passed into a cached component (React would re-validate it as a keyless list in development).
 */
export default function Home() {
  return (
    <div className="flex flex-col gap-12">
      <HighlightsSection />
      <ReleasesSection />
      <div className="flex flex-wrap items-start gap-12">
        <LatestSection />
        <aside className="flex max-w-[440px] flex-[1_1_340px] flex-col gap-5">
          <DiscordCard />
          <Suspense fallback={sidebarFallback}>
            <QuestSection />
          </Suspense>
          <RankingSection />
          <EditorialCard />
        </aside>
      </div>
      <WireSection />
    </div>
  );
}
