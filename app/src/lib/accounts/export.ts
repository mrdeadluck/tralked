import { prisma } from "@/lib/db";

/**
 * LGPD data export: everything Tralked stores about one user, as plain JSON. Every query is
 * scoped to the user's own rows (`userId` / `authorId` / `reporterId`) and selects explicit
 * fields, so other people's data (who liked a photo, replies by others, notification texts that
 * quote them, secrets such as API key hashes or pending link codes) never ends up in the file.
 */
export async function exportUserData(userId: string, now: Date = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      email: true,
      bio: true,
      avatarUrl: true,
      profilePublic: true,
      role: true,
      steamId: true,
      googleSub: true,
      lastSyncedAt: true,
      despertarShownAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) return null;

  const mine = { userId };
  const authored = { authorId: userId };

  const [
    linkedAccounts,
    stats,
    skills,
    attributes,
    games,
    achievements,
    ledger,
    missions,
    gameOpens,
    guideStepProgress,
    guideVotes,
    guides,
    guideVersions,
    guideTips,
    guideRevisions,
    comments,
    forumThreads,
    forumPosts,
    photos,
    photoLikes,
    reports,
    notifications,
    family,
    apiKeys,
  ] = await Promise.all([
    prisma.linkedAccount.findMany({
      where: { ...mine, verifiedAt: { not: null } },
      select: { platform: true, externalId: true, handle: true, verifiedAt: true, lastSyncedAt: true, createdAt: true },
      orderBy: { platform: "asc" },
    }),
    prisma.userStats.findUnique({
      where: mine,
      select: { totalXp: true, level: true, vocation: true, streakCurrent: true, streakBest: true, shields: true },
    }),
    prisma.skillProgress.findMany({ where: mine, select: { skill: true, level: true, points: true } }),
    prisma.attributeProgress.findMany({ where: mine, select: { attribute: true, level: true, points: true } }),
    prisma.userGame.findMany({
      where: mine,
      select: {
        platform: true,
        playtimeMin: true,
        unlockedCount: true,
        completedAt: true,
        game: { select: { slug: true, name: true } },
      },
      orderBy: [{ gameId: "asc" }, { platform: "asc" }],
    }),
    prisma.userAchievement.findMany({
      where: mine,
      select: {
        unlockedAt: true,
        hardcore: true,
        suspicious: true,
        achievement: {
          select: { apiName: true, name: true, platform: true, game: { select: { slug: true, name: true } } },
        },
      },
      orderBy: { unlockedAt: "asc" },
    }),
    prisma.xpLedgerEntry.findMany({
      where: mine,
      select: { source: true, sourceKey: true, xp: true, skills: true, platform: true, voidedAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mission.findMany({
      where: mine,
      select: { kind: true, periodKey: true, title: true, rewardXp: true, progress: true, completedAt: true },
      orderBy: { periodKey: "asc" },
    }),
    prisma.gameOpen.findMany({
      where: mine,
      select: { openedAt: true, game: { select: { slug: true } } },
    }),
    prisma.guideStepProgress.findMany({
      where: mine,
      select: { step: { select: { order: true, title: true, guide: { select: { game: { select: { slug: true } } } } } } },
    }),
    prisma.guideVote.findMany({ where: mine, select: { tipId: true } }),
    prisma.guide.findMany({
      where: authored,
      select: { id: true, status: true, publishedAt: true, createdAt: true, game: { select: { slug: true, name: true } } },
    }),
    prisma.guideVersion.findMany({
      where: authored,
      select: { guideId: true, version: true, createdAt: true },
    }),
    prisma.guideTip.findMany({
      where: authored,
      select: { id: true, guideId: true, body: true, votes: true, createdAt: true },
    }),
    prisma.guideRevision.findMany({
      where: authored,
      select: { guideId: true, version: true, summary: true, createdAt: true },
    }),
    prisma.comment.findMany({
      where: authored,
      select: { id: true, targetType: true, targetId: true, body: true, status: true, createdAt: true, editedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.forumThread.findMany({
      where: authored,
      select: { id: true, title: true, slug: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.forumPost.findMany({
      where: authored,
      select: { id: true, threadId: true, body: true, status: true, createdAt: true, editedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.photo.findMany({
      where: authored,
      select: {
        id: true,
        url: true,
        width: true,
        height: true,
        caption: true,
        status: true,
        likeCount: true,
        createdAt: true,
        game: { select: { slug: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.photoLike.findMany({ where: mine, select: { photoId: true, createdAt: true } }),
    prisma.report.findMany({
      where: { reporterId: userId },
      select: { targetType: true, targetId: true, reason: true, status: true, createdAt: true },
    }),
    // Title and body are left out: they quote other people (who liked, who replied, what they
    // wrote). Notifications are ephemeral and deleted after 90 days.
    prisma.notification.findMany({
      where: mine,
      select: { kind: true, href: true, readAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.familyMember.findUnique({
      where: { userId },
      select: { role: true, joinedAt: true, family: { select: { name: true } } },
    }),
    prisma.apiKey.findMany({
      where: { createdById: userId },
      select: { name: true, prefix: true, scopes: true, createdAt: true, revokedAt: true },
    }),
  ]);

  return {
    exportedAt: now.toISOString(),
    format: "tralked-user-export/1",
    user,
    linkedAccounts,
    progress: { stats, skills, attributes, games, achievements, ledger, missions, gameOpens },
    guides: {
      written: guides,
      versions: guideVersions,
      tips: guideTips,
      revisions: guideRevisions,
      votes: guideVotes,
      stepProgress: guideStepProgress.map((p) => ({
        game: p.step.guide.game.slug,
        order: p.step.order,
        title: p.step.title,
      })),
    },
    community: { comments, forumThreads, forumPosts, photos, photoLikes, reports },
    notifications,
    family: family ? { name: family.family.name, role: family.role, joinedAt: family.joinedAt } : null,
    apiKeys,
  };
}

export type UserDataExport = NonNullable<Awaited<ReturnType<typeof exportUserData>>>;
