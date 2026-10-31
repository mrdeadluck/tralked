import type { ReactNode } from "react";
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
      items={items}
      description="Da redação e da imprensa de games, atualizado a cada hora"
      label="Notícias em movimento"
      className="-mt-6"
    />
  );
}

/** Public, cacheable part: highlights + news tabs. `aside` is an opaque slot for the request-time sidebar. */
async function NewsSection({ aside }: { aside: ReactNode }) {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const [{ hero, side, latest }, mostRead] = await Promise.all([getHomeNews(), getMostRead(5)]);
  const now = new Date();
  const view = (a: ArticleCard): ArticleView => ({ ...a, timeAgo: timeAgo(a.publishedAt, now) });

  return (
    <div className="flex flex-col gap-12">
      <section aria-label="Destaques" className="flex flex-wrap gap-3">
        <HeroMain article={view(hero)} />
        <div className="grid flex-[1_1_520px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {side.map((article) => (
            <HeroSide key={article.slug} article={view(article)} />
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-12">
        <section aria-label="Últimas notícias" className="flex min-w-0 flex-[1_1_600px] flex-col gap-1">
          <SectionHead
            title="Últimas notícias"
            aside={<Link href="/noticias">Todas as notícias →</Link>}
          />
          <NewsTabs
            tabs={buildNewsTabs(latest, now)}
            mostRead={mostRead.map((a) => articleStory(a, now))}
          />
        </section>
        {aside}
      </div>
    </div>
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

export default function Home() {
  return (
    <div className="flex flex-col gap-12">
      <Suspense fallback={null}>
        <WireSection />
      </Suspense>
      <Suspense fallback={null}>
        <NewsSection
          aside={
            <aside className="flex max-w-[440px] flex-[1_1_340px] flex-col gap-5">
              <DiscordCard key="discord" />
              <Suspense key="quest" fallback={sidebarFallback}>
                <QuestSection />
              </Suspense>
              <Suspense key="ranking" fallback={sidebarFallback}>
                <RankingSection />
              </Suspense>
              <EditorialCard key="editorial" />
            </aside>
          }
        />
      </Suspense>
    </div>
  );
}
