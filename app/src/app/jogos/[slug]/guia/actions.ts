"use server";

import { updateTag } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { castTipVoteAndRecompute } from "@/lib/guide/votes";
import { gameTag } from "@/lib/queries/games-cached";
import { weeklyXpOf } from "@/lib/highscores/queries";
import { levelChange, levelProgress, rewardOf, type Reward } from "@/lib/progression/reward";
import { walkItemKeys, walkthroughSchema } from "@/lib/content/walkthrough-schema";
import { claimGameCheckSlot } from "@/lib/sync/game-check";
import { syncUserGame } from "@/lib/sync/user";

export type ToggleStepResult =
  | { status: "ok"; done: boolean }
  | { status: "unauthenticated" }
  | { status: "not_found" };

/**
 * Marks a roadmap step as done, or clears it when it already was. Requires login.
 * Step progress is per user and not part of the cached public guide, so nothing to revalidate.
 */
export async function toggleStep(stepId: string): Promise<ToggleStepResult> {
  const user = await getSessionUser();
  if (!user) return { status: "unauthenticated" };

  const step = await prisma.guideStep.findUnique({ where: { id: stepId }, select: { id: true } });
  if (!step) return { status: "not_found" };

  const removed = await prisma.guideStepProgress.deleteMany({
    where: { userId: user.id, stepId },
  });
  if (removed.count > 0) return { status: "ok", done: false };

  await prisma.guideStepProgress.createMany({
    data: [{ userId: user.id, stepId }],
    skipDuplicates: true,
  });
  return { status: "ok", done: true };
}

export type VoteTipResult =
  | { status: "voted"; votes: number }
  | { status: "already_voted" }
  | { status: "own_tip" }
  | { status: "unauthenticated" }
  | { status: "not_found" };

/** Votes a community tip as useful; the tip author earns 25 XP in Sábio. Requires login. */
export async function voteTip(tipId: string): Promise<VoteTipResult> {
  const user = await getSessionUser();
  if (!user) return { status: "unauthenticated" };

  const result = await castTipVoteAndRecompute(tipId, user.id);
  if (result.status !== "voted") return result;

  // The public guide (cached) shows each tip's vote count: expire it so the next render is fresh.
  const tip = await prisma.guideTip.findUnique({
    where: { id: tipId },
    select: { guide: { select: { game: { select: { slug: true } } } } },
  });
  if (tip) updateTag(gameTag(tip.guide.game.slug));

  return { status: "voted", votes: result.votes };
}

export type ToggleItemResult =
  | { status: "ok"; done: boolean }
  | { status: "unauthenticated" }
  | { status: "not_found" };

/**
 * Ticks a walkthrough item of a published guide, or clears it when it already was. Requires login.
 * A manual tick never gives XP: only Steam's confirmation does (checkGameAchievements).
 */
export async function toggleItem(guideId: string, itemKey: string): Promise<ToggleItemResult> {
  const user = await getSessionUser();
  if (!user) return { status: "unauthenticated" };

  const guide = await prisma.guide.findFirst({
    where: { id: guideId, status: "published", format: 2 },
    select: { walkthrough: true },
  });
  const walkthrough = walkthroughSchema.safeParse(guide?.walkthrough);
  if (!walkthrough.success || !walkItemKeys(walkthrough.data).includes(itemKey)) return { status: "not_found" };

  const removed = await prisma.guideItemProgress.deleteMany({ where: { userId: user.id, guideId, itemKey } });
  if (removed.count > 0) return { status: "ok", done: false };
  await prisma.guideItemProgress.createMany({ data: [{ userId: user.id, guideId, itemKey }], skipDuplicates: true });
  return { status: "ok", done: true };
}

export type CheckGameAchievementsResult = {
  status: "ok" | "private" | "unlinked" | "cooldown";
  newUnlocks: { apiName: string; name: string; iconUrl: string | null }[];
  reward: Reward | null;
};

const NOTHING = (status: CheckGameAchievementsResult["status"]): CheckGameAchievementsResult => ({
  status,
  newUnlocks: [],
  reward: null,
});

/**
 * Asks Steam for the logged-in user's achievements of this one game and records them through the
 * same path as the full sync (XP, anti-fraud, missions, level). At most one check per 15 s.
 * Without Steam linked, or with a private profile, nothing is recorded and no XP is paid.
 */
export async function checkGameAchievements(gameId: string): Promise<CheckGameAchievementsResult> {
  const user = await getSessionUser();
  if (!user) return NOTHING("unlinked");
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { steamAppId: true } });
  if (!game?.steamAppId) return NOTHING("unlinked");
  if (!(await prisma.user.findUnique({ where: { id: user.id }, select: { steamId: true } }))?.steamId) {
    return NOTHING("unlinked");
  }
  if (!(await claimGameCheckSlot(user.id))) return NOTHING("cooldown");

  const statsOf = () =>
    prisma.userStats.findUnique({ where: { userId: user.id }, select: { level: true, totalXp: true } });
  const before = await statsOf();
  let result;
  try {
    result = await syncUserGame(user.id, game.steamAppId);
  } catch (error) {
    console.error("checkGameAchievements failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NOTHING("ok");
  }
  if (result.status !== "ok") return NOTHING(result.status);

  const newUnlocks = await prisma.achievement.findMany({
    where: { gameId, platform: "steam", apiName: { in: result.newUnlocks } },
    select: { apiName: true, name: true, namePt: true, iconUrl: true },
  });
  const after = await statsOf();
  const xpGained = Math.max(0, (after?.totalXp ?? 0) - (before?.totalXp ?? 0));
  return {
    status: "ok",
    newUnlocks: newUnlocks.map((a) => ({ apiName: a.apiName, name: a.namePt ?? a.name, iconUrl: a.iconUrl })),
    reward: rewardOf(xpGained, "Conquista", {
      levelUp: levelChange(before?.level, after?.level),
      progress: after ? levelProgress(after.totalXp, xpGained) : null,
      weekXp: after && xpGained > 0 ? await weeklyXpOf(user.id) : null,
    }),
  };
}
