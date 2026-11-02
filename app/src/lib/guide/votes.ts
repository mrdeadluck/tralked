import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TIP_VOTE_XP } from "@/lib/community/rewards";
import { recomputeUser } from "@/lib/progression/recompute";

export { TIP_VOTE_XP };

export type CastTipVoteResult =
  | { status: "voted"; authorUserId: string | null; votes: number }
  | { status: "already_voted" }
  | { status: "own_tip" }
  | { status: "not_found" };

/** Same as `castTipVote`, but inside a transaction the caller already owns. */
export async function castTipVoteIn(
  db: Prisma.TransactionClient,
  tipId: string,
  voterUserId: string,
): Promise<CastTipVoteResult> {
  const tip = await db.guideTip.findUnique({
    where: { id: tipId },
    select: { authorId: true },
  });
  if (!tip) return { status: "not_found" };
  if (tip.authorId === voterUserId) return { status: "own_tip" };

  // skipDuplicates makes concurrent double clicks safe: only one insert reports count 1.
  const created = await db.guideVote.createMany({
    data: [{ userId: voterUserId, tipId }],
    skipDuplicates: true,
  });
  if (created.count === 0) return { status: "already_voted" };

  const updated = await db.guideTip.update({
    where: { id: tipId },
    data: { votes: { increment: 1 } },
    select: { votes: true },
  });

  if (tip.authorId) {
    await db.xpLedgerEntry.createMany({
      data: [
        {
          userId: tip.authorId,
          source: "guide_vote",
          sourceKey: `${tipId}:${voterUserId}`,
          xp: TIP_VOTE_XP,
          skills: ["sabio"],
        },
      ],
      skipDuplicates: true,
    });
  }

  return { status: "voted", authorUserId: tip.authorId, votes: updated.votes };
}

/**
 * Registers `voterUserId`'s vote on a guide tip. Idempotent: a second call changes nothing.
 * The tip author (if they have a user) receives a `guide_vote` ledger entry worth 25 XP in Sábio;
 * `sourceKey` = `${tipId}:${voterUserId}` keeps the ledger entry unique per vote.
 *
 * The caller is responsible for recomputing the author's stats after a `voted` result.
 */
export function castTipVote(tipId: string, voterUserId: string): Promise<CastTipVoteResult> {
  return prisma.$transaction((tx) => castTipVoteIn(tx, tipId, voterUserId));
}

/**
 * `castTipVote`, then refresh the tip author's level and skills from the ledger. The recompute
 * runs only when a ledger entry was just created (a first vote on a tip whose author has a user).
 * A failing recompute does not undo the vote: the ledger is the source of truth and the next sync
 * recomputes the author anyway.
 */
export async function castTipVoteAndRecompute(
  tipId: string,
  voterUserId: string,
): Promise<CastTipVoteResult> {
  const result = await castTipVote(tipId, voterUserId);
  if (result.status === "voted" && result.authorUserId) {
    try {
      await recomputeUser(result.authorUserId);
    } catch (error) {
      console.error("recomputeUser failed after a guide vote", error);
    }
  }
  return result;
}
