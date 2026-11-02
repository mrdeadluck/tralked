import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { levelFromXp } from "@/lib/engine/xp";
import { notifyLevelUp } from "@/lib/notifications/progress";
import type { LevelChange } from "@/lib/progression/reward";
import { findCommentTarget, type CommentTargetType } from "./comments";
import { withinRateLimit, type Db } from "./limits";
import { notify, preview } from "./notify";
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
 * Returns the XP credited (0 or `xp`) and the user's level change, if it went up.
 */
async function awardReactionXp(tx: Db, input: AwardInput): Promise<Award> {
  const { userId, source, sourceKey, xp, dailyCap, now } = input;
  const existing = await tx.xpLedgerEntry.findUnique({
    where: { userId_source_sourceKey: { userId, source, sourceKey } },
    select: { id: true },
  });
  if (existing) return NO_AWARD;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${source}:${userId}`}))`;
  const recent = await tx.xpLedgerEntry.findMany({
    where: { userId, source, createdAt: { gte: new Date(now.getTime() - TWO_DAYS_MS) } },
    select: { createdAt: true },
  });
  const today = toLocalDay(now);
  if (recent.filter((e) => toLocalDay(e.createdAt) === today).length >= dailyCap) return NO_AWARD;

  const created = await tx.xpLedgerEntry.createMany({
    data: [{ userId, source, sourceKey, xp, skills: [], createdAt: now }],
    skipDuplicates: true,
  });
  if (created.count === 0) return NO_AWARD;
  return { xp, levelUp: await bumpStats(tx, userId, xp, now) };
}

type Award = { xp: number; levelUp: LevelChange | null };
const NO_AWARD: Award = { xp: 0, levelUp: null };

/**
 * Adds ledger XP to the user's stats without the full recompute: reaction entries carry no
 * skills, so only total XP and level change. Users without a stats row yet (never synced) get
 * theirs from the ledger at their first recompute. A level rise is returned (the giver sees the
 * level-up overlay) and written to the bell as `level_up`.
 */
async function bumpStats(tx: Db, userId: string, xp: number, now: Date): Promise<LevelChange | null> {
  const [row] = await tx.userStats.updateManyAndReturn({
    where: { userId },
    data: { totalXp: { increment: xp } },
    select: { totalXp: true, level: true },
  });
  if (!row) return null;
  const level = levelFromXp(row.totalXp).level;
  if (level === row.level) return null;
  await tx.userStats.update({ where: { userId }, data: { level } });
  if (level < row.level) return null;
  await notifyLevelUp(tx, userId, row.level, level, now);
  return { from: row.level, to: level };
}

export type ReactResult =
  | {
      status: "ok";
      mine: MyReaction;
      counts: ReactionCounts;
      xp: { given: number; received: number };
      /** The reactor's level change, when the XP they got for reacting took them up a level. */
      levelUp: LevelChange | null;
    }
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
  let levelUp: LevelChange | null = null;
  if (plan.giver) {
    ({ xp: xp.given, levelUp } = await awardReactionXp(db, {
      userId,
      source: "reaction_given",
      sourceKey: `${targetType}:${targetId}`,
      xp: REACTION_GIVEN_XP,
      dailyCap: REACTION_GIVEN_DAILY_CAP,
      now,
    }));
  }
  if (plan.receiverId) {
    ({ xp: xp.received } = await awardReactionXp(db, {
      userId: plan.receiverId,
      source: "reaction_received",
      sourceKey: `${targetType}:${targetId}:${userId}`,
      xp: REACTION_RECEIVED_XP,
      dailyCap: REACTION_RECEIVED_DAILY_CAP,
      now,
    }));
  }

  if (targetType === "photo" && after === 1 && before !== 1 && plan.receiverId) {
    await notifyPhotoLike(db, userId, plan.receiverId, targetId);
  } else if (targetType !== "photo" && after === 1 && plan.receiverId && xp.received > 0) {
    // Only a first like by this person that paid the author (so at most the daily cap of
    // received likes per author): undo/redo or a like over the cap writes nothing.
    await notifyLike(db, { likerId: userId, ownerId: plan.receiverId, targetType, targetId, now });
  }
  return { status: "ok", mine: after, counts, xp, levelUp };
}

const LIKED_NOUN: Record<Exclude<ReactionTargetType, "photo">, string> = {
  comment: "seu comentário",
  article: "sua notícia",
  guide: "seu guia",
};

/** Where a liked item lives, with a short preview for the notification body. */
async function likedItem(
  db: Db,
  targetType: Exclude<ReactionTargetType, "photo">,
  targetId: string,
): Promise<{ href: string; preview: string } | null> {
  switch (targetType) {
    case "comment": {
      const comment = await db.comment.findUnique({
        where: { id: targetId },
        select: { targetType: true, targetId: true, body: true },
      });
      if (!comment) return null;
      const target = await findCommentTarget(db, comment.targetType as CommentTargetType, comment.targetId);
      return target ? { href: `${target.href}#comentario-${targetId}`, preview: preview(comment.body) } : null;
    }
    case "article": {
      const article = await db.article.findUnique({ where: { id: targetId }, select: { slug: true, title: true } });
      return article ? { href: `/noticias/${article.slug}`, preview: preview(article.title) } : null;
    }
    case "guide": {
      const guide = await db.guide.findUnique({
        where: { id: targetId },
        select: { game: { select: { slug: true, name: true } } },
      });
      return guide ? { href: `/jogos/${guide.game.slug}/guia`, preview: `Guia de ${guide.game.name}` } : null;
    }
  }
}

/**
 * Aggregated like notification (kind `like`): the first new liker writes "@fulano curtiu seu
 * comentário"; while that notification is unread, later likers only rewrite its title to
 * "3 pessoas curtiram seu comentário" (counted from the likes since it was created). One row per
 * unread item, so a popular comment costs one update per like, never a pile of rows.
 */
export async function notifyLike(
  db: Db,
  input: {
    likerId: string;
    ownerId: string;
    targetType: Exclude<ReactionTargetType, "photo">;
    targetId: string;
    now: Date;
  },
): Promise<void> {
  const { likerId, ownerId, targetType, targetId, now } = input;
  if (likerId === ownerId) return;
  const item = await likedItem(db, targetType, targetId);
  if (!item) return;
  const noun = LIKED_NOUN[targetType];

  const open = await db.notification.findFirst({
    where: { userId: ownerId, kind: "like", href: item.href, readAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (open) {
    const likers = await db.reaction.count({
      where: { targetType, targetId, value: 1, createdAt: { gte: open.createdAt }, NOT: { userId: ownerId } },
    });
    if (likers > 1) {
      await db.notification.update({
        where: { id: open.id },
        data: { title: `${likers} pessoas curtiram ${noun}` },
      });
      return;
    }
  }
  const liker = await db.user.findUnique({ where: { id: likerId }, select: { handle: true } });
  await db.notification.create({
    data: {
      userId: ownerId,
      kind: "like",
      title: `@${liker?.handle ?? "alguém"} curtiu ${noun}`,
      body: item.preview,
      href: item.href,
      createdAt: now,
    },
  });
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

/**
 * Items whose first reaction would still pay the viewer REACTION_GIVEN_XP: never paid for them
 * (the XP is once per item, ever) and today's cap not reached. Powers the "+5 XP" promise on the
 * buttons, so it only shows when it is true. Two indexed reads.
 */
export async function reactionXpOpen(
  db: Db,
  userId: string,
  targetType: ReactionTargetType,
  targetIds: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (targetIds.length === 0) return [];
  const [paid, recent] = await Promise.all([
    db.xpLedgerEntry.findMany({
      where: { userId, source: "reaction_given", sourceKey: { in: targetIds.map((id) => `${targetType}:${id}`) } },
      select: { sourceKey: true },
    }),
    db.xpLedgerEntry.findMany({
      where: { userId, source: "reaction_given", createdAt: { gte: new Date(now.getTime() - TWO_DAYS_MS) } },
      select: { createdAt: true },
    }),
  ]);
  const today = toLocalDay(now);
  if (recent.filter((e) => toLocalDay(e.createdAt) === today).length >= REACTION_GIVEN_DAILY_CAP) return [];
  const done = new Set(paid.map((e) => e.sourceKey.slice(targetType.length + 1)));
  return targetIds.filter((id) => !done.has(id));
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
