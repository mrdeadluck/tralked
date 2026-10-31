import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Comments } from "@/components/community/Comments";
import { FactsStrip } from "@/components/games/FactsStrip";
import { GameHead } from "@/components/games/GameHead";
import { AchievementList } from "@/components/guide/AchievementList";
import { Collectibles } from "@/components/guide/Collectibles";
import { CommunityTips } from "@/components/guide/CommunityTips";
import { GuideSidebar } from "@/components/guide/GuideSidebar";
import { Overview } from "@/components/guide/Overview";
import { Revisions } from "@/components/guide/Revisions";
import { Roadmap } from "@/components/guide/Roadmap";
import {
  AchievementsIsland,
  GameHeadIsland,
  RoadmapIsland,
  SidebarIsland,
  TipsIsland,
} from "@/components/guide/UserIslands";
import { guideIdCached } from "@/lib/community/cached";
import { listGameSlugs } from "@/lib/queries/games";
import { getGameCached, getGuideCached } from "@/lib/queries/games-cached";
import { gameMetadata } from "../metadata";

export async function generateStaticParams() {
  // Every game, not only those with a guide: games without one prerender their redirect.
  return (await listGameSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/jogos/[slug]/guia">): Promise<Metadata> {
  const { slug } = await params;
  return gameMetadata(slug);
}

export default async function GuidePage({ params }: PageProps<"/jogos/[slug]/guia">) {
  // The guide text comes from cache, so unknown slugs / games without a guide resolve to a real
  // 404 / redirect before any Suspense boundary. Only the visitor's own marks stream in.
  const { slug } = await params;
  const guide = await getGuideCached(slug);
  if (!guide) {
    if (await getGameCached(slug)) redirect(`/jogos/${slug}`);
    notFound();
  }

  const returnTo = `/jogos/${slug}/guia`;
  const now = guide.game.generatedAt;
  const guideId = await guideIdCached(guide.game.id);

  return (
    <>
      <Suspense fallback={<GameHead game={guide.game} />}>
        <GameHeadIsland game={guide.game} />
      </Suspense>
      <FactsStrip facts={guide.facts} totalXp={guide.totals.xp} />
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)_320px] items-start gap-12 max-[1100px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-14">
          <Overview overview={guide.overview} warnings={guide.warnings} />
          <Suspense
            fallback={<Roadmap steps={guide.steps} loggedIn={false} returnTo={returnTo} pending />}
          >
            <RoadmapIsland guide={guide} returnTo={returnTo} />
          </Suspense>
          <Suspense
            fallback={
              <AchievementList
                achievements={guide.achievements}
                totalCount={guide.game.achievementCount}
              />
            }
          >
            <AchievementsIsland guide={guide} />
          </Suspense>
          <Collectibles collectibles={guide.collectibles} />
          <Suspense
            fallback={
              <CommunityTips tips={guide.tips} loggedIn={false} returnTo={returnTo} pending />
            }
          >
            <TipsIsland guide={guide} returnTo={returnTo} />
          </Suspense>
          <Revisions revisions={guide.revisions} now={now} />
          {guideId ? <Comments targetType="guide" targetId={guideId} /> : null}
        </div>
        <Suspense
          fallback={<GuideSidebar guide={guide} loggedIn={false} returnTo={returnTo} pending />}
        >
          <SidebarIsland guide={guide} returnTo={returnTo} />
        </Suspense>
      </div>
    </>
  );
}
