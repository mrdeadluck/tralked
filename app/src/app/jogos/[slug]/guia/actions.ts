"use server";

import { updateTag } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { castTipVoteAndRecompute } from "@/lib/guide/votes";
import { gameTag } from "@/lib/queries/games-cached";

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