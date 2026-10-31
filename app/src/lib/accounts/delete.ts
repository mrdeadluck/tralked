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
 * skills, attributes, missions, likes, votes, notifications, family membership) is removed by
 * the schema's cascades. Authored content (guides, tips, comments, forum threads and posts,
 * photos, reports) stays with its author set to null, so it shows as an anonymous author.
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
    // Newsletter addresses are stored lowercased and trimmed (newsletterEmailSchema).
    if (user.email) {
      await tx.newsletterSubscriber.deleteMany({ where: { email: user.email.trim().toLowerCase() } });
    }
    await tx.user.delete({ where: { id: userId } });
    return liked;
  });

  return {
    photoIds: [...new Set([...photos.map((p) => p.id), ...likedPhotoIds])],
    threadIds: [...new Set([...threads.map((t) => t.id), ...posts.map((p) => p.threadId)])],
    guideGameSlugs: [...new Set([...guides, ...tips.map((t) => t.guide)].map((g) => g.game.slug))],
  };
}
