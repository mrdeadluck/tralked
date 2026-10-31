import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { levelFromXp } from "@/lib/engine/xp";
import { env } from "@/lib/env";

// Needs Postgres up and seeded (see db.test.ts); skipped when unreachable.
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

const STEAM_PREFIX = "test-recompute-";
const APP_ID = 97000001;
const NOW = new Date("2026-10-31T15:00:00Z"); // Saturday, ISO week 2026-W44
const HOUR = 3_600_000;

describe.skipIf(!reachable)("recomputeUser", () => {
  let counter = 0;
  let achievementIds: string[] = [];

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { steamId: { startsWith: STEAM_PREFIX } } });
    await prisma.game.deleteMany({ where: { steamAppId: APP_ID } });
  }

  async function newUser() {
    const { prisma } = await import("@/lib/db");
    counter++;
    return prisma.user.create({
      data: {
        steamId: `${STEAM_PREFIX}${counter}`,
        handle: `test_recompute_${counter}`,
        displayName: "Test",
      },
    });
  }

  async function unlock(
    userId: string,
    index: number,
    unlockedAt: Date,
    suspicious = false,
  ) {
    const { prisma } = await import("@/lib/db");
    await prisma.userAchievement.create({
      data: { userId, achievementId: achievementIds[index], unlockedAt, suspicious },
    });
  }

  beforeAll(async () => {
    const { prisma } = await import("@/lib/db");
    await cleanup();
    const game = await prisma.game.create({
      data: {
        slug: "test-recompute-game",
        name: "Test recompute game",
        steamAppId: APP_ID,
        achievementCount: 8,
        platforms: ["PC"],
        skills: { create: [{ skill: "rpg" }] },
        achievements: {
          create: Array.from({ length: 8 }, (_, i) => ({
            apiName: `ACH_${i}`,
            name: `Achievement ${i}`,
            globalPct: i < 6 ? 5 : 60, // 6 rare (<= 20%), 2 common
          })),
        },
      },
      include: { achievements: true },
    });
    achievementIds = game.achievements
      .sort((a, b) => a.apiName.localeCompare(b.apiName))
      .map((a) => a.id);
  });

  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("reproduces lucas's level and skills from a copy of his ledger", async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("./recompute");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: lucas.id } });
    const lucasSkills = await prisma.skillProgress.findMany({ where: { userId: lucas.id } });
    const lucasStats = await prisma.userStats.findUniqueOrThrow({ where: { userId: lucas.id } });

    const copy = await newUser();
    await prisma.xpLedgerEntry.createMany({
      data: ledger.map((e) => ({
        userId: copy.id,
        source: e.source,
        sourceKey: e.sourceKey,
        xp: e.xp,
        skills: e.skills,
        skillPoints: e.skillPoints ?? undefined,
        createdAt: e.createdAt,
      })),
    });

    await recomputeUser(copy.id, NOW);

    const skills = await prisma.skillProgress.findMany({ where: { userId: copy.id } });
    expect(skills).toHaveLength(11);
    const byName = (rows: { skill: string; level: number; points: number }[]) =>
      Object.fromEntries(rows.map((r) => [r.skill, { level: r.level, points: r.points }]));
    expect(byName(skills)).toEqual(byName(lucasSkills));

    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: copy.id } });
    expect(stats.level).toBe(47);
    expect(stats.totalXp).toBe(lucasStats.totalXp);
    expect(stats.vocation).toBe(lucasStats.vocation);
  });

  it("builds streak from non-suspicious unlock days (America/Sao_Paulo)", async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("./recompute");
    const user = await newUser();
    await unlock(user.id, 0, new Date(NOW.getTime() - 48 * HOUR + 1000));
    await unlock(user.id, 1, new Date(NOW.getTime() - 24 * HOUR + 1000));
    await unlock(user.id, 2, new Date(NOW.getTime() - 1000));
    // A suspicious unlock on an otherwise empty day must not count.
    await unlock(user.id, 3, new Date(NOW.getTime() - 96 * HOUR), true);

    await recomputeUser(user.id, NOW);

    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.streakCurrent).toBe(3);
    expect(stats.streakBest).toBe(3);
  });

  it("creates daily (3) and weekly (2) missions once per period", async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("./recompute");
    const user = await newUser();

    await recomputeUser(user.id, NOW);
    await recomputeUser(user.id, NOW);

    const missions = await prisma.mission.findMany({ where: { userId: user.id } });
    expect(missions.filter((m) => m.kind === "daily" && m.periodKey === "2026-10-31")).toHaveLength(3);
    expect(missions.filter((m) => m.kind === "weekly" && m.periodKey === "2026-W44")).toHaveLength(2);
    expect(missions.every((m) => m.progress === 0 && m.completedAt === null)).toBe(true);
  });

  it("completes missions from the period's valid unlocks and pays each once", async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("./recompute");
    const user = await newUser();
    // 6 rare unlocks today, 5 valid + 1 suspicious; 1 more yesterday (not part of today).
    for (let i = 0; i < 5; i++) await unlock(user.id, i, new Date(NOW.getTime() - (i + 1) * 60_000 * 30));
    await unlock(user.id, 5, new Date(NOW.getTime() - 60_000), true);
    await unlock(user.id, 6, new Date(NOW.getTime() - 30 * HOUR));

    await recomputeUser(user.id, NOW);
    await recomputeUser(user.id, NOW);

    const daily = await prisma.mission.findMany({
      where: { userId: user.id, kind: "daily", periodKey: "2026-10-31" },
    });
    const rare = daily.find((m) => m.title === "Desbloqueie 3 conquistas raras")!;
    const five = daily.find((m) => m.title === "Desbloqueie 5 conquistas")!;
    expect(rare.progress).toBe(3); // capped at the goal; 5 valid rare unlocks today
    expect(rare.completedAt).not.toBeNull();
    expect(five.progress).toBe(5); // suspicious and yesterday's unlocks excluded
    expect(five.completedAt).not.toBeNull();

    const entries = await prisma.xpLedgerEntry.findMany({
      where: { userId: user.id, source: "mission" },
    });
    const completed = [...daily, ...(await prisma.mission.findMany({
      where: { userId: user.id, kind: "weekly" },
    }))].filter((m) => m.completedAt !== null);
    expect(entries).toHaveLength(completed.length);
    expect(new Set(entries.map((e) => e.sourceKey))).toEqual(new Set(completed.map((m) => m.id)));
    const rewardOf = (id: string) => completed.find((m) => m.id === id)!.rewardXp;
    for (const entry of entries) expect(entry.xp).toBe(rewardOf(entry.sourceKey));

    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(entries.reduce((sum, e) => sum + e.xp, 0));
  });

  it("rebuilds skills from achievement ledger entries and picks the vocation", async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("./recompute");
    const user = await newUser();
    await prisma.xpLedgerEntry.create({
      data: {
        userId: user.id,
        source: "achievement",
        sourceKey: achievementIds[0],
        xp: 12_000,
        skills: ["rpg"],
      },
    });

    await recomputeUser(user.id, NOW);

    const rpg = await prisma.skillProgress.findUniqueOrThrow({
      where: { userId_skill: { userId: user.id, skill: "rpg" } },
    });
    expect(rpg.level).toBeGreaterThan(1); // 12000 / 12 = 1000 points
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.vocation).toBe("Andarilho de RPG");
  });

  it("tops partially seeded periods up to 3 daily and 2 weekly missions", async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("./recompute");
    const user = await newUser();
    await prisma.mission.createMany({
      data: [
        { userId: user.id, kind: "daily", periodKey: "2026-10-31", title: "Custom daily", condition: { minCount: 1 }, rewardXp: 1000 },
        { userId: user.id, kind: "weekly", periodKey: "2026-W44", title: "Custom weekly", condition: { minCount: 1 }, rewardXp: 1000 },
      ],
    });

    await recomputeUser(user.id, NOW);
    await recomputeUser(user.id, NOW);

    const missions = await prisma.mission.findMany({ where: { userId: user.id } });
    expect(missions.filter((m) => m.kind === "daily")).toHaveLength(3);
    expect(missions.filter((m) => m.kind === "weekly")).toHaveLength(2);
    expect(missions.some((m) => m.title === "Custom daily")).toBe(true);
    expect(missions.some((m) => m.title === "Custom weekly")).toBe(true);
  });

  it("leaves voided ledger entries out of XP, level and skills", async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("./recompute");
    const user = await newUser();
    await prisma.xpLedgerEntry.createMany({
      data: [
        { userId: user.id, source: "achievement", sourceKey: achievementIds[0], xp: 1_000, skills: ["rpg"] },
        { userId: user.id, source: "achievement", sourceKey: achievementIds[1], xp: 50_000, skills: ["rpg"], voidedAt: NOW },
      ],
    });

    await recomputeUser(user.id, NOW);

    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(1_000);
    expect(stats.level).toBe(levelFromXp(1_000).level);
    expect(stats.level).toBeLessThan(levelFromXp(51_000).level);
    const rpg = await prisma.skillProgress.findUniqueOrThrow({
      where: { userId_skill: { userId: user.id, skill: "rpg" } },
    });
    expect(rpg).toMatchObject({ level: 1, points: 83 }); // round(1000 / 12)
  });

  it("writes the 7 attributes from library, unlocks and streak", async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("./recompute");
    const user = await newUser();
    const game = await prisma.achievement.findUniqueOrThrow({ where: { id: achievementIds[0] } });
    await prisma.userGame.create({
      data: { userId: user.id, gameId: game.gameId, platform: "steam", playtimeMin: 600, unlockedCount: 2 },
    });
    await unlock(user.id, 0, new Date(NOW.getTime() - HOUR)); // 5%: gold, rare
    await unlock(user.id, 6, new Date(NOW.getTime() - 25 * HOUR)); // 60%: bronze
    await unlock(user.id, 7, new Date(NOW.getTime() - 2 * HOUR), true); // suspicious: ignored

    await recomputeUser(user.id, NOW);

    const rows = await prisma.attributeProgress.findMany({ where: { userId: user.id } });
    const byId = Object.fromEntries(rows.map((r) => [r.attribute, { points: r.points, level: r.level }]));
    expect(byId).toEqual({
      vigor: { points: 138, level: 3 }, // round(40 * log2(1 + 10h))
      precisao: { points: 30, level: 2 }, // one unlock at <= 5%
      gloria: { points: 60, level: 2 }, // (gold 5 + bronze 1) x 10
      colecao: { points: 0, level: 1 },
      exploracao: { points: 80, level: 2 }, // 1 game with unlocks (20) + 1 genre, rpg (60)
      constancia: { points: 40, level: 2 }, // 2 active days (30) + best streak 2 (10)
      sabedoria: { points: 0, level: 1 },
    });
  });

  it("keeps lucas's seeded missions complete (3 daily + 2 weekly, ISO week key)", async () => {
    const { prisma } = await import("@/lib/db");
    const missions = await prisma.mission.findMany({ where: { user: { handle: "lucas" } } });
    expect(missions.filter((m) => m.kind === "daily")).toHaveLength(3);
    const weekly = missions.filter((m) => m.kind === "weekly");
    expect(weekly).toHaveLength(2);
    expect(weekly.every((m) => /^\d{4}-W\d{2}$/.test(m.periodKey))).toBe(true);
  });
});
