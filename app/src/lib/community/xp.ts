import { toLocalDay } from "@/lib/engine/streak";
import { recomputeUser } from "@/lib/progression/recompute";
import type { Db } from "./limits";
import { COMMENT_XP, COMMENT_XP_DAILY_CAP, FORUM_SOLVED_XP, PHOTO_XP, PHOTO_XP_DAILY_CAP } from "./rewards";

export { COMMENT_XP, COMMENT_XP_DAILY_CAP, FORUM_SOLVED_XP, PHOTO_XP, PHOTO_XP_DAILY_CAP };

/** Ledger sources of the comment XP: a comment or reply, and a forum reply (shared daily cap). */
export const COMMENT_SOURCES = ["comment_posted", "forum_post"] as const;
export type CommentSource = (typeof COMMENT_SOURCES)[number];

/**
 * Credits `COMMENT_XP` (no skills) for a comment or reply (`comment_posted`, sourceKey = commentId)
 * or a forum reply (`forum_post`, sourceKey = postId), unless the user already earned it
 * `COMMENT_XP_DAILY_CAP` times today across both. Locks the user's row like the photo XP, so two
 * posts at once cannot both take the last slot. Idempotent per item. Moderation's "Remover" voids
 * it (lib/admin/moderation). Returns whether a ledger entry was created.
 */
export async function awardCommentXp(
  tx: Db,
  userId: string,
  source: CommentSource,
  sourceKey: string,
  now: Date = new Date(),
): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const recent = await tx.xpLedgerEntry.findMany({
    where: { userId, source: { in: [...COMMENT_SOURCES] }, createdAt: { gte: new Date(now.getTime() - TWO_DAYS_MS) } },
    select: { createdAt: true },
  });
  const today = toLocalDay(now);
  if (recent.filter((e) => toLocalDay(e.createdAt) === today).length >= COMMENT_XP_DAILY_CAP) return false;
  const created = await tx.xpLedgerEntry.createMany({
    data: [{ userId, source, sourceKey, xp: COMMENT_XP, skills: [], createdAt: now }],
    skipDuplicates: true,
  });
  return created.count > 0;
}

const TWO_DAYS_MS = 2 * 86_400_000;

/**
 * Credits `photo_approved` (50 XP, no skills) for `photoId` unless the user already earned it for
 * 3 photos today. Must run inside a transaction: it locks the user's row so concurrent uploads
 * cannot both take the last slot. Idempotent per photo (sourceKey = photoId).
 * Returns whether a ledger entry was created.
 */
export async function awardPhotoXp(
  tx: Db,
  userId: string,
  photoId: string,
  now: Date = new Date(),
): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

  const recent = await tx.xpLedgerEntry.findMany({
    where: {
      userId,
      source: "photo_approved",
      createdAt: { gte: new Date(now.getTime() - TWO_DAYS_MS) },
    },
    select: { createdAt: true },
  });
  const today = toLocalDay(now);
  const earnedToday = recent.filter((e) => toLocalDay(e.createdAt) === today).length;
  if (earnedToday >= PHOTO_XP_DAILY_CAP) return false;

  const created = await tx.xpLedgerEntry.createMany({
    data: [
      { userId, source: "photo_approved", sourceKey: photoId, xp: PHOTO_XP, skills: [], createdAt: now },
    ],
    skipDuplicates: true,
  });
  return created.count > 0;
}

/**
 * Credits `forum_solved` (40 XP in Sábio) to the author of the post marked "Resolveu".
 * Idempotent per post (sourceKey = postId). Returns whether a ledger entry was created.
 */
export async function awardForumSolvedXp(tx: Db, userId: string, postId: string): Promise<boolean> {
  const created = await tx.xpLedgerEntry.createMany({
    data: [
      {
        userId,
        source: "forum_solved",
        sourceKey: postId,
        xp: FORUM_SOLVED_XP,
        skills: ["sabio"],
        skillPoints: { sabio: FORUM_SOLVED_XP },
      },
    ],
    skipDuplicates: true,
  });
  return created.count > 0;
}

/**
 * Refreshes level, skills and attributes after a ledger write. A failure does not undo the
 * community action: the ledger is the source of truth and the next sync recomputes anyway.
 */
export async function recomputeQuietly(userId: string): Promise<void> {
  try {
    await recomputeUser(userId);
  } catch (error) {
    console.error("recomputeUser failed after a community reward", error);
  }
}
