"use server";

import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { castTipVote } from "@/lib/guide/votes";

export type ToggleStepResult =
  | { status: "ok"; done: boolean }
  | { status: "unauthenticated" }
  | { status: "not_found" };

/** Marks a roadmap step as done, or clears it when it already was. Requires login. */
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

  const result = await castTipVote(tipId, user.id);  if (result.status !== "voted") return result;

  // TODO: call recomputeUser(result.authorUserId) from "@/lib/progression/recompute" once that
  // module lands (built by another task), so the author's level and Sábio skill update right away.
  return { status: "voted", votes: result.votes };
}
