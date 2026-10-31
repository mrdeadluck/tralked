import type { ReactNode } from "react";
import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { CommunityRanking } from "@/components/news/CommunityRanking";
import { DailyQuestCard } from "@/components/news/DailyQuestCard";
import { DiscordCard } from "@/components/news/DiscordCard";
import { EditorialCard } from "@/components/news/EditorialCard";
import { HeroMain } from "@/components/news/HeroMain";
import { HeroSide } from "@/components/news/HeroSide";
import { NewsList } from "@/components/news/NewsList";
import type { ArticleView } from "@/components/news/ArticleTags";
import { Card } from "@/components/ui/Card";
import { SectionHead } from "@/components/ui/SectionHead";
import { getSessionUser } from "@/lib/auth/session";
import { getHomeNews, getTodayMission, getTopPlayers, type ArticleCard } from "@/lib/queries/news";
import { timeAgo } from "@/lib/time-ago";

/** Public, cacheable part: highlights + latest news. `aside` is an opaque slot for the request-time sidebar. */
async function NewsSection({ aside }: { aside: ReactNode }) {
  "use cache";
  cacheLife("minutes");

  const { hero, side, latest } = await getHomeNews();
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
        <section className="flex min-w-0 flex-[1_1_600px] flex-col">
          <SectionHead title="Últimas notícias" />
          <NewsList articles={latest.map(view)} />
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
    <Suspense fallback={null}>
      <NewsSection
        aside={
          <aside className="flex max-w-[440px] flex-[1_1_340px] flex-col gap-5">
            <DiscordCard />
            <Suspense fallback={sidebarFallback}>
              <QuestSection />
            </Suspense>
            <Suspense fallback={sidebarFallback}>
              <RankingSection />
            </Suspense>
            <EditorialCard />
          </aside>
        }
      />
    </Suspense>
  );
}
