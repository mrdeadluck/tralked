import { z } from "zod";
import type { Db } from "./limits";
import { isDiscussionLocked } from "@/lib/moderation/locks";
import { withinRateLimit } from "./limits";
import { notify, preview } from "./notify";
import { myReactions } from "./reactions";
import { commentBodySchema } from "./text";

export const COMMENT_TARGETS = ["article", "guide", "photo", "thread"] as const;
export type CommentTargetType = (typeof COMMENT_TARGETS)[number];

/** Comments loaded per page (newest first). */
export const COMMENTS_PAGE_SIZE = 20;

export type AuthorView = { id: string; handle: string; displayName: string; avatarUrl: string | null } | null;

export type CommentView = {
  id: string;
  /** Empty when `deleted` or `removed`. */
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  /** Null when the account was removed, and always null for `deleted` comments. */
  author: AuthorView;
  /** Deleted by its author: the row stays (rate limits keep counting it) and shows "Comentário apagado". */
  deleted: boolean;
  /** Removed by the moderation: the row stays and shows "Comentário removido pela moderação". */
  removed: boolean;
  /** Pinned by the moderation: listed first, marked "Fixado". */
  pinned: boolean;
  /** Root comment of a reply; null for top-level comments. */
  parentId: string | null;
  /** Who a reply to a reply answers (the @mention); null otherwise, and for deleted/removed ones. */
  replyTo: { handle: string } | null;
  likes: number;
  dislikes: number;
};

/** A top-level comment with the start of its replies (oldest first). */
export type CommentThreadView = CommentView & {
  /** The first REPLIES_PREVIEW replies; the rest load on demand (`listReplies`). */
  replies: CommentView[];
  /** Listed replies in all (visible ones and the "apagado" / "removido" placeholders). */
  replyCount: number;
};

/** Replies loaded with each top-level comment; more than this collapse behind "Ver mais". */
export const REPLIES_PREVIEW = 3;
/** At most this many replies of one comment are ever listed. */
export const REPLIES_MAX = 200;

/** Status of a comment its author deleted (the others are visible | hidden | removed). */
export const DELETED_STATUS = "deleted";
/** Status of a comment the moderation removed (final). */
export const REMOVED_STATUS = "removed";

const commentSelect = {
  id: true,
  body: true,
  status: true,
  pinned: true,
  createdAt: true,
  editedAt: true,
  parentId: true,
  likes: true,
  dislikes: true,
  author: { select: { id: true, handle: true, displayName: true, avatarUrl: true } },
  replyToUser: { select: { handle: true } },
} as const;

/**
 * Comments listed publicly: visible ones, plus placeholders for those their authors deleted or
 * the moderation removed (so the replies under them keep their context). Hidden ones are left out.
 */
const LISTED_STATUSES = ["visible", DELETED_STATUS, REMOVED_STATUS];
const LISTED_STATUS = { in: LISTED_STATUSES };

function toView(row: {
  id: string;
  body: string;
  status: string;
  pinned: boolean;
  createdAt: Date;
  editedAt: Date | null;
  parentId: string | null;
  likes: number;
  dislikes: number;
  author: AuthorView;
  replyToUser: { handle: string } | null;
}): CommentView {
  const deleted = row.status === DELETED_STATUS;
  const removed = row.status === REMOVED_STATUS;
  // A removed comment keeps its text in the database (moderation history), never on the page.
  const gone = deleted || removed;
  return {
    id: row.id,
    body: gone ? "" : row.body,
    createdAt: row.createdAt,
    editedAt: gone ? null : row.editedAt,
    author: gone ? null : row.author,
    deleted,
    removed,
    pinned: !gone && row.pinned,
    parentId: row.parentId,
    replyTo: gone ? null : row.replyToUser,
    likes: row.likes,
    dislikes: row.dislikes,
  };
}

export type CommentPage = {
  comments: CommentThreadView[];
  nextCursor: string | null;
  total: number;
  /** The viewer's likes (1) and dislikes (-1) on the listed comments and replies, by id. */
  mine?: Record<string, 1 | -1>;
};

export const commentTargetSchema = z.object({
  targetType: z.enum(COMMENT_TARGETS),
  targetId: z.string().min(1).max(64),
});

export const newCommentSchema = commentTargetSchema.extend({
  body: commentBodySchema,
  /** The comment being answered (top-level or a reply); omitted for a new top-level comment. */
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
 * One page of top-level comments, newest first, each with its first replies (oldest first):
 * visible ones plus placeholders for those their authors deleted ("Comentário apagado") or the
 * moderation removed ("Comentário removido pela moderação"). The pinned top-level comment comes
 * first on the first page (a pinned reply stays in its thread). `total` counts every visible
 * comment, replies included (as Article.comments does). `cursor` is the id of the last
 * top-level comment already shown.
 */
export async function listComments(
  db: Db,
  targetType: CommentTargetType,
  targetId: string,
  cursor?: string | null,
  take: number = COMMENTS_PAGE_SIZE,
): Promise<CommentPage> {
  const threadSelect = {
    ...commentSelect,
    replies: {
      where: { status: LISTED_STATUS },
      orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
      take: REPLIES_PREVIEW,
      select: commentSelect,
    },
    _count: { select: { replies: { where: { status: LISTED_STATUS } } } },
  };
  const [pinned, rows, total] = await Promise.all([
    cursor
      ? Promise.resolve([])
      : db.comment.findMany({
          where: { targetType, targetId, parentId: null, status: "visible", pinned: true },
          take: 1,
          select: threadSelect,
        }),
    db.comment.findMany({
      // Only a visible comment stays pinned (hiding, removing or deleting it unpins it).
      where: { targetType, targetId, parentId: null, status: LISTED_STATUS, pinned: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: threadSelect,
    }),
    db.comment.count({ where: { targetType, targetId, status: "visible" } }),
  ]);
  const page = rows.slice(0, take);
  return {
    comments: [...pinned, ...page].map((row) => ({
      ...toView(row),
      replies: row.replies.map(toView),
      replyCount: row._count.replies,
    })),
    nextCursor: rows.length > take ? page[page.length - 1].id : null,
    total,
  };
}

/** Every listed reply of a top-level comment, oldest first (capped at REPLIES_MAX). */
export async function listReplies(db: Db, rootId: string): Promise<CommentView[]> {
  const rows = await db.comment.findMany({
    where: { parentId: rootId, status: LISTED_STATUS },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: REPLIES_MAX,
    select: commentSelect,
  });
  return rows.map(toView);
}

/** The page plus the viewer's reactions to its comments and the replies it shows. */
export async function withMyReactions(db: Db, page: CommentPage, userId: string): Promise<CommentPage> {
  const ids = page.comments.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]);
  return { ...page, mine: await myReactions(db, userId, "comment", ids) };
}

type ReplyPlace = { parentId: string; replyToUserId: string | null; notifyUserId: string | null };

/**
 * Where a reply to `answeredId` goes: under the same root (replies are one level deep). A reply
 * to a reply @mentions that reply's author; the person answered is notified either way. Null
 * when the answered comment is not a visible comment of this target.
 */
async function replyPlace(
  db: Db,
  targetType: CommentTargetType,
  targetId: string,
  answeredId: string,
): Promise<ReplyPlace | null> {
  const answered = await db.comment.findFirst({
    where: { id: answeredId, targetType, targetId, status: "visible" },
    select: { id: true, parentId: true, authorId: true, parent: { select: { status: true } } },
  });
  if (!answered) return null;
  if (!answered.parentId) return { parentId: answered.id, replyToUserId: null, notifyUserId: answered.authorId };
  // The root of a reply may be a placeholder (deleted or removed), but not hidden.
  if (!answered.parent || !LISTED_STATUSES.includes(answered.parent.status)) return null;
  return { parentId: answered.parentId, replyToUserId: answered.authorId, notifyUserId: answered.authorId };
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
  | { status: "locked" }
  | { status: "rate_limited" };

/** Posts a comment (visible right away; moderators can hide it later). Input must be validated. */
export async function createComment(
  db: Db,
  userId: string,
  input: z.output<typeof newCommentSchema>,
): Promise<CreateCommentResult> {
  const target = await findCommentTarget(db, input.targetType, input.targetId);
  if (!target) return { status: "not_found" };
  // A locked discussion takes no replies either.
  if (await isDiscussionLocked(db, input.targetType, input.targetId)) return { status: "locked" };
  const place = input.parentId ? await replyPlace(db, input.targetType, input.targetId, input.parentId) : null;
  if (input.parentId && !place) return { status: "not_found" };
  if (!(await withinRateLimit(db, "comment", userId))) return { status: "rate_limited" };

  const comment = await db.comment.create({
    data: {
      authorId: userId,
      targetType: input.targetType,
      targetId: input.targetId,
      body: input.body,
      parentId: place?.parentId ?? null,
      replyToUserId: place?.replyToUserId ?? null,
    },
    select: commentSelect,
  });
  if (place) {
    await notify(db, {
      userId: place.notifyUserId,
      actorId: userId,
      kind: "comment_reply",
      title: `@${comment.author?.handle ?? "alguém"} respondeu seu comentário`,
      body: preview(input.body),
      href: `${target.href}#comentario-${comment.id}`,
    });
  } else if (input.targetType === "photo") {
    await notify(db, {
      userId: target.ownerId,
      actorId: userId,
      kind: "comment_reply",
      title: `@${comment.author?.handle ?? "alguém"} comentou na sua foto`,
      body: preview(input.body),
      href: target.href,
    });
  }
  if (input.targetType === "article") {
    const articleSlug = await syncArticleComments(db, input.targetId);
    if (articleSlug) return { status: "ok", comment: toView(comment), articleSlug };
  }
  return { status: "ok", comment: toView(comment) };
}

export type OwnCommentResult =
  | { status: "ok"; articleSlug?: string; photoId?: string }
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
 */
export async function deleteComment(db: Db, userId: string, id: string): Promise<OwnCommentResult> {
  const check = await ownComment(db, userId, id);
  if (check !== "ok") return { status: check };
  const deleted = await db.comment.update({
    where: { id },
    data: { status: DELETED_STATUS, body: "", pinned: false },
    select: { targetType: true, targetId: true },
  });
  if (deleted.targetType === "article") {
    const articleSlug = await syncArticleComments(db, deleted.targetId);
    if (articleSlug) return { status: "ok", articleSlug };
  }
  // The photo page caches its comment count (photo:<id>).
  if (deleted.targetType === "photo") return { status: "ok", photoId: deleted.targetId };
  return { status: "ok" };
}
