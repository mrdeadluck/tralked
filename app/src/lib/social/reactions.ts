import { z } from "zod";
import type { Db } from "@/lib/community/limits";
import { notify, preview } from "@/lib/community/notify";
import { COMMENT_HELPFUL_XP } from "@/lib/engine/social";
import { itemRefSchema, loadItem, type ItemRef } from "./items";
import { isBlockedEither } from "./relations";
import { awardHelpfulXp, awardLikeXp } from "./xp";

export const reactSchema = itemRefSchema.extend({ value: z.union([z.literal(1), z.literal(-1)]) });
export type ReactInput = z.output<typeof reactSchema>;

export type ReactResult =
  | {
      status: "ok";
      /** The viewer's reaction now: 1, -1 or 0 (none). */
      mine: 1 | -1 | 0;
      likeCount: number;
      dislikeCount: number;
      /** A like paid `comment_liked` XP to the author (recompute them). */
      paidTo: string | null;
      threadId: string | null;
    }
  | { status: "not_found" }
  | { status: "own" }
  | { status: "blocked" };

function counterUpdate(kind: ItemRef["kind"], id: string, likes: number, dislikes: number) {
  return { kind, id, data: { likeCount: { increment: likes }, dislikeCount: { increment: dislikes } } };
}

/**
 * Curtir/descurtir: clicking the same reaction again removes it, the other one switches. Counters
 * follow in the same transaction. A new like pays the author `comment_liked` within the caps of
 * lib/engine/social.ts (the liker earns nothing; a like is paid once per liker and item, even after
 * unliking). Dislikes never remove XP. Run inside a transaction.
 */
export async function react(tx: Db, userId: string, input: ReactInput, now: Date = new Date()): Promise<ReactResult> {
  const item = await loadItem(tx, input);
  if (!item) return { status: "not_found" };
  if (item.authorId === userId) return { status: "own" };
  if (item.authorId && (await isBlockedEither(tx, userId, item.authorId))) return { status: "blocked" };

  const key = { userId_targetType_targetId: { userId, targetType: input.kind, targetId: input.id } };
  const existing = await tx.reaction.findUnique({ where: key, select: { value: true } });
  let mine: 1 | -1 | 0;
  let likes = 0;
  let dislikes = 0;
  if (existing?.value === input.value) {
    await tx.reaction.delete({ where: key });
    mine = 0;
    if (input.value === 1) likes = -1;
    else dislikes = -1;
  } else if (existing) {
    await tx.reaction.update({ where: key, data: { value: input.value, createdAt: now } });
    mine = input.value;
    likes = input.value === 1 ? 1 : -1;
    dislikes = -likes;
  } else {
    await tx.reaction.create({ data: { userId, targetType: input.kind, targetId: input.id, value: input.value, createdAt: now } });
    mine = input.value;
    if (input.value === 1) likes = 1;
    else dislikes = 1;
  }

  const update = counterUpdate(input.kind, input.id, likes, dislikes);
  const counts =
    update.kind === "comment"
      ? await tx.comment.update({ where: { id: update.id }, data: update.data, select: { likeCount: true, dislikeCount: true } })
      : await tx.forumPost.update({ where: { id: update.id }, data: update.data, select: { likeCount: true, dislikeCount: true } });

  let paidTo: string | null = null;
  if (mine === 1) {
    const reward = await awardLikeXp(tx, input.kind, input.id, item.authorId, userId, now);
    if (reward.paid) paidTo = item.authorId;
    const liker = await tx.user.findUnique({ where: { id: userId }, select: { handle: true } });
    await notify(tx, {
      userId: item.authorId,
      actorId: userId,
      kind: "comment_like",
      title: `@${liker?.handle ?? "alguém"} curtiu ${input.kind === "post" ? "sua mensagem" : "seu comentário"}`,
      body: preview(item.label),
      href: item.href,
      dedupe: true,
    });
  }
  return {
    status: "ok",
    mine,
    likeCount: Math.max(0, counts.likeCount),
    dislikeCount: Math.max(0, counts.dislikeCount),
    paidTo,
    threadId: item.threadId,
  };
}

export type HelpfulResult =
  | { status: "ok"; paidTo: string | null; threadId: string | null }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "own" }
  | { status: "already" };

/**
 * "Útil": the author of a comment or post marks a direct reply to it as helpful. Once per reply,
 * never on one's own reply. Pays `comment_helpful` within its caps. Run inside a transaction.
 */
export async function markHelpful(tx: Db, userId: string, input: ItemRef, now: Date = new Date()): Promise<HelpfulResult> {
  const item = await loadItem(tx, input);
  if (!item || !item.parentId) return { status: "not_found" };
  if (item.parentAuthorId !== userId) return { status: "forbidden" };
  if (item.authorId === userId) return { status: "own" };
  const claimed =
    input.kind === "comment"
      ? await tx.comment.updateMany({ where: { id: input.id, helpfulAt: null }, data: { helpfulAt: now } })
      : await tx.forumPost.updateMany({ where: { id: input.id, helpfulAt: null }, data: { helpfulAt: now } });
  if (claimed.count === 0) return { status: "already" };
  const reward = await awardHelpfulXp(tx, input.kind, input.id, item.authorId, userId, now);
  const marker = await tx.user.findUnique({ where: { id: userId }, select: { handle: true } });
  await notify(tx, {
    userId: item.authorId,
    actorId: userId,
    kind: "comment_helpful",
    title: `@${marker?.handle ?? "alguém"} marcou sua resposta como útil`,
    body: reward.paid ? `+${COMMENT_HELPFUL_XP} XP · ${preview(item.label)}` : preview(item.label),
    href: item.href,
  });
  return { status: "ok", paidTo: reward.paid ? item.authorId : null, threadId: item.threadId };
}

/** The viewer's reactions on a set of items, by id. */
export async function viewerReactions(
  db: Db,
  userId: string | null,
  kind: ItemRef["kind"],
  ids: string[],
): Promise<Record<string, 1 | -1>> {
  if (!userId || ids.length === 0) return {};
  const rows = await db.reaction.findMany({
    where: { userId, targetType: kind, targetId: { in: ids } },
    select: { targetId: true, value: true },
  });
  return Object.fromEntries(rows.map((r) => [r.targetId, r.value === 1 ? 1 : -1]));
}
