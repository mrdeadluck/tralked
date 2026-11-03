import { cache } from "react";
import { GameHead } from "@/components/games/GameHead";
import { isStaffRole } from "@/lib/admin/access";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  applyGuideUserState,
  loadGuideReport,
  loadGuideUserState,
  type GameDetail,
  type GuideDetail,
} from "@/lib/queries/games";
import { AchievementList } from "./AchievementList";
import { CommunityTips } from "./CommunityTips";
import { GuideSidebar } from "./GuideSidebar";
import { Roadmap } from "./Roadmap";
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
 * A walkthrough (format 2) with the visitor's ticks and Steam progress; staff (admin, editor) also
 * get the robot report, which never leaves the server for anyone else.
 */
export async function WalkthroughIsland({ guide }: { guide: GuideDetail }) {
  const user = await sessionUser();
  const state = await guideState(guide);
  if (!user || !state) return <WalkthroughPage guide={guide} viewer={null} />;
  const staff = isStaffRole(user.role);
  const report = staff && guide.walk ? await loadGuideReport(guide.walk.guideId) : null;
  return (
    <WalkthroughPage
      guide={{ ...applyGuideUserState(guide, state), report }}
      viewer={{ id: user.id, handle: user.handle, staff }}
    />
  );
}
