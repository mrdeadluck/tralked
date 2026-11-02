import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { InviteStrip, PlayerStrip } from "@/components/home/PlayerStrip";
import { CommunityRanking } from "@/components/news/CommunityRanking";
import { DiscordCard } from "@/components/news/DiscordCard";
import { EditorialCard } from "@/components/news/EditorialCard";
import { HeroMain } from "@/components/news/HeroMain";
import { MostReadCard } from "@/components/news/MostReadCard";
import { NewsTabs } from "@/components/news/NewsTabs";
import { NewsWire } from "@/components/news/NewsWire";
import type { ArticleView } from "@/components/news/ArticleTags";
import { SectionHead } from "@/components/ui/SectionHead";
import { getSessionUser } from "@/lib/auth/session";
import { dailyPeriodKey } from "@/lib/progression/periods";
import { getHomePlayerCached } from "@/lib/queries/home-player";
import {
  articleStory,
  buildNewsTabs,
  buildWireItems,
  getWireHeadlines,
  getHomeNews,
  getHomeRanking,
  getPressHeadlines,
  getTopPlayers,
  NEWS_TAG,
  withPressHeadlines,
  type ArticleCard,
} from "@/lib/queries/news";
import { getReleasesCard, RELEASES_TAG } from "@/lib/queries/releases";
import { ReleasesCard } from "@/components/releases/ReleasesCard";
import { timeAgo } from "@/lib/time-ago";

/** Stories of the "Últimas" tab the home panel shows: two cards and eight more (no second lead). */
const LATEST_SHOWN = 10;

/**
 * The home's news, read once and cached: the news column and the "Mais lidas" card of the side
 * column share this entry. One headline only, and no story repeats: "Últimas" leaves out the
 * headline, and "Mais visualizadas" (or, before there are views, "Mais lidas") leaves out
 * everything already on screen.
 */
async function homeNews() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const [{ hero, latest }, ranking, press] = await Promise.all([
    getHomeNews(),
    getHomeRanking(20),
    getPressHeadlines(6),
  ]);
  const shown = new Set([hero?.id, ...latest.slice(0, LATEST_SHOWN).map((a) => a.id)]);
  const mostRead = ranking.articles.filter((a) => !shown.has(a.id)).slice(0, 5);
  return { hero, latest, press, mostRead, mostReadTitle: ranking.title };
}

/** The headline and the latest news. */
async function NewsSection() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const { hero, latest, press } = await homeNews();
  const now = new Date();
  const view = (a: ArticleCard): ArticleView => ({ ...a, timeAgo: timeAgo(a.publishedAt, now) });
  return (
    <div key="news" className="flex min-w-0 flex-[1_1_600px] flex-col gap-12">
      {hero ? (
        <section aria-label="Manchete" className="flex">
          <HeroMain article={view(hero)} />
        </section>
      ) : null}
      <section aria-label="Últimas notícias" className="flex min-w-0 flex-col gap-1">
        <SectionHead title="Últimas notícias" />
        {latest.length > 0 ? (
          <NewsTabs
            withLead={false}
            tabs={withPressHeadlines(buildNewsTabs(latest, now), press, now)}
            mostRead={[]}
          />
        ) : hero ? null : (
          <p className="py-6 text-[15px] text-muted">Nenhuma notícia publicada ainda.</p>
        )}
      </section>
    </div>
  );
}

/** "Em circulação": only the press's headlines, since the newsroom's stories are already above. */
async function WireSection() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const items = buildWireItems([], await getWireHeadlines(10), new Date());
  if (items.length === 0) return null;
  return (
    <NewsWire
      // A cached component's root is replayed inside the page's children: keyed, so development
      // React does not report it as a keyless list item.
      key="wire"
      items={items}
      description="Manchetes da imprensa de games, atualizadas a cada hora"
      label="Na imprensa"
    />
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

/** "Mais lidas" in the side column, beside the news it does not repeat. */
async function MostReadSection() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const { mostRead, mostReadTitle } = await homeNews();
  if (mostRead.length === 0) return null;
  const now = new Date();
  return <MostReadCard key="most-read" title={mostReadTitle} stories={mostRead.map((a) => articleStory(a, now))} />;
}

async function RankingSection() {
  "use cache";
  cacheLife("minutes");

  return <CommunityRanking players={await getTopPlayers(5)} />;
}

/**
 * "Sua partida" for a signed-in player (cached per player for a minute), the invitation for a
 * visitor. Depends on the session cookie, so it renders at request time.
 */
async function PlayerSection() {
  const user = await getSessionUser();
  const player = user ? await getHomePlayerCached(user.id, dailyPeriodKey(new Date())) : null;
  return player ? <PlayerStrip player={player} /> : <InviteStrip />;
}

/**
 * Holds the strip's place while it streams, so the news below does not jump: the invitation's
 * height (most visitors), which on wide screens is also the player strip's.
 */
const stripFallback = (
  <div aria-hidden="true" className="h-[108px] rounded-[4px] border border-line bg-surface max-lg:h-[156px] max-sm:h-[216px]" />
);

/*
 * The news and the wire are cached, so they render in the static shell itself, outside any
 * <Suspense>: a boundary that resolves after the shell is streamed as a hidden <div> that only a
 * script reveals, which would leave the home empty without JavaScript (and for crawlers that do
 * not run it). Only the per-visitor strip at the top streams behind its own boundary. No JSX is
 * passed into a cached component (React would re-validate it as a keyless list in development).
 */
export default function Home() {
  return (
    <div className="flex flex-col gap-10">
      <Suspense fallback={stripFallback}>
        <PlayerSection />
      </Suspense>
      <div className="flex flex-wrap items-start gap-12">
        {/* One headline and the news on the left; only releases and the ranking on the right. */}
        <NewsSection />
        <aside className="flex max-w-[440px] flex-[1_1_340px] flex-col gap-8">
          <ReleasesSection />
          <RankingSection />
          <MostReadSection />
        </aside>
      </div>
      <WireSection />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-5">
        <DiscordCard />
        <EditorialCard />
      </div>
    </div>
  );
}
