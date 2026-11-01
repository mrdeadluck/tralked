import { z } from "zod";
import { findCommentTarget, type CommentTargetType } from "@/lib/community/comments";
import type { Db } from "@/lib/community/limits";
import type { SocialItemKind } from "@/lib/engine/social";

/**
 * A "social item" is a comment (news, guides, photos) or a forum post: both take reactions,
 * threaded replies and the helpful mark the same way.
 */
export const SOCIAL_KINDS = ["comment", "post"] as const;

export const itemRefSchema = z.object({
  kind: z.enum(SOCIAL_KINDS),
  id: z.string().min(1).max(64),
});

export type ItemRef = z.output<typeof itemRefSchema>;

export type SocialItem = {
  kind: SocialItemKind;
  id: string;
  authorId: string | null;
  authorHandle: string | null;
  parentId: string | null;
  parentAuthorId: string | null;
  helpfulAt: Date | null;
  likeCount: number;
  dislikeCount: number;
  /** Link to the item on its public page. */
  href: string;
  /** Short label of where it lives, for notifications ("Guia de Hollow Knight"). */
  label: string;
  /** Comment target (comments only): the thread of replies stays on one target. */
  target: { type: CommentTargetType; id: string } | null;
  /** Forum thread (posts only). */
  threadId: string | null;
  threadLocked: boolean;
};

/** A visible item on a public page, or null (missing, hidden, removed, deleted, or its page is gone). */
export async function loadItem(db: Db, ref: ItemRef): Promise<SocialItem | null> {
  if (ref.kind === "comment") {
    const c = await db.comment.findUnique({
      where: { id: ref.id },
      select: {
        id: true,
        status: true,
        authorId: true,
        author: { select: { handle: true } },
        parentId: true,
        parent: { select: { authorId: true } },
        helpfulAt: true,
        likeCount: true,
        dislikeCount: true,
        targetType: true,
        targetId: true,
      },
    });
    if (!c || c.status !== "visible") return null;
    const target = await findCommentTarget(db, c.targetType as CommentTargetType, c.targetId);
    if (!target) return null;
    return {
      kind: "comment",
      id: c.id,
      authorId: c.authorId,
      authorHandle: c.author?.handle ?? null,
      parentId: c.parentId,
      parentAuthorId: c.parent?.authorId ?? null,
      helpfulAt: c.helpfulAt,
      likeCount: c.likeCount,
      dislikeCount: c.dislikeCount,
      href: `${target.href}#comentario-${c.id}`,
      label: target.label,
      target: { type: c.targetType as CommentTargetType, id: c.targetId },
      threadId: null,
      threadLocked: false,
    };
  }
  const p = await db.forumPost.findUnique({
    where: { id: ref.id },
    select: {
      id: true,
      status: true,
      authorId: true,
      author: { select: { handle: true } },
      parentId: true,
      parent: { select: { authorId: true } },
      helpfulAt: true,
      likeCount: true,
      dislikeCount: true,
      threadId: true,
      thread: { select: { status: true, title: true } },
    },
  });
  if (!p || p.status !== "visible" || !["open", "locked"].includes(p.thread.status)) return null;
  return {
    kind: "post",
    id: p.id,
    authorId: p.authorId,
    authorHandle: p.author?.handle ?? null,
    parentId: p.parentId,
    parentAuthorId: p.parent?.authorId ?? null,
    helpfulAt: p.helpfulAt,
    likeCount: p.likeCount,
    dislikeCount: p.dislikeCount,
    href: `/forum/t/${p.threadId}#post-${p.id}`,
    label: p.thread.title,
    target: null,
    threadId: p.threadId,
    threadLocked: p.thread.status === "locked",
  };
}
