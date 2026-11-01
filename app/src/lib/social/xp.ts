import type { Db } from "@/lib/community/limits";
import {
  COMMENT_HELPFUL_XP,
  COMMENT_LIKE_XP,
  helpfulReward,
  helpfulSourceKey,
  likeReward,
  likeSourceKey,
  type RewardDecision,
  type SocialItemKind,
} from "@/lib/engine/social";
import { toLocalDay } from "@/lib/engine/streak";

const TWO_DAYS_MS = 2 * 86_400_000;

type Source = "comment_liked" | "comment_helpful";

/** Locks both users' rows (in id order: no deadlock) so concurrent rewards cannot both take the last slot. */
async function lockPair(tx: Db, a: string, b: string) {
  for (const id of [a, b].sort()) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
}

/**
 * Today's (America/Sao_Paulo) entries of `source` for the receiver, and between the pair in both
 * directions. Voided entries count too: a slot used today stays used.
 */
async function todayCounts(tx: Db, source: Source, receiverId: string, actorId: string, now: Date) {
  const since = new Date(now.getTime() - TWO_DAYS_MS);
  const today = toLocalDay(now);
  const [received, pair] = await Promise.all([
    tx.xpLedgerEntry.findMany({ where: { userId: receiverId, source, createdAt: { gte: since } }, select: { createdAt: true } }),
    // Like entries carry the liker in their key; helpful entries go through the item's author
    // (the actor here), so the pair is matched on the receivers' ledgers both ways.
    source === "comment_liked"
      ? tx.xpLedgerEntry.findMany({
          where: {
            source,
            createdAt: { gte: since },
            OR: [
              { userId: receiverId, sourceKey: { endsWith: `:${actorId}` } },
              { userId: actorId, sourceKey: { endsWith: `:${receiverId}` } },
            ],
          },
          select: { createdAt: true },
        })
      : Promise.resolve(null),
  ]);
  const isToday = (e: { createdAt: Date }) => toLocalDay(e.createdAt) === today;
  return { receiverToday: received.filter(isToday).length, pair: pair?.filter(isToday).length ?? null };
}

export type RewardResult = { paid: boolean; decision: RewardDecision };

/**
 * Pays `comment_liked` (5 XP, no skills) to the author of a liked comment or post within the caps
 * of lib/engine/social.ts. Idempotent per liker and item (sourceKey). Run inside a transaction.
 */
export async function awardLikeXp(
  tx: Db,
  kind: SocialItemKind,
  itemId: string,
  receiverId: string | null,
  likerId: string,
  now: Date = new Date(),
): Promise<RewardResult> {
  if (!receiverId || receiverId === likerId) {
    const decision = likeReward({ receiverId, actorId: likerId, receiverToday: 0, pairToday: 0 });
    return { paid: false, decision };
  }
  await lockPair(tx, receiverId, likerId);
  const counts = await todayCounts(tx, "comment_liked", receiverId, likerId, now);
  const decision = likeReward({
    receiverId,
    actorId: likerId,
    receiverToday: counts.receiverToday,
    pairToday: counts.pair ?? 0,
  });
  if (!decision.pay) return { paid: false, decision };
  const created = await tx.xpLedgerEntry.createMany({
    data: [
      {
        userId: receiverId,
        source: "comment_liked",
        sourceKey: likeSourceKey(kind, itemId, likerId),
        xp: COMMENT_LIKE_XP,
        skills: [],
        createdAt: now,
      },
    ],
    skipDuplicates: true,
  });
  return { paid: created.count > 0, decision };
}

/**
 * Pays `comment_helpful` (20 XP) to the author of a reply marked helpful by `markerId` (the
 * parent's author), within the daily and pair caps. Idempotent per item. Run inside a transaction.
 */
export async function awardHelpfulXp(
  tx: Db,
  kind: SocialItemKind,
  itemId: string,
  receiverId: string | null,
  markerId: string,
  now: Date = new Date(),
): Promise<RewardResult> {
  if (!receiverId || receiverId === markerId) {
    return { paid: false, decision: helpfulReward({ receiverId, actorId: markerId, receiverToday: 0, pairToday: 0 }) };
  }
  await lockPair(tx, receiverId, markerId);
  const { receiverToday } = await todayCounts(tx, "comment_helpful", receiverId, markerId, now);
  // Other helpful marks between the pair today (either way, paid or not: a slot used stays used):
  // replies of one whose parent belongs to the other.
  const since = new Date(now.getTime() - TWO_DAYS_MS);
  const today = toLocalDay(now);
  const pairToday = [
    ...(await tx.comment.findMany({
      where: {
        helpfulAt: { gte: since },
        OR: [
          { authorId: receiverId, parent: { is: { authorId: markerId } } },
          { authorId: markerId, parent: { is: { authorId: receiverId } } },
        ],
      },
      select: { id: true, helpfulAt: true },
    })),
    ...(await tx.forumPost.findMany({
      where: {
        helpfulAt: { gte: since },
        OR: [
          { authorId: receiverId, parent: { is: { authorId: markerId } } },
          { authorId: markerId, parent: { is: { authorId: receiverId } } },
        ],
      },
      select: { id: true, helpfulAt: true },
    })),
  ].filter((m) => m.id !== itemId && m.helpfulAt && toLocalDay(m.helpfulAt) === today).length;
  const decision = helpfulReward({ receiverId, actorId: markerId, receiverToday, pairToday });
  if (!decision.pay) return { paid: false, decision };
  const created = await tx.xpLedgerEntry.createMany({
    data: [
      {
        userId: receiverId,
        source: "comment_helpful",
        sourceKey: helpfulSourceKey(kind, itemId),
        xp: COMMENT_HELPFUL_XP,
        skills: [],
        createdAt: now,
      },
    ],
    skipDuplicates: true,
  });
  return { paid: created.count > 0, decision };
}

/**
 * Voids the `comment_liked` and `comment_helpful` entries an item earned its author (moderation
 * "Remover", or the author deleting it). Entries are kept, voided, so they never pay again.
 * Returns how many were voided.
 */
export async function voidItemSocialXp(
  tx: Db,
  kind: SocialItemKind,
  itemId: string,
  authorId: string | null,
  now: Date = new Date(),
): Promise<number> {
  if (!authorId) return 0;
  const { count } = await tx.xpLedgerEntry.updateMany({
    where: {
      userId: authorId,
      voidedAt: null,
      OR: [
        { source: "comment_liked", sourceKey: { startsWith: `${kind}:${itemId}:` } },
        { source: "comment_helpful", sourceKey: helpfulSourceKey(kind, itemId) },
      ],
    },
    data: { voidedAt: now },
  });
  return count;
}
