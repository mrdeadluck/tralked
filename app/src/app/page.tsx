import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CommunityRanking } from "@/components/news/CommunityRanking";
import { DailyQuestCard } from "@/components/news/DailyQuestCard";
import { DiscordCard } from "@/components/news/DiscordCard";
import { EditorialCard } from "@/components/news/EditorialCard";
import { HeroMain } from "@/components/news/HeroMain";
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
  getWireHeadlines,
  getHomeNews,
  getMostRead,
  getPressHeadlines,
  getTodayMission,
  getTopPlayers,
  NEWS_TAG,
  withPressHeadlines,
  type ArticleCard,
} from "@/lib/queries/news";
import { getReleasesCard, RELEASES_TAG } from "@/lib/queries/releases";
import { ReleasesCard } from "@/components/releases/ReleasesCard";
import { timeAgo } from "@/lib/time-ago";

/** Stories of the "Últimas" tab the panel shows: the lead, two secondary and eight more. */
const LATEST_SHOWN = 11;

/**
 * The headline and the latest news, cached. One headline only, and no story repeats: "Últimas"
 * leaves out the headline, and "Mais lidas" leaves out everything already on screen.
 */
async function NewsSection() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const [{ hero, latest }, mostRead, press] = await Promise.all([getHomeNews(), getMostRead(20), getPressHeadlines(6)]);
  const now = new Date();
  const view = (a: ArticleCard): ArticleView => ({ ...a, timeAgo: timeAgo(a.publishedAt, now) });
  const shown = new Set([hero?.id, ...latest.slice(0, LATEST_SHOWN).map((a) => a.id)]);
  const unseenMostRead = mostRead.filter((a) => !shown.has(a.id)).slice(0, 5);
  return (
    <div key="news" className="flex min-w-0 flex-[1_1_600px] flex-col gap-12">
      {hero ? (
        <section aria-label="Manchete" className="flex">
          <HeroMain article={view(hero)} />
        </section>
      ) : null}
      <section aria-label="Últimas notícias" className="flex min-w-0 flex-col gap-1">
        <SectionHead title="Últimas notícias" aside={<Link href="/noticias">Todas as notícias →</Link>} />
        {latest.length > 0 ? (
          <NewsTabs
            tabs={withPressHeadlines(buildNewsTabs(latest, now), press, now)}
            mostRead={unseenMostRead.map((a) => articleStory(a, now))}
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

async function RankingSection() {
  "use cache";
  cacheLife("minutes");

  return <CommunityRanking players={await getTopPlayers(5)} />;
}

/** Below the ranking: the way in is connecting a Steam account. */
function SteamInvite() {
  return (
    <div className="rounded-[4px] border border-dashed border-line-2 p-4 text-[14px] text-muted">
      <p>Conecte sua Steam e entre no ranking da comunidade.</p>
      <Link
        href="/conta/conexoes"
        className="mt-3 inline-flex min-h-11 items-center rounded-[4px] bg-acc px-[18px] text-[14px] font-extrabold text-bg"
      >
        Conectar a Steam
      </Link>
    </div>
  );
}

/** Depends on the session cookie, so it renders at request time. */
async function QuestSection() {
  const user = await getSessionUser();
  const mission = user ? await getTodayMission(user.id, new Date()) : null;
  return <DailyQuestCard mission={mission} loggedIn={user !== null} />;
}

const sidebarFallback = <Card className="h-40" aria-hidden="true" />;

/*
 * The news and the wire are cached, so they render in the static shell itself, outside any
 * <Suspense>: a boundary that resolves after the shell is streamed as a hidden <div> that only a
 * script reveals, which would leave the home empty without JavaScript (and for crawlers that do
 * not run it). Only the per-visitor quest card streams behind its own boundary. No JSX is passed
 * into a cached component (React would re-validate it as a keyless list in development).
 */
export default function Home() {
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-start gap-12">
        {/* One headline and the news on the left; only releases and the ranking on the right. */}
        <NewsSection />
        <aside className="flex max-w-[440px] flex-[1_1_340px] flex-col gap-5">
          <ReleasesSection />
          <RankingSection />
          <SteamInvite />
        </aside>
      </div>
      <WireSection />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-5">
        <DiscordCard />
        <Suspense fallback={sidebarFallback}>
          <QuestSection />
        </Suspense>
        <EditorialCard />
      </div>
    </div>
  );
}
