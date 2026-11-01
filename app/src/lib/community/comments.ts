import { z } from "zod";
import type { Db } from "./limits";
import { withinRateLimit } from "./limits";
import { notify, preview } from "./notify";
import { commentBodySchema } from "./text";
import { notifyMentions } from "@/lib/social/mentions";
import { isBlockedEither } from "@/lib/social/relations";
import { replyParentId } from "@/lib/social/threads";
import { voidItemSocialXp } from "@/lib/social/xp";

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
  /** Comment this one answers (null for a top-level comment). */
  parentId: string | null;
  likeCount: number;
  dislikeCount: number;
  /** Marked "Útil" by the author of the comment it answers. */
  helpful: boolean;
  /** 0 for a top-level comment, 1 and 2 for replies (lib/social/threads.ts). */
  depth: number;
  /** Replies, oldest first (2 levels at most). */
  replies: CommentView[];
};

/** Status of a comment its author deleted (the others are visible | hidden | removed). */
export const DELETED_STATUS = "deleted";

const commentSelect = {
  id: true,
  body: true,
  status: true,
  createdAt: true,
  editedAt: true,
  parentId: true,
  likeCount: true,
  dislikeCount: true,
  helpfulAt: true,
  author: { select: { id: true, handle: true, displayName: true, avatarUrl: true } },
} as const;

type CommentRow = {
  id: string;
  body: string;
  status: string;
  createdAt: Date;
  editedAt: Date | null;
  parentId: string | null;
  likeCount: number;
  dislikeCount: number;
  helpfulAt: Date | null;
  author: AuthorView;
};

function toView(row: CommentRow, depth = 0, replies: CommentView[] = []): CommentView {
  const deleted = row.status === DELETED_STATUS;
  return {
    id: row.id,
    body: deleted ? "" : row.body,
    createdAt: row.createdAt,
    editedAt: deleted ? null : row.editedAt,
    author: deleted ? null : row.author,
    deleted,
    parentId: row.parentId,
    likeCount: deleted ? 0 : row.likeCount,
    dislikeCount: deleted ? 0 : row.dislikeCount,
    helpful: !deleted && row.helpfulAt !== null,
    depth,
    replies,
  };
}

/** Replies loaded per level of a page of comments (oldest first). */
const REPLIES_PER_LEVEL = 300;

export type CommentPage = { comments: CommentView[]; nextCursor: string | null; total: number };

export const commentTargetSchema = z.object({
  targetType: z.enum(COMMENT_TARGETS),
  targetId: z.string().min(1).max(64),
});

export const newCommentSchema = commentTargetSchema.extend({
  body: commentBodySchema,
  /** Answer to this comment (threaded reply). */
  parentId: z.string().min(1).max(64).optional(),
});
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
 * One page of top-level comments, newest first, each with its replies (oldest first, 2 levels):
 * visible ones plus "Comentário apagado" placeholders for those their authors deleted. Replies of
 * a hidden or removed comment go with it. `total` counts every visible comment, replies included.
 * `cursor` is the id of the last top-level comment already shown.
 */
export async function listComments(
  db: Db,
  targetType: CommentTargetType,
  targetId: string,
  cursor?: string | null,
  take: number = COMMENTS_PAGE_SIZE,
): Promise<CommentPage> {
  const shown = { in: ["visible", DELETED_STATUS] };
  const [rows, total] = await Promise.all([
    db.comment.findMany({
      where: { targetType, targetId, parentId: null, status: shown },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: commentSelect,
    }),
    db.comment.count({ where: { targetType, targetId, status: "visible" } }),
  ]);
  const page = rows.slice(0, take);
  const level = (parentIds: string[]) =>
    parentIds.length === 0
      ? Promise.resolve([] as CommentRow[])
      : db.comment.findMany({
          where: { targetType, targetId, parentId: { in: parentIds }, status: shown },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: REPLIES_PER_LEVEL,
          select: commentSelect,
        });
  const first = await level(page.map((c) => c.id));
  const second = await level(first.map((c) => c.id));
  const childrenOf = (rows: CommentRow[], parentId: string) => rows.filter((r) => r.parentId === parentId);
  return {
    comments: page.map((root) =>
      toView(
        root,
        0,
        childrenOf(first, root.id).map((reply) =>
          toView(
            reply,
            1,
            childrenOf(second, reply.id).map((r) => toView(r, 2)),
          ),
        ),
      ),
    ),
    nextCursor: rows.length > take ? page[page.length - 1].id : null,
    total,
  };
}

/**
 * Article.comments (shown on news cards and the article header) mirrors the article's visible
 * comments. It is recounted rather than incremented, so a create, a delete or a moderation step
 * can never make it drift. Returns the article slug (to invalidate its cache), or null when the
 * article no longer exists.
 */
export async function syncArticleComments(db: Db, articleId: string): Promise<string | null> {
  const count = await db.comment.count({ where: { targetType: "article", targetId: articleId, status: "visible" } });
  const rows = await db.article.updateManyAndReturn({
    where: { id: articleId },
    data: { comments: count },
    select: { slug: true },
  });
  return rows[0]?.slug ?? null;
}

/** Every article's counter from its visible comments (seed and the recount script). Returns how many changed. */
export async function recountAllArticleComments(db: Db): Promise<number> {
  const [articles, counts] = await Promise.all([
    db.article.findMany({ select: { id: true, comments: true } }),
    db.comment.groupBy({ by: ["targetId"], where: { targetType: "article", status: "visible" }, _count: { _all: true } }),
  ]);
  const visible = new Map(counts.map((c) => [c.targetId, c._count._all]));
  let changed = 0;
  for (const article of articles) {
    const count = visible.get(article.id) ?? 0;
    if (count === article.comments) continue;
    await db.article.update({ where: { id: article.id }, data: { comments: count } });
    changed++;
  }
  return changed;
}

export type CreateCommentResult =
  | { status: "ok"; comment: CommentView; articleSlug?: string }
  | { status: "not_found" }
  | { status: "blocked" }
  | { status: "rate_limited" };

/**
 * Posts a comment, or a reply when `parentId` is set (visible right away; moderators can hide it
 * later). A reply goes at most 2 levels deep (lib/social/threads.ts) and is refused when the
 * replied-to author and the user blocked each other. Notifies the photo owner (top-level comment
 * on a photo), the replied-to author and @mentioned users. Input must be validated.
 */
export async function createComment(
  db: Db,
  userId: string,
  input: z.output<typeof newCommentSchema>,
): Promise<CreateCommentResult> {
  const target = await findCommentTarget(db, input.targetType, input.targetId);
  if (!target) return { status: "not_found" };

  let parent: { id: string; authorId: string | null } | null = null;
  if (input.parentId) {
    const replied = await db.comment.findFirst({
      where: { id: input.parentId, targetType: input.targetType, targetId: input.targetId, status: "visible" },
      select: { id: true, authorId: true, parentId: true, parent: { select: { parentId: true, authorId: true } } },
    });
    if (!replied) return { status: "not_found" };
    if (replied.authorId && (await isBlockedEither(db, userId, replied.authorId))) return { status: "blocked" };
    const parentId = replyParentId(replied.id, replied.parentId, replied.parent?.parentId ?? null);
    parent = { id: parentId, authorId: parentId === replied.id ? replied.authorId : (replied.parent?.authorId ?? null) };
  }
  if (!(await withinRateLimit(db, "comment", userId))) return { status: "rate_limited" };

  const comment = await db.comment.create({
    data: {
      authorId: userId,
      targetType: input.targetType,
      targetId: input.targetId,
      body: input.body,
      parentId: parent?.id ?? null,
    },
    select: commentSelect,
  });
  const handle = comment.author?.handle ?? "alguém";
  const href = `${target.href}#comentario-${comment.id}`;
  if (parent) {
    await notify(db, {
      userId: parent.authorId,
      actorId: userId,
      kind: "comment_reply",
      title: `@${handle} respondeu seu comentário`,
      body: preview(input.body),
      href,
    });
  } else if (input.targetType === "photo") {
    await notify(db, {
      userId: target.ownerId,
      actorId: userId,
      kind: "comment_reply",
      title: `@${handle} comentou na sua foto`,
      body: preview(input.body),
      href: target.href,
    });
  }
  await notifyMentions(db, {
    authorId: userId,
    authorHandle: handle,
    text: input.body,
    href,
    skip: [parent ? parent.authorId : input.targetType === "photo" ? target.ownerId : null],
  });
  const view = toView(comment, parent ? await depthUnder(db, parent.id) : 0);
  if (input.targetType === "article") {
    const articleSlug = await syncArticleComments(db, input.targetId);
    if (articleSlug) return { status: "ok", comment: view, articleSlug };
  }
  return { status: "ok", comment: view };
}

/** Depth of a new reply under `parentId`: 1 under a top-level comment, otherwise 2. */
async function depthUnder(db: Db, parentId: string): Promise<number> {
  const parent = await db.comment.findUnique({ where: { id: parentId }, select: { parentId: true } });
  return parent?.parentId ? 2 : 1;
}

export type OwnCommentResult =
  | { status: "ok"; articleSlug?: string; photoId?: string; xpVoided?: number }
  | { status: "not_found" }
  | { status: "forbidden" };

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
 * The likes and helpful mark it earned stop counting (`xpVoided`: recompute the user when > 0).
 */
export async function deleteComment(db: Db, userId: string, id: string, now: Date = new Date()): Promise<OwnCommentResult> {
  const check = await ownComment(db, userId, id);
  if (check !== "ok") return { status: check };
  const deleted = await db.comment.update({
    where: { id },
    data: { status: DELETED_STATUS, body: "" },
    select: { targetType: true, targetId: true },
  });
  const voided = await voidItemSocialXp(db, "comment", id, userId, now);
  const xp = voided > 0 ? { xpVoided: voided } : {};
  if (deleted.targetType === "article") {
    const articleSlug = await syncArticleComments(db, deleted.targetId);
    if (articleSlug) return { status: "ok", articleSlug, ...xp };
  }
  // The photo page caches its comment count (photo:<id>).
  if (deleted.targetType === "photo") return { status: "ok", photoId: deleted.targetId, ...xp };
  return { status: "ok", ...xp };
}
