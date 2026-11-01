import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { dailyPeriodKey, weeklyPeriodKey } from "@/lib/progression/periods";
import { getRank, getRanking } from "@/lib/highscores/queries";
import { getCharacter, hoursUntilDailyReset } from "@/lib/queries/players";

describe("hoursUntilDailyReset", () => {
  it("counts whole hours to the next America/Sao_Paulo midnight", () => {
    // 18:00Z = 15:00 in Sao Paulo -> 9 h to midnight
    expect(hoursUntilDailyReset(new Date("2026-10-31T18:00:00Z"))).toBe(9);
    // 02:59:30Z = 23:59:30 local -> rounds up to 1 h, never 0
    expect(hoursUntilDailyReset(new Date("2026-11-01T02:59:30Z"))).toBe(1);
    // 03:00:00Z = 00:00 local -> a full day ahead
    expect(hoursUntilDailyReset(new Date("2026-11-01T03:00:00Z"))).toBe(24);
  });
});

// These tests need Postgres up and seeded (see db.test.ts); skipped when unreachable.
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
const NIVEL = { metric: "nivel" } as const;
const SOULSLIKE = { metric: "genero", skill: "soulslike" } as const;

describe.skipIf(!reachable)("player queries (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("getCharacter('lucas') is level 47 with the full sheet", async () => {
    const character = await getCharacter("lucas");
    expect(character?.level).toBe(47);
    expect(character?.skills).toHaveLength(11);
    expect(character?.skills[0]).toMatchObject({ id: "soulslike", level: 34 });
    expect(character?.skills.at(-1)?.id).toBe("sabio");
    expect(character?.streak.week).toHaveLength(7);
    expect(character?.streak.week.at(-1)?.today).toBe(true);
    expect(character?.recent.length).toBeLessThanOrEqual(6);
    expect(character?.recent.length).toBeGreaterThan(0);
    expect(character?.xpCurrent).toBeLessThan(character!.xpNext);
    expect(character?.stats.rank).toBeGreaterThan(0);
    for (const game of character!.almostThere) {
      expect(game.percent).toBeGreaterThanOrEqual(70);
      expect(game.percent).toBeLessThan(100);
    }
  });

  it("getCharacter lists the current daily and weekly missions (period keys from progression/periods)", async () => {
    const { prisma } = await import("@/lib/db");
    const now = new Date();
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const stored = await prisma.mission.findMany({
      where: { userId: lucas.id, periodKey: { in: [dailyPeriodKey(now), weeklyPeriodKey(now)] } },
    });
    const character = await getCharacter("lucas", now);
    const weekly = character!.missions.filter((m) => m.kind === "weekly");
    expect(weekly.length).toBeGreaterThan(0);
    expect(character!.missions.some((m) => m.kind === "daily")).toBe(true);
    expect(character!.missions.map((m) => m.id).sort()).toEqual(stored.map((m) => m.id).sort());
    for (const mission of weekly) expect(mission.goal).toBeGreaterThan(0);
  });
  it("getCharacter's counters cover every platform and agree with the Troféus card", async () => {
    const { prisma } = await import("@/lib/db");
    const { getCharacterSheetExtras } = await import("@/lib/character/sheet");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    expect(await prisma.userGame.count({ where: { userId: lucas.id, platform: { not: "steam" } } })).toBeGreaterThan(0);
    const character = await getCharacter("lucas");
    const extras = await getCharacterSheetExtras(lucas.id);
    // "Conquistas" is the Troféus card's total: valid unlocks of all platforms.
    expect(character?.stats.achievements).toBe(extras.trophies.byPlatform.reduce((sum, p) => sum + p.unlocks, 0));
    expect(character?.stats.achievements).toBe(await prisma.userAchievement.count({ where: { userId: lucas.id, suspicious: false } }));
    expect(character?.stats.pendingReview).toBe(
      await prisma.userAchievement.count({ where: { userId: lucas.id, suspicious: true, fraudReview: null } }),
    );
    const slugs = character!.almostThere.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("getCharacter leaves suspicious unlocks and tainted 100%s out, and finds 'Quase lá' on PSN", async () => {
    const { prisma } = await import("@/lib/db");
    class Rollback extends Error {}
    const handle = `contagem-teste-${Date.now()}`;
    let seen = null as Awaited<ReturnType<typeof getCharacter>>;
    await prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({ data: { handle, displayName: handle } });
        const game = await tx.game.create({
          data: {
            slug: handle,
            name: "Jogo da contagem",
            achievementCount: 0,
            platforms: ["PLAYSTATION", "XBOX"],
            achievements: {
              create: [
                ...Array.from({ length: 10 }, (_, i) => ({ platform: "psn", apiName: `P${i}`, name: `P${i}`, globalPct: 50 })),
                ...Array.from({ length: 2 }, (_, i) => ({ platform: "xbox", apiName: `X${i}`, name: `X${i}`, globalPct: 2 })),
              ],
            },
          },
          include: { achievements: true },
        });
        const psn = game.achievements.filter((a) => a.platform === "psn");
        const xbox = game.achievements.filter((a) => a.platform === "xbox");
        const at = new Date("2026-10-01T12:00:00Z");
        // PSN: 8 valid + 1 pending review of 10 -> 80% "Quase lá" (the pending one never counts).
        await tx.userGame.create({ data: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 0, unlockedCount: 9 } });
        await tx.userAchievement.createMany({
          data: psn.slice(0, 9).map((a, i) => ({ userId: user.id, achievementId: a.id, unlockedAt: at, suspicious: i === 8 })),
        });
        // Xbox: a "100%" with a confirmed-fraud unlock: not a perfect game, not counted, not pending.
        await tx.userGame.create({
          data: { userId: user.id, gameId: game.id, platform: "xbox", playtimeMin: 0, unlockedCount: 2, completedAt: at },
        });
        await tx.userAchievement.createMany({
          data: xbox.map((a, i) => ({
            userId: user.id,
            achievementId: a.id,
            unlockedAt: at,
            suspicious: i === 1,
            fraudReview: i === 1 ? "confirmed" : null,
          })),
        });
        seen = await getCharacter(handle, new Date(), tx);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    const character = seen!;
    expect(character.stats).toMatchObject({ achievements: 9, pendingReview: 1, perfectGames: 0, legendary: 1 });
    expect(character.almostThere).toEqual([
      expect.objectContaining({ slug: handle, unlocked: 8, total: 10, percent: 80 }),
    ]);
  });

  it("getCharacter returns null for an unknown handle", async () => {
    expect(await getCharacter("ninguem-por-aqui")).toBeNull();
  });

  it("a user with profilePublic=false does not appear and has no rank", async () => {
    const { prisma } = await import("@/lib/db");
    class Rollback extends Error {}
    const handle = `privado-teste-${Date.now()}`;
    const seen: Record<string, unknown> = {};
    // Runs inside a transaction that is rolled back, so other tests never see the fixture.
    await prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            steamId: `test-${handle}`,
            handle,
            displayName: handle,
            profilePublic: false,
            stats: { create: { totalXp: 999_999_999, level: 99, vocation: "Recruta" } },
            skills: { create: { skill: "soulslike", level: 99, points: 1 } },
          },
        });
        seen.inGeral = (await getRanking(NIVEL, 50, tx)).some((r) => r.handle === handle);
        seen.inSkill = (await getRanking(SOULSLIKE, 50, tx)).some((r) => r.handle === handle);
        seen.rank = await getRank(user.id, NIVEL, tx);
        seen.sheetRank = (await getCharacter(handle, new Date(), tx))?.stats.rank;

        // Control: the same user, once public, tops both rankings.
        await tx.user.update({ where: { id: user.id }, data: { profilePublic: true } });
        seen.publicGeral = (await getRanking(NIVEL, 1, tx))[0]?.handle;
        seen.publicSkill = (await getRanking(SOULSLIKE, 1, tx))[0]?.handle;
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(seen).toEqual({
      inGeral: false,
      inSkill: false,
      rank: null,
      sheetRank: null,
      publicGeral: handle,
      publicSkill: handle,
    });
    expect(await prisma.user.count({ where: { handle } })).toBe(0);
  });

  it("the sheet's rank is the player's position on the Nível board", async () => {
    const rows = await getRanking(NIVEL, 500);
    const position = rows.findIndex((r) => r.handle === "lucas") + 1;
    expect(position).toBeGreaterThan(0);
    expect((await getCharacter("lucas"))?.stats.rank).toBe(position);
    const soulslike = await getRanking(SOULSLIKE, 500);
    const lucas = soulslike.find((r) => r.handle === "lucas")!;
    expect(await getRank(lucas.userId, SOULSLIKE)).toBe(lucas.rank);
  });
});
