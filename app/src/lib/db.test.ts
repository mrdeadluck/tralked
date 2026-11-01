import { afterAll, describe, expect, it } from "vitest";
import { levelFromXp } from "@/lib/engine/xp";
import { env } from "@/lib/env";
import { skillsFromLedger } from "@/lib/progression/skills-from-ledger";

// These tests need Postgres up and seeded: `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
// They are skipped when the database is not reachable (e.g. CI without a service).
async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("seeded database", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("has the 14 preview games plus 5 name-only stubs of the full Steam catalog", async () => {
    const { prisma } = await import("@/lib/db");
    expect(await prisma.game.count({ where: { stub: false } })).toBe(14);
    // Stubs created by the seeded releases (offline lists) come on top.
    expect(await prisma.game.count({ where: { stub: true, releases: { none: {} } } })).toBe(5);
  });

  it("has releases around today from the offline lists, one row per game and platform", async () => {
    const { prisma } = await import("@/lib/db");
    expect(await prisma.gameRelease.count({ where: { source: "steam", platform: "PC" } })).toBeGreaterThanOrEqual(10);
    expect(await prisma.gameRelease.count({ where: { source: "igdb" } })).toBeGreaterThanOrEqual(5);
    // Old games in Steam's "popular new" list (Hollow Knight) are not releases.
    expect(await prisma.gameRelease.count({ where: { game: { slug: "hollow-knight" } } })).toBe(0);
  });

  it("gives lucas never-played games, Steam playtime details and a wishlist", async () => {
    const { prisma } = await import("@/lib/db");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const unplayed = await prisma.userGame.findMany({
      where: { userId: lucas.id, platform: "steam", playtimeMin: 0, unlockedCount: 0 },
      include: { game: true },
    });
    expect(unplayed.map((u) => u.game.name).sort()).toEqual(["Ecos de Ferro", "Lanterna do Farol", "Pomar Estelar"]);
    const hk = await prisma.userGame.findFirstOrThrow({ where: { userId: lucas.id, platform: "steam", game: { slug: "hollow-knight" } } });
    expect(hk).toMatchObject({ playtimeMin: 3120, playtime2WeeksMin: 95, lastPlayedAt: expect.any(Date) });
    expect(await prisma.wishlistItem.count({ where: { userId: lucas.id } })).toBe(3);
  });

  it("has the complete Hollow Knight guide with 7 steps", async () => {
    const { prisma } = await import("@/lib/db");
    const guide = await prisma.guide.findFirst({
      where: { game: { slug: "hollow-knight" } },
      include: { steps: true },
    });
    expect(guide?.steps).toHaveLength(7);
  });

  it("has lucas at level 47", async () => {
    const { prisma } = await import("@/lib/db");
    const stats = await prisma.userStats.findFirst({
      where: { user: { handle: "lucas" } },
    });
    expect(stats?.level).toBe(47);
  });

  it("recomputes every seeded user (attributes exist) and keeps the preview's level and streak", async () => {
    const { prisma } = await import("@/lib/db");
    const { LUCAS, PLAYERS } = await import("../../prisma/seed-data/users");
    const handles = [LUCAS.handle, ...PLAYERS.map((p) => p.handle)];
    const users = await prisma.user.findMany({
      where: { handle: { in: handles } },
      select: { handle: true, despertarShownAt: true, stats: true, _count: { select: { attributes: true } } },
    });
    expect(users).toHaveLength(handles.length);
    for (const user of users) {
      expect(user._count.attributes, user.handle).toBe(9);
      // The seed user never triggers the first-sync "Despertar" sequence.
      expect(user.despertarShownAt, user.handle).not.toBeNull();
    }
    const lucas = users.find((u) => u.handle === "lucas");
    expect(lucas?.stats).toMatchObject({ level: 47, streakCurrent: 12, streakBest: 19, shields: 1 });
  });

  it("rebuilds lucas's SkillProgress and level from his XP ledger", async () => {
    const { prisma } = await import("@/lib/db");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: lucas.id } });
    const rebuilt = skillsFromLedger(
      ledger.map((e) => ({
        xp: e.xp,
        skills: e.skills,
        skillPoints: e.skillPoints as Record<string, number> | null,
      })),
    );
    const stored = await prisma.skillProgress.findMany({ where: { userId: lucas.id } });
    expect(stored).toHaveLength(11);
    for (const row of stored) {
      expect(rebuilt[row.skill as keyof typeof rebuilt]).toEqual({
        level: row.level,
        points: row.points,
      });
    }
    expect(
      Object.fromEntries(stored.map((r) => [r.skill, r.level])),
    ).toEqual({
      soulslike: 34, plataforma: 31, rpg: 29, roguelike: 27, fps: 25, horror: 24,
      estrategia: 21, coop: 19, puzzle: 18, simulacao: 12, sabio: 8,
    });
    const totalXp = ledger.reduce((sum, e) => sum + e.xp, 0);
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: lucas.id } });
    expect(stats.totalXp).toBe(totalXp);
    expect(levelFromXp(totalXp).level).toBe(47);
  });

  it("stores the Hollow Knight collectibles on the guide, not in warnings", async () => {
    const { prisma } = await import("@/lib/db");
    const guide = await prisma.guide.findFirstOrThrow({ where: { game: { slug: "hollow-knight" } } });
    const collectibles = guide.collectibles as { name: string; total: number; description: string }[];
    expect(collectibles).toHaveLength(6);
    expect(collectibles[0]).toMatchObject({ name: "Larvas", total: 46 });
    expect(guide.warnings.some((w) => w.startsWith("Coletável"))).toBe(false);
  });

  it("keeps the guide and its revisions when the author's account is deleted", async () => {
    const { prisma } = await import("@/lib/db");
    class Rollback extends Error {}
    let seen: { guideAuthorId: string | null; revisionAuthors: (string | null)[]; tipAuthors: (string | null)[]; } | undefined;
    await prisma
      .$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { handle: "Escriba_Odete" } });
        await tx.user.delete({ where: { id: user.id } });
        const guide = await tx.guide.findFirstOrThrow({
          where: { game: { slug: "hollow-knight" } },
          include: { revisions: true, tips: true },
        });
        seen = {
          guideAuthorId: guide.authorId,
          revisionAuthors: guide.revisions.map((r) => r.authorId),
          tipAuthors: guide.tips.map((t) => t.authorId),
        };
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(seen?.guideAuthorId).toBeNull();
    expect(seen?.revisionAuthors).toHaveLength(4);
    expect(seen?.revisionAuthors.filter((a) => a === null)).toHaveLength(2);
    expect(seen?.tipAuthors).toHaveLength(3);
    // Rolled back: the author still exists afterwards.
    expect(await prisma.user.count({ where: { handle: "Escriba_Odete" } })).toBe(1);
  });

  it("keeps the family and removes the user's own data when the owner is deleted", async () => {
    const { prisma } = await import("@/lib/db");
    class Rollback extends Error {}
    let seen: { ownerId: string | null; members: number; ledger: number; stats: number; } | undefined;
    await prisma
      .$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { handle: "lucas" } });
        await tx.user.delete({ where: { id: user.id } });
        const family = await tx.family.findFirstOrThrow({
          where: { name: "Família Lucas" },
          include: { members: true },
        });
        seen = {
          ownerId: family.ownerId,
          members: family.members.length,
          ledger: await tx.xpLedgerEntry.count({ where: { userId: user.id } }),
          stats: await tx.userStats.count({ where: { userId: user.id } }),
        };
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(seen).toEqual({ ownerId: null, members: 2, ledger: 0, stats: 0 });
    expect(await prisma.user.count({ where: { handle: "lucas" } })).toBe(1);
  });

  it("links lucas's Steam, PSN, Xbox and RetroAchievements accounts, all verified", async () => {
    const { prisma } = await import("@/lib/db");
    const accounts = await prisma.linkedAccount.findMany({
      where: { user: { handle: "lucas" } },
      orderBy: { platform: "asc" },
    });
    expect(accounts.map((a) => a.platform)).toEqual(["psn", "retro", "steam", "xbox"]);
    expect(accounts.every((a) => a.verifiedAt !== null && a.verifyCode === null)).toBe(true);
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    expect(accounts.find((a) => a.platform === "steam")?.externalId).toBe(lucas.steamId);
    // Every seeded Steam user also has its Steam LinkedAccount.
    expect(await prisma.linkedAccount.count({ where: { platform: "steam" } })).toBe(
      await prisma.user.count({ where: { steamId: { not: null } } }),
    );
  });

  it("has PSN trophies with tiers and Xbox achievements with gamerscore for 3 games", async () => {
    const { prisma } = await import("@/lib/db");
    const psn = await prisma.achievement.findMany({ where: { platform: "psn" }, include: { game: true } });
    const xbox = await prisma.achievement.findMany({ where: { platform: "xbox" }, include: { game: true } });
    expect(new Set(psn.map((a) => a.game.slug)).size).toBe(3);
    expect(new Set(xbox.map((a) => a.game.slug)).size).toBe(3);
    expect(psn.every((a) => ["bronze", "silver", "gold", "platinum"].includes(a.trophyTier ?? ""))).toBe(true);
    expect(psn.filter((a) => a.trophyTier === "platinum")).toHaveLength(3);
    expect(xbox.every((a) => (a.points ?? 0) > 0 && a.trophyTier === null)).toBe(true);
    expect(await prisma.achievement.count({ where: { platform: "steam", trophyTier: { not: null } } })).toBe(0);
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const hk = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const libraries = await prisma.userGame.findMany({ where: { userId: lucas.id, gameId: hk.id } });
    expect(libraries.map((l) => l.platform).sort()).toEqual(["psn", "steam", "xbox"]);
    // Platinum on PSN: every trophy unlocked.
    expect(libraries.find((l) => l.platform === "psn")?.completedAt).not.toBeNull();
  });

  it("has fixture media for every game and the example editorial and community data", async () => {
    const { prisma } = await import("@/lib/db");
    const games = await prisma.game.count({ where: { stub: false } });
    expect(await prisma.gameMedia.count({ where: { source: "fixture", url: null } })).toBe(games * 11);
    expect(await prisma.gamePlatformLink.count({ where: { platform: "steam" } })).toBe(games);
    expect(await prisma.externalNews.count({ where: { game: { slug: "hollow-knight" } } })).toBe(6);
    expect(await prisma.forumCategory.count()).toBe(3);
    expect(await prisma.forumThread.count()).toBe(6);
    expect(await prisma.forumThread.count({ where: { solvedPostId: { not: null } } })).toBe(1);
    expect(await prisma.photo.count({ where: { url: null } })).toBe(12);
    const photos = await prisma.photo.findMany({ include: { _count: { select: { likes: true } } } });
    expect(photos.every((p) => p.likeCount === p._count.likes)).toBe(true);
    expect(await prisma.comment.count()).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { user: { handle: "lucas" }, readAt: null } })).toBe(2);
    const keys = await prisma.apiKey.findMany();
    expect(keys).toHaveLength(1);
    expect(keys[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores the 10 seeded articles as published ContentBlock[] with their games linked", async () => {
    const { prisma } = await import("@/lib/db");
    const articles = await prisma.article.findMany({ include: { games: true } });
    expect(articles).toHaveLength(10);
    for (const a of articles) {
      expect(a.status).toBe("published");
      const blocks = a.blocks as { type: string; level?: number; text?: string }[];
      expect(blocks.length).toBeGreaterThan(1);
      expect(blocks.some((b) => b.type === "heading" && b.level === 2)).toBe(true);
      expect(blocks.every((b) => !b.text?.startsWith("#"))).toBe(true);
      expect(a.games.map((g) => g.gameId)).toEqual(a.gameId ? [a.gameId] : []);
    }
  });

  it("keeps forum, gallery and comment content when its author's account is deleted", async () => {
    const { prisma } = await import("@/lib/db");
    class Rollback extends Error {}
    let seen: Record<string, unknown> | undefined;
    await prisma
      .$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { handle: "lucas" } });
        await tx.user.delete({ where: { id: user.id } });
        seen = {
          thread: (await tx.forumThread.findUnique({ where: { id: "seed-thread-1" } }))?.authorId,
          post: (await tx.forumPost.findUnique({ where: { id: "seed-post-4-3" } }))?.authorId,
          photo: (await tx.photo.findUnique({ where: { id: "seed-photo-01" } }))?.authorId,
          comment: (await tx.comment.findUnique({ where: { id: "seed-comment-07" } }))?.authorId,
          apiKey: (await tx.apiKey.findUnique({ where: { id: "seed-api-key-1" } }))?.createdById,
          linkedAccounts: await tx.linkedAccount.count({ where: { userId: user.id } }),
          notifications: await tx.notification.count({ where: { userId: user.id } }),
          photoLikes: await tx.photoLike.count({ where: { userId: user.id } }),
          libraries: await tx.userGame.count({ where: { userId: user.id } }),
        };
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(seen).toEqual({
      thread: null,
      post: null,
      photo: null,
      comment: null,
      apiKey: null,
      linkedAccounts: 0,
      notifications: 0,
      photoLikes: 0,
      libraries: 0,
    });
    // Rolled back: the content still has its author afterwards.
    const thread = await prisma.forumThread.findUniqueOrThrow({ where: { id: "seed-thread-1" } });
    expect(thread.authorId).not.toBeNull();
  });

  it("refuses a platform account linked twice, or two accounts of one platform per user", async () => {
    const { prisma } = await import("@/lib/db");
    const lucasPsn = await prisma.linkedAccount.findFirstOrThrow({
      where: { platform: "psn", user: { handle: "lucas" } },
    });
    const other = await prisma.user.findUniqueOrThrow({ where: { handle: "Lenhador_Bento" } });
    await expect(
      prisma.linkedAccount.create({
        data: { userId: other.id, platform: "psn", externalId: lucasPsn.externalId, handle: "copia" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.linkedAccount.create({
        data: { userId: lucasPsn.userId, platform: "psn", externalId: "9000000000000000999", handle: "segunda" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.linkedAccount.count({ where: { platform: "psn" } })).toBe(1);
  });

  it("is idempotent: seeding again keeps every row count", async () => {
    const { prisma } = await import("@/lib/db");
    const { runSeed } = await import("../../prisma/seed");
    const snapshot = async () => ({
      users: await prisma.user.count(),
      games: await prisma.game.count(),
      gameSkills: await prisma.gameSkill.count(),
      achievements: await prisma.achievement.count(),
      userGames: await prisma.userGame.count(),
      wishlist: await prisma.wishlistItem.count(),
      userAchievements: await prisma.userAchievement.count(),
      ledger: await prisma.xpLedgerEntry.count(),
      skillProgress: await prisma.skillProgress.count(),
      stats: await prisma.userStats.count(),
      missions: await prisma.mission.count(),
      guides: await prisma.guide.count(),
      steps: await prisma.guideStep.count(),
      notes: await prisma.guideAchievementNote.count(),
      tips: await prisma.guideTip.count(),
      revisions: await prisma.guideRevision.count(),
      stepProgress: await prisma.guideStepProgress.count(),
      authors: await prisma.author.count(),
      articles: await prisma.article.count(),
      families: await prisma.family.count(),
      members: await prisma.familyMember.count(),
      invites: await prisma.familyInvite.count(),
      linkedAccounts: await prisma.linkedAccount.count(),
      platformLinks: await prisma.gamePlatformLink.count(),
      media: await prisma.gameMedia.count(),
      articleGames: await prisma.articleGame.count(),
      externalNews: await prisma.externalNews.count(),
      newsFeeds: await prisma.newsFeed.count(),
      forumCategories: await prisma.forumCategory.count(),
      forumThreads: await prisma.forumThread.count(),
      forumPosts: await prisma.forumPost.count(),
      photos: await prisma.photo.count(),
      photoLikes: await prisma.photoLike.count(),
      comments: await prisma.comment.count(),
      reports: await prisma.report.count(),
      notifications: await prisma.notification.count(),
      apiKeys: await prisma.apiKey.count(),
    });
    const before = await snapshot();
    await runSeed();
    expect(await snapshot()).toEqual(before);
  }, 60_000);
});
