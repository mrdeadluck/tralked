import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { levelFromXp } from "@/lib/engine/xp";
import { withinRateLimit, type Db } from "./limits";
import { notify } from "./notify";
import {
  nextReaction,
  reactionXpPlan,
  type MyReaction,
  type ReactionCounts,
  type ReactionTargetType,
  type ReactionValue,
} from "./reaction-rules";
import {
  REACTION_GIVEN_DAILY_CAP,
  REACTION_GIVEN_XP,
  REACTION_RECEIVED_DAILY_CAP,
  REACTION_RECEIVED_XP,
} from "./rewards";

/**
 * Likes and dislikes (item 17). One Reaction row per user and item; the item's like/dislike
 * columns are recounted from the rows after every change, so they cannot drift.
 *
 * XP rules (all through the append-only ledger, so nothing can be farmed by undo/redo):
 * - giving a like or a dislike pays REACTION_GIVEN_XP once per item ever (`reaction_given`,
 *   sourceKey `${type}:${id}`): switching like <-> dislike or undoing and redoing pays nothing new;
 * - a like pays the item's author REACTION_RECEIVED_XP once per item and liker
 *   (`reaction_received`, sourceKey `${type}:${id}:${likerId}`); a dislike pays the author nothing;
 * - reacting to your own content pays nobody;
 * - each side has a daily cap (America/Sao_Paulo day); a reaction over the cap still counts, it
 *   just earns no XP (and a later click on the same item may still pay, once).
 * Reaction XP has no skills: only total XP and level move, so the stats row is bumped in place
 * instead of running the full recompute (Vercel CPU budget).
 */

export {
  applyReaction,
  nextReaction,
  REACTION_TARGETS,
  reactionXpPlan,
  reactSchema,
  type MyReaction,
  type ReactionCounts,
  type ReactionTargetType,
  type ReactionValue,
} from "./reaction-rules";

type TargetInfo = { ownerId: string | null };

/** The item when it is public and can be reacted to; null otherwise. */
export async function findReactionTarget(
  db: Db,
  targetType: ReactionTargetType,
  targetId: string,
): Promise<TargetInfo | null> {
  switch (targetType) {
    case "article": {
      const article = await db.article.findFirst({
        where: { id: targetId, status: "published" },
        select: { author: { select: { userId: true } } },
      });
      return article ? { ownerId: article.author.userId } : null;
    }
    case "comment": {
      const comment = await db.comment.findFirst({
        where: { id: targetId, status: "visible" },
        select: { authorId: true },
      });
      return comment ? { ownerId: comment.authorId } : null;
    }
    case "photo": {
      const photo = await db.photo.findFirst({
        where: { id: targetId, status: "visible" },
        select: { authorId: true },
      });
      return photo ? { ownerId: photo.authorId } : null;
    }
    case "guide": {
      const guide = await db.guide.findFirst({
        where: { id: targetId, status: "published" },
        select: { authorId: true },
      });
      return guide ? { ownerId: guide.authorId } : null;
    }
  }
}

/** Recounts the item's reactions and writes them to its like/dislike columns. */
export async function syncReactionCounts(
  db: Db,
  targetType: ReactionTargetType,
  targetId: string,
): Promise<ReactionCounts> {
  const groups = await db.reaction.groupBy({
    by: ["value"],
    where: { targetType, targetId },
    _count: { _all: true },
  });
  const likes = groups.find((g) => g.value === 1)?._count._all ?? 0;
  const dislikes = groups.find((g) => g.value === -1)?._count._all ?? 0;
  const where = { id: targetId };
  switch (targetType) {
    case "article":
      await db.article.updateMany({ where, data: { likes, dislikes } });
      break;
    case "comment":
      await db.comment.updateMany({ where, data: { likes, dislikes } });
      break;
    case "photo":
      await db.photo.updateMany({ where, data: { likeCount: likes, dislikeCount: dislikes } });
      break;
    case "guide":
      await db.guide.updateMany({ where, data: { likes, dislikes } });
      break;
  }
  return { likes, dislikes };
}

const TWO_DAYS_MS = 2 * 86_400_000;

type AwardInput = {
  userId: string;
  source: "reaction_given" | "reaction_received";
  sourceKey: string;
  xp: number;
  dailyCap: number;
  now: Date;
};

/**
 * Writes one reaction ledger entry unless the user already has it (any day, even voided) or
 * already earned `dailyCap` entries of this source today. Serialized per user and source with a
 * transaction-scoped advisory lock, so concurrent clicks cannot both take the last slot (giver
 * and receiver use different keys, so two people liking each other cannot deadlock).
 * Returns the XP credited (0 or `xp`).
 */
async function awardReactionXp(tx: Db, input: AwardInput): Promise<number> {
  const { userId, source, sourceKey, xp, dailyCap, now } = input;
  const existing = await tx.xpLedgerEntry.findUnique({
    where: { userId_source_sourceKey: { userId, source, sourceKey } },
    select: { id: true },
  });
  if (existing) return 0;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${source}:${userId}`}))`;
  const recent = await tx.xpLedgerEntry.findMany({
    where: { userId, source, createdAt: { gte: new Date(now.getTime() - TWO_DAYS_MS) } },
    select: { createdAt: true },
  });
  const today = toLocalDay(now);
  if (recent.filter((e) => toLocalDay(e.createdAt) === today).length >= dailyCap) return 0;

  const created = await tx.xpLedgerEntry.createMany({
    data: [{ userId, source, sourceKey, xp, skills: [], createdAt: now }],
    skipDuplicates: true,
  });
  if (created.count === 0) return 0;
  await bumpStats(tx, userId, xp);
  return xp;
}

/**
 * Adds ledger XP to the user's stats without the full recompute: reaction entries carry no
 * skills, so only total XP and level change. Users without a stats row yet (never synced) get
 * theirs from the ledger at their first recompute.
 */
async function bumpStats(tx: Db, userId: string, xp: number): Promise<void> {
  const [row] = await tx.userStats.updateManyAndReturn({
    where: { userId },
    data: { totalXp: { increment: xp } },
    select: { totalXp: true, level: true },
  });
  if (!row) return;
  const level = levelFromXp(row.totalXp).level;
  if (level !== row.level) await tx.userStats.update({ where: { userId }, data: { level } });
}

export type ReactResult =
  | { status: "ok"; mine: MyReaction; counts: ReactionCounts; xp: { given: number; received: number } }
  | { status: "not_found" }
  | { status: "rate_limited" };

/**
 * `userId` clicks like (1) or dislike (-1) on an item. Run inside a transaction. Same button
 * again removes the reaction; the other button switches it. New reactions are rate limited
 * (RATE_LIMITS.like). A photo's author is notified of the first like by each person, once ever.
 */
export async function react(
  db: Db,
  userId: string,
  targetType: ReactionTargetType,
  targetId: string,
  clicked: ReactionValue,
  now: Date = new Date(),
): Promise<ReactResult> {
  const target = await findReactionTarget(db, targetType, targetId);
  if (!target) return { status: "not_found" };

  const key = { userId_targetType_targetId: { userId, targetType, targetId } };
  const current = await db.reaction.findUnique({ where: key, select: { value: true } });
  const before: MyReaction = current ? (current.value === 1 ? 1 : -1) : 0;
  const after = nextReaction(before, clicked);

  if (after === 0) {
    await db.reaction.deleteMany({ where: { userId, targetType, targetId } });
  } else if (before !== 0) {
    await db.reaction.updateMany({ where: { userId, targetType, targetId }, data: { value: after } });
  } else {
    if (!(await withinRateLimit(db, "like", userId, now))) return { status: "rate_limited" };
    // skipDuplicates keeps a concurrent double click from failing; the recount below stays exact.
    await db.reaction.createMany({
      data: [{ userId, targetType, targetId, value: after, targetOwnerId: target.ownerId, createdAt: now }],
      skipDuplicates: true,
    });
  }
  const counts = await syncReactionCounts(db, targetType, targetId);

  const plan = reactionXpPlan({ reactorId: userId, ownerId: target.ownerId, value: after });
  const xp = { given: 0, received: 0 };
  if (plan.giver) {
    xp.given = await awardReactionXp(db, {
      userId,
      source: "reaction_given",
      sourceKey: `${targetType}:${targetId}`,
      xp: REACTION_GIVEN_XP,
      dailyCap: REACTION_GIVEN_DAILY_CAP,
      now,
    });
  }
  if (plan.receiverId) {
    xp.received = await awardReactionXp(db, {
      userId: plan.receiverId,
      source: "reaction_received",
      sourceKey: `${targetType}:${targetId}:${userId}`,
      xp: REACTION_RECEIVED_XP,
      dailyCap: REACTION_RECEIVED_DAILY_CAP,
      now,
    });
  }

  if (targetType === "photo" && after === 1 && before !== 1 && plan.receiverId) {
    await notifyPhotoLike(db, userId, plan.receiverId, targetId);
  }
  return { status: "ok", mine: after, counts, xp };
}

/** "@fulano curtiu sua foto", once per liker and photo ever (unlike + like again stays quiet). */
async function notifyPhotoLike(db: Db, likerId: string, authorId: string, photoId: string): Promise<void> {
  const liker = await db.user.findUnique({ where: { id: likerId }, select: { handle: true } });
  const title = `@${liker?.handle ?? "alguém"} curtiu sua foto`;
  const href = `/galeria/${photoId}`;
  const already = await db.notification.findFirst({
    where: { userId: authorId, kind: "photo_like", href, title },
    select: { id: true },
  });
  if (!already) await notify(db, { userId: authorId, actorId: likerId, kind: "photo_like", title, href });
}

/** The viewer's reactions to some items of one type, by item id (only items they reacted to). */
export async function myReactions(
  db: Db,
  userId: string,
  targetType: ReactionTargetType,
  targetIds: string[],
): Promise<Record<string, ReactionValue>> {
  if (targetIds.length === 0) return {};
  const rows = await db.reaction.findMany({
    where: { userId, targetType, targetId: { in: targetIds } },
    select: { targetId: true, value: true },
  });
  return Object.fromEntries(rows.map((r) => [r.targetId, r.value === 1 ? 1 : -1]));
}

/** Live counts of one item from its mirror columns (zeros when it is gone). */
export async function reactionCounts(
  db: Db,
  targetType: Exclude<ReactionTargetType, "comment" | "photo">,
  targetId: string,
): Promise<ReactionCounts> {
  const select = { likes: true, dislikes: true } as const;
  const row =
    targetType === "article"
      ? await db.article.findUnique({ where: { id: targetId }, select })
      : await db.guide.findUnique({ where: { id: targetId }, select });
  return row ?? { likes: 0, dislikes: 0 };
}

export type ReactionStats = { likesGiven: number; dislikesGiven: number; likesReceived: number };

/** Profile counters: likes and dislikes the user gave, likes their content received. */
export async function reactionStats(userId: string, db: Db = prisma): Promise<ReactionStats> {
  const [likesGiven, dislikesGiven, likesReceived] = await Promise.all([
    db.reaction.count({ where: { userId, value: 1 } }),
    db.reaction.count({ where: { userId, value: -1 } }),
    db.reaction.count({ where: { targetOwnerId: userId, value: 1, NOT: { userId } } }),
  ]);
  return { likesGiven, dislikesGiven, likesReceived };
}
