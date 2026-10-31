import { z } from "zod";
import type { Db } from "./limits";
import { withinRateLimit } from "./limits";
import { notify, preview } from "./notify";
import { commentBodySchema } from "./text";

export const COMMENT_TARGETS = ["article", "guide", "photo", "thread"] as const;
export type CommentTargetType = (typeof COMMENT_TARGETS)[number];

/** Comments loaded per page (newest first). */
export const COMMENTS_PAGE_SIZE = 20;

export type AuthorView = { id: string; handle: string; displayName: string; avatarUrl: string | null } | null;

export type CommentView = {
  id: string;
  /** Empty when `deleted`. */
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  /** Null when the account was removed, and always null for `deleted` comments. */
  author: AuthorView;
  /** Deleted by its author: the row stays (rate limits keep counting it) and shows "Comentário apagado". */
  deleted: boolean;
};

/** Status of a comment its author deleted (the others are visible | hidden | removed). */
export const DELETED_STATUS = "deleted";

const commentSelect = {
  id: true,
  body: true,
  status: true,
  createdAt: true,
  editedAt: true,
  author: { select: { id: true, handle: true, displayName: true, avatarUrl: true } },
} as const;

function toView(row: {
  id: string;
  body: string;
  status: string;
  createdAt: Date;
  editedAt: Date | null;
  author: AuthorView;
}): CommentView {
  const deleted = row.status === DELETED_STATUS;
  return {
    id: row.id,
    body: deleted ? "" : row.body,
    createdAt: row.createdAt,
    editedAt: deleted ? null : row.editedAt,
    author: deleted ? null : row.author,
    deleted,
  };
}

export type CommentPage = { comments: CommentView[]; nextCursor: string | null; total: number };

export const commentTargetSchema = z.object({
  targetType: z.enum(COMMENT_TARGETS),
  targetId: z.string().min(1).max(64),
});

export const newCommentSchema = commentTargetSchema.extend({ body: commentBodySchema });
export const editCommentSchema = z.object({ id: z.string().min(1).max(64), body: commentBodySchema });

export const authorSelect = {
  select: { id: true, handle: true, displayName: true, avatarUrl: true },
} as const;

type TargetInfo = { ownerId: string | null; href: string; label: string };

/** Resolves a public, commentable target; null when it does not exist or is not public. */
export async function findCommentTarget(
  db: Db,
  targetType: CommentTargetType,
  targetId: string,
): Promise<TargetInfo | null> {
  switch (targetType) {
    case "article": {
      const article = await db.article.findFirst({
        where: { id: targetId, status: "published" },
        select: { slug: true, title: true },
      });
      return article ? { ownerId: null, href: `/noticias/${article.slug}`, label: article.title } : null;
    }
    case "guide": {
      const guide = await db.guide.findFirst({
        where: { id: targetId, status: "published" },
        select: { game: { select: { slug: true, name: true } } },
      });
      return guide
        ? { ownerId: null, href: `/jogos/${guide.game.slug}/guia`, label: `Guia de ${guide.game.name}` }
        : null;
    }
    case "photo": {
      const photo = await db.photo.findFirst({
        where: { id: targetId, status: "visible" },
        select: { authorId: true },
      });
      return photo ? { ownerId: photo.authorId, href: `/galeria/${targetId}`, label: "sua foto" } : null;
    }
    case "thread": {
      const thread = await db.forumThread.findFirst({
        where: { id: targetId, status: "open" },
        select: { authorId: true, title: true },
      });
      return thread ? { ownerId: thread.authorId, href: `/forum/t/${targetId}`, label: thread.title } : null;
    }
  }
}

/**
 * One page of comments, newest first: visible ones plus "Comentário apagado" placeholders for
 * those their authors deleted. `total` counts only visible comments.
 * `cursor` is the id of the last comment already shown.
 */
export async function listComments(
  db: Db,
  targetType: CommentTargetType,
  targetId: string,
  cursor?: string | null,
  take: number = COMMENTS_PAGE_SIZE,
): Promise<CommentPage> {
  const [rows, total] = await Promise.all([
    db.comment.findMany({
      where: { targetType, targetId, status: { in: ["visible", DELETED_STATUS] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: commentSelect,
    }),
    db.comment.count({ where: { targetType, targetId, status: "visible" } }),
  ]);
  const page = rows.slice(0, take);
  return {
    comments: page.map(toView),
    nextCursor: rows.length > take ? page[page.length - 1].id : null,
    total,
  };
}

export type CreateCommentResult =
  | { status: "ok"; comment: CommentView }
  | { status: "not_found" }
  | { status: "rate_limited" };

/** Posts a comment (visible right away; moderators can hide it later). Input must be validated. */
export async function createComment(
  db: Db,
  userId: string,
  input: z.output<typeof newCommentSchema>,
): Promise<CreateCommentResult> {
  const target = await findCommentTarget(db, input.targetType, input.targetId);
  if (!target) return { status: "not_found" };
  if (!(await withinRateLimit(db, "comment", userId))) return { status: "rate_limited" };

  const comment = await db.comment.create({
    data: { authorId: userId, targetType: input.targetType, targetId: input.targetId, body: input.body },
    select: commentSelect,
  });
  if (input.targetType === "photo") {
    await notify(db, {
      userId: target.ownerId,
      actorId: userId,
      kind: "comment_reply",
      title: `@${comment.author?.handle ?? "alguém"} comentou na sua foto`,
      body: preview(input.body),
      href: target.href,
    });
  }
  return { status: "ok", comment: toView(comment) };
}

export type OwnCommentResult = { status: "ok" } | { status: "not_found" } | { status: "forbidden" };

async function ownComment(db: Db, userId: string, id: string) {
  const comment = await db.comment.findUnique({ where: { id }, select: { authorId: true, status: true } });
  if (!comment || comment.status !== "visible") return "not_found" as const;
  if (comment.authorId !== userId) return "forbidden" as const;
  return "ok" as const;
}

/** Edits the user's own visible comment. */
export async function editComment(
  db: Db,
  userId: string,
  input: z.output<typeof editCommentSchema>,
): Promise<{ status: "ok"; comment: CommentView } | { status: "not_found" } | { status: "forbidden" }> {
  const check = await ownComment(db, userId, input.id);
  if (check !== "ok") return { status: check };
  const comment = await db.comment.update({
    where: { id: input.id },
    data: { body: input.body, editedAt: new Date() },
    select: commentSelect,
  });
  return { status: "ok", comment: toView(comment) };
}

/**
 * Deletes the user's own visible comment: the text is cleared and the row is kept with status
 * `deleted` (shown as "Comentário apagado"), so deleting does not reset the comment rate limit.
 */
export async function deleteComment(db: Db, userId: string, id: string): Promise<OwnCommentResult> {
  const check = await ownComment(db, userId, id);
  if (check !== "ok") return { status: check };
  await db.comment.update({ where: { id }, data: { status: DELETED_STATUS, body: "" } });
  return { status: "ok" };
}
