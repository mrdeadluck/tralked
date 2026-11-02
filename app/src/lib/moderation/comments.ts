import { z } from "zod";
import { moderateContent } from "@/lib/admin/moderation";
import { COMMENT_TARGETS } from "@/lib/community/comments";
import { prisma } from "@/lib/db";
import { logModeration } from "./log";
import { moderationReasonSchema } from "./notice";

/**
 * Moderation from the discussion itself: remove any comment (the row stays and reads
 * "Comentário removido pela moderação"), pin one comment per discussion, lock a discussion.
 * Callers check the role (canModerate) before calling these.
 */

const id = z.string().min(1).max(64);

export const commentModerationSchema = z.strictObject({
  id,
  action: z.enum(["remove", "pin", "unpin"]),
  reason: moderationReasonSchema,
});

export type CommentModerationResult =
  | { ok: true; tags: string[]; recompute: string[] }
  | { ok: false; error: string };

export async function moderateComment(
  input: z.output<typeof commentModerationSchema>,
  moderatorId: string,
  now: Date = new Date(),
): Promise<CommentModerationResult> {
  if (input.action === "remove") {
    const result = await moderateContent(
      { targetType: "comment", targetId: input.id, action: "remove", reason: input.reason },
      moderatorId,
      now,
    );
    return result.ok ? { ok: true, tags: result.tags, recompute: result.recompute } : result;
  }

  const pin = input.action === "pin";
  return prisma.$transaction(async (tx): Promise<CommentModerationResult> => {
    const comment = await tx.comment.findUnique({
      where: { id: input.id },
      select: { status: true, pinned: true, targetType: true, targetId: true, authorId: true },
    });
    if (!comment) return { ok: false, error: "Esse comentário não existe mais." };
    if (comment.status !== "visible") return { ok: false, error: "Só comentários visíveis podem ser fixados." };
    if (comment.pinned === pin) return { ok: false, error: pin ? "Este comentário já está fixado." : "Este comentário não está fixado." };
    if (pin) {
      // One pinned comment per discussion: pinning another one replaces it.
      await tx.comment.updateMany({
        where: { targetType: comment.targetType, targetId: comment.targetId, pinned: true },
        data: { pinned: false },
      });
    }
    await tx.comment.update({ where: { id: input.id }, data: { pinned: pin } });
    await logModeration(tx, {
      actorId: moderatorId,
      action: pin ? "comment.pin" : "comment.unpin",
      targetType: "comment",
      targetId: input.id,
      targetUserId: comment.authorId,
      reason: input.reason,
      details: { on: `${comment.targetType}:${comment.targetId}` },
    });
    return { ok: true, tags: [], recompute: [] };
  });
}

export const discussionLockSchema = z.strictObject({
  targetType: z.enum(COMMENT_TARGETS),
  targetId: id,
  locked: z.boolean(),
  reason: moderationReasonSchema,
});

/** Locks (no new comments) or unlocks the comments of an article, guide, photo or thread. */
export async function setDiscussionLock(
  input: z.output<typeof discussionLockSchema>,
  moderatorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = { targetType: input.targetType, targetId: input.targetId };
  return prisma.$transaction(async (tx) => {
    if (input.locked) {
      const created = await tx.discussionLock.createMany({ data: [{ ...key, lockedById: moderatorId }], skipDuplicates: true });
      if (created.count === 0) return { ok: false, error: "Esta discussão já está trancada." } as const;
    } else {
      const removed = await tx.discussionLock.deleteMany({ where: key });
      if (removed.count === 0) return { ok: false, error: "Esta discussão não está trancada." } as const;
    }
    await logModeration(tx, {
      actorId: moderatorId,
      action: input.locked ? "discussion.lock" : "discussion.unlock",
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
    });
    return { ok: true } as const;
  });
}
