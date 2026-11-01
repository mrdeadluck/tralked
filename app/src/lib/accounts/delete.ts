import { prisma } from "@/lib/db";
import { leaveFamily } from "@/lib/family/service";

export type DeletedAccount = {
  /** Cached public pages that showed the user (as author, or in a like count). */
  photoIds: string[];
  threadIds: string[];
  guideGameSlugs: string[];
};

/**
 * LGPD account deletion. Personal data (profile, linked accounts, library, unlocks, XP ledger,
 * skills, attributes, missions, likes, votes, notifications, family membership, follows,
 * friendships, blocks, comment reactions) is removed by the schema's cascades. Authored content
 * (guides, tips, comments, forum threads and posts, photos, reports, private messages already
 * delivered) stays with its author set to null, so it shows as an anonymous author; a private
 * conversation the other side had already deleted (or nobody is left in) is deleted entirely.
 *
 * Before the delete: the user leaves their family (ownership passes to the oldest member, an
 * empty family is removed), photo like and tip vote counters drop by the user's likes and votes,
 * and a newsletter subscription with the account e-mail is removed.
 * Returns null when the user does not exist.
 */
export async function deleteAccount(userId: string): Promise<DeletedAccount | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return null;

  const [photos, threads, posts, guides, tips] = await Promise.all([
    prisma.photo.findMany({ where: { authorId: userId }, select: { id: true } }),
    prisma.forumThread.findMany({ where: { authorId: userId }, select: { id: true } }),
    prisma.forumPost.findMany({ where: { authorId: userId }, select: { threadId: true } }),
    prisma.guide.findMany({ where: { authorId: userId }, select: { game: { select: { slug: true } } } }),
    prisma.guideTip.findMany({
      where: { authorId: userId },
      select: { guide: { select: { game: { select: { slug: true } } } } },
    }),
  ]);

  await leaveFamily(userId);

  const likedPhotoIds = await prisma.$transaction(async (tx) => {
    // Likes and votes cascade away with the user; their denormalized counters follow.
    const likes = await tx.photoLike.findMany({ where: { userId }, select: { photoId: true } });
    const liked = likes.map((l) => l.photoId);
    if (liked.length > 0) {
      await tx.photo.updateMany({ where: { id: { in: liked }, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } });
    }
    const votes = await tx.guideVote.findMany({ where: { userId }, select: { tipId: true } });
    if (votes.length > 0) {
      await tx.guideTip.updateMany({
        where: { id: { in: votes.map((v) => v.tipId) }, votes: { gt: 0 } },
        data: { votes: { decrement: 1 } },
      });
    }
    // Reactions (F9) cascade away too: the comments' and posts' counters drop with them.
    const reactions = await tx.reaction.findMany({ where: { userId }, select: { targetType: true, targetId: true, value: true } });
    for (const kind of ["comment", "post"] as const) {
      for (const value of [1, -1] as const) {
        const ids = reactions.filter((r) => r.targetType === kind && r.value === value).map((r) => r.targetId);
        if (ids.length === 0) continue;
        const field = value === 1 ? "likeCount" : "dislikeCount";
        const where = { id: { in: ids }, [field]: { gt: 0 } };
        const data = { [field]: { decrement: 1 } };
        if (kind === "comment") await tx.comment.updateMany({ where, data });
        else await tx.forumPost.updateMany({ where, data });
      }
    }
    // Newsletter addresses are stored lowercased and trimmed (newsletterEmailSchema).
    if (user.email) {
      await tx.newsletterSubscriber.deleteMany({ where: { email: user.email.trim().toLowerCase() } });
    }
    await tx.user.delete({ where: { id: userId } });
    // Private conversations keep the messages for the other side (sender shown as "Conta
    // removida"); one nobody is left in, or the other side had already deleted, goes for good.
    await tx.conversation.deleteMany({ where: { userLowId: null, userHighId: null } });
    await tx.$executeRaw`
      DELETE FROM "Conversation" c
      WHERE (c."userLowId" IS NULL AND c."highClearedAt" IS NOT NULL AND c."highClearedAt" >= c."lastMessageAt")
         OR (c."userHighId" IS NULL AND c."lowClearedAt" IS NOT NULL AND c."lowClearedAt" >= c."lastMessageAt")`;
    return liked;
  });

  return {
    photoIds: [...new Set([...photos.map((p) => p.id), ...likedPhotoIds])],
    threadIds: [...new Set([...threads.map((t) => t.id), ...posts.map((p) => p.threadId)])],
    guideGameSlugs: [...new Set([...guides, ...tips.map((t) => t.guide)].map((g) => g.game.slug))],
  };
}
