import { redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import { GameHead } from "@/components/games/GameHead";
import { isStaffRole } from "@/lib/admin/access";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { itemRef } from "@/lib/content/walk-refs";
import {
  applyGuideUserState,
  getGuidePreview,
  loadGuideReport,
  loadGuideUserState,
  type GameDetail,
  type GuideDetail,
} from "@/lib/queries/games";
import { AchievementList } from "./AchievementList";
import { CommunityTips } from "./CommunityTips";
import { GuideSidebar } from "./GuideSidebar";
import { Roadmap } from "./Roadmap";
import { WalkUserSeed } from "./walk/progress";
import { RobotReport } from "./walk/RobotReport";
import { walkGatedKeys } from "./walk/view";
import { WalkthroughPage } from "./walk/WalkthroughPage";

/**
 * Per-visitor "islands". The page renders the public guide from cache (static shell) and wraps
 * each of these in <Suspense> with the anonymous version as fallback; once the session is read
 * the island swaps in the visitor's own marks. Reads are deduplicated per request.
 */
const sessionUser = cache(getSessionUser);

const guideState = cache(async (guide: GuideDetail) => {
  const user = await sessionUser();
  if (!user) return null;
  return loadGuideUserState(guide, user.id);
});

const gameProgress = cache(async (gameId: string) => {
  const user = await sessionUser();
  if (!user) return null;
  const owned = await prisma.userGame.findUnique({
    where: { userId_gameId_platform: { userId: user.id, gameId, platform: "steam" } },
  });
  return owned ? { unlockedCount: owned.unlockedCount, playtimeMin: owned.playtimeMin } : null;
});

async function viewFor(guide: GuideDetail) {
  const state = await guideState(guide);
  return { loggedIn: state !== null, view: state ? applyGuideUserState(guide, state) : guide };
}

export async function GameHeadIsland({ game }: { game: GameDetail }) {
  return <GameHead game={{ ...game, progress: await gameProgress(game.id) }} />;
}

export async function RoadmapIsland({ guide, returnTo }: { guide: GuideDetail; returnTo: string }) {
  const { loggedIn, view } = await viewFor(guide);
  return <Roadmap steps={view.steps} loggedIn={loggedIn} returnTo={returnTo} />;
}

export async function AchievementsIsland({ guide }: { guide: GuideDetail }) {
  const { view } = await viewFor(guide);
  return <AchievementList achievements={view.achievements} totalCount={view.game.achievementCount} />;
}

export async function TipsIsland({ guide, returnTo }: { guide: GuideDetail; returnTo: string }) {
  const { loggedIn, view } = await viewFor(guide);
  return <CommunityTips tips={view.tips} loggedIn={loggedIn} returnTo={returnTo} />;
}

export async function SidebarIsland({ guide, returnTo }: { guide: GuideDetail; returnTo: string }) {
  const { loggedIn, view } = await viewFor(guide);
  return <GuideSidebar guide={view} loggedIn={loggedIn} returnTo={returnTo} />;
}

/**
 * The signed-in visitor's ticks and Steam progress on a walkthrough (format 2): a few ids the page's
 * client state takes over (WalkUserSeed). Nothing for an anonymous visitor.
 */
export async function WalkUserIsland({ guide }: { guide: GuideDetail }) {
  const state = await guideState(guide);
  if (!state || !guide.walkthrough || !guide.walk) return null;
  const view = applyGuideUserState(guide, state);
  const gated = new Set(walkGatedKeys(guide.walkthrough, guide.walk));
  return (
    <WalkUserSeed
      doneRefs={[...view.itemsDone].map((key) => itemRef(key, gated.has(key)))}
      unlockedIds={Object.values(view.walk!.achievements).flatMap((a) => (a.done ? [a.id] : []))}
      unlockedCount={state.progress?.unlockedCount ?? null}
      pendingXp={view.totals.pendingXp}
    />
  );
}

/** The robot report at the end of a walkthrough: staff (admin, editor) only, never sent to anyone else. */
export async function WalkReportIsland({ guideId }: { guideId: string }) {
  const user = await sessionUser();
  if (!user || !isStaffRole(user.role)) return null;
  return <RobotReport report={await loadGuideReport(guideId)} staff />;
}

/**
 * A walkthrough not published yet (the robot's guides wait in review), for staff only (R12): read
 * uncached, after the session, so it never lands in the public cache. Everyone else gets
 * `fallback` (the achievements-only page), or the game page when there is none.
 */
export async function StaffGuidePreview({ slug, fallback }: { slug: string; fallback: ReactNode }) {
  const user = await sessionUser();
  const guide = user && isStaffRole(user.role) ? await getGuidePreview(slug) : null;
  if (!guide) {
    if (fallback) return <>{fallback}</>;
    redirect(`/jogos/${slug}`);
  }
  return (
    <WalkthroughPage
      guide={guide}
      user={<WalkUserIsland guide={guide} />}
      report={guide.walk ? <WalkReportIsland guideId={guide.walk.guideId} /> : null}
      preview
    />
  );
}
