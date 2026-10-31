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

  it("has the 14 preview games", async () => {
    const { prisma } = await import("@/lib/db");
    expect(await prisma.game.count()).toBe(14);
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
        const user = await tx.user.findUniqueOrThrow({ where: { handle: "Nyx_Vortex" } });
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
    expect(await prisma.user.count({ where: { handle: "Nyx_Vortex" } })).toBe(1);
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

  it("is idempotent: seeding again keeps every row count", async () => {
    const { prisma } = await import("@/lib/db");
    const { runSeed } = await import("../../prisma/seed");
    const snapshot = async () => ({
      users: await prisma.user.count(),
      games: await prisma.game.count(),
      gameSkills: await prisma.gameSkill.count(),
      achievements: await prisma.achievement.count(),
      userGames: await prisma.userGame.count(),
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
    });
    const before = await snapshot();
    await runSeed();
    expect(await snapshot()).toEqual(before);
  }, 60_000);
});
