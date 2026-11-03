import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Comments } from "@/components/community/Comments";
import { ReactionBar } from "@/components/community/ReactionBar";
import { GuideModeration } from "@/components/moderation/Islands";
import { FactsStrip } from "@/components/games/FactsStrip";
import { GameHead } from "@/components/games/GameHead";
import { AchievementsOnly } from "@/components/guide/AchievementsOnly";
import { maskHidden } from "@/lib/queries/achievements-only";
import { AchievementList } from "@/components/guide/AchievementList";
import { Collectibles } from "@/components/guide/Collectibles";
import { CommunityTips } from "@/components/guide/CommunityTips";
import { GuideSidebar } from "@/components/guide/GuideSidebar";
import { Overview } from "@/components/guide/Overview";
import { Revisions } from "@/components/guide/Revisions";
import { Roadmap } from "@/components/guide/Roadmap";
import { Sources } from "@/components/guide/Sources";
import {
  AchievementsIsland,
  GameHeadIsland,
  RoadmapIsland,
  SidebarIsland,
  StaffGuidePreview,
  TipsIsland,
  WalkReportIsland,
  WalkUserIsland,
} from "@/components/guide/UserIslands";
import { GuideUnavailable } from "@/components/guide/walk/GuideUnavailable";
import { WalkthroughPage } from "@/components/guide/walk/WalkthroughPage";
import { guideIdCached } from "@/lib/community/cached";
import { listGameSlugs } from "@/lib/queries/games";
import {
  getAchievementsOnlyCached,
  getGameCached,
  getGuideCached,
  hasGuidePreviewCached,
} from "@/lib/queries/games-cached";
import { howToJsonLd, JsonLd } from "@/lib/seo/json-ld";
import { gameMetadata } from "../metadata";

export async function generateStaticParams() {
  // The same games as /jogos/[slug], not only those with a guide: games without one prerender
  // their redirect. Cache Components needs at least one sample: on an empty catalog the
  // placeholder renders a real 404; unknown slugs render on demand.
  const slugs = await listGameSlugs();
  return (slugs.length > 0 ? slugs : ["exemplo"]).map((slug) => ({ slug }));
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
    const only = await getAchievementsOnlyCached(slug);
    const onlyPage = only ? (
      <>
        <GameHead game={only.game} />
        <AchievementsOnly lists={maskHidden(only.lists)} />
      </>
    ) : null;
    if (await hasGuidePreviewCached(slug)) {
      // A walkthrough still in review: staff preview it here (read after the session, uncached);
      // everyone else gets what the page shows without a guide.
      return (
        <Suspense fallback={onlyPage}>
          <StaffGuidePreview slug={slug} fallback={onlyPage} />
        </Suspense>
      );
    }
    if (onlyPage) return onlyPage;
    if (await getGameCached(slug)) redirect(`/jogos/${slug}`);
    notFound();
  }

  const returnTo = `/jogos/${slug}/guia`;
  const now = guide.game.generatedAt;
  const guideId = await guideIdCached(guide.game.id);
  const community = guideId ? (
    <>
      <ReactionBar targetType="guide" targetId={guideId} prompt="Este guia ajudou?" what="este guia" returnTo={returnTo} />
      <GuideModeration guideId={guideId} gameName={guide.game.name} returnTo={returnTo} />
      <Comments targetType="guide" targetId={guideId} />
    </>
  ) : null;

  // A walkthrough whose stored data is invalid (logged by getGuidePublic) never renders as a classic guide.
  if (guide.format === 2 && !guide.walkthrough) return <GuideUnavailable game={guide.game} />;

  if (guide.format === 2 && guide.walkthrough) {
    // The walkthrough of the guide robot, from cache; only the visitor's ticks and progress (a few
    // ids) and, for staff, the robot report stream in.
    return (
      <>
        <JsonLd data={howToJsonLd(guide)} />
        <WalkthroughPage
          guide={guide}
          user={
            <Suspense fallback={null}>
              <WalkUserIsland guide={guide} />
            </Suspense>
          }
          report={
            guide.walk ? (
              <Suspense fallback={null}>
                <WalkReportIsland guideId={guide.walk.guideId} />
              </Suspense>
            ) : null
          }
        />
        <div className="mt-14 flex flex-col gap-14">{community}</div>
      </>
    );
  }

  return (
    <>
      <JsonLd data={howToJsonLd(guide)} />
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
          <Sources sources={guide.sources} />
          {community}
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
