import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { rarityTier } from "@/lib/engine/xp";

async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
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

describe.skipIf(!reachable)("profile queries (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  async function lucas() {
    const { prisma } = await import("@/lib/db");
    return prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
  }

  it("pages through every valid unlock without repeating, newest first", async () => {
    const { prisma } = await import("@/lib/db");
    const { listUserAchievements } = await import("./queries");
    const user = await lucas();
    const valid = await prisma.userAchievement.count({ where: { userId: user.id, suspicious: false } });
    expect(valid).toBeGreaterThan(10);

    const first = await listUserAchievements(user.id, {}, { perPage: 10 });
    expect(first.total).toBe(valid);
    const pages = Math.ceil(valid / 10);
    const all = [first, ...(await Promise.all(Array.from({ length: pages - 1 }, (_, i) => listUserAchievements(user.id, {}, { page: i + 2, perPage: 10 }))))];
    const ids = all.flatMap((p) => p.items.map((a) => a.id));
    expect(ids).toHaveLength(valid);
    expect(new Set(ids).size).toBe(valid);
    const dates = all.flatMap((p) => p.items.map((a) => a.unlockedAt!.getTime()));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    // A page past the end shows the last one.
    expect((await listUserAchievements(user.id, {}, { page: 999, perPage: 10 })).page).toBe(pages);
  });

  it("filters by rarity, platform and game; the rarest order puts the lowest percentage first", async () => {
    const { listUserAchievements, getRarestAchievements, getAchievementGameOptions } = await import("./queries");
    const user = await lucas();

    for (const tier of ["lendaria", "epica", "rara", "incomum", "comum"] as const) {
      const { items } = await listUserAchievements(user.id, { rarity: tier }, { perPage: 80 });
      expect(items.every((a) => rarityTier(a.globalPct ?? 50) === tier)).toBe(true);
    }
    const tiers = await Promise.all(
      (["lendaria", "epica", "rara", "incomum", "comum"] as const).map((rarity) => listUserAchievements(user.id, { rarity })),
    );
    expect(tiers.reduce((s, t) => s + t.total, 0)).toBe((await listUserAchievements(user.id, {})).total);

    const steam = await listUserAchievements(user.id, { platform: "steam" }, { perPage: 80 });
    expect(steam.items.every((a) => a.platform === "steam")).toBe(true);

    const games = await getAchievementGameOptions(user.id);
    expect(games.length).toBeGreaterThan(0);
    const one = await listUserAchievements(user.id, { game: games[0].slug }, { perPage: 80 });
    expect(one.total).toBe(games[0].unlocks);
    expect(one.items.every((a) => a.game.slug === games[0].slug)).toBe(true);

    const rare = await listUserAchievements(user.id, {}, { sort: "raras", perPage: 80 });
    const pcts = rare.items.filter((a) => a.globalPct !== null).map((a) => a.globalPct as number);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    const rarest = await getRarestAchievements(user.id, 3);
    expect(rarest.map((a) => a.id)).toEqual(rare.items.slice(0, 3).map((a) => a.id));
  });

  it("never shows suspicious unlocks", async () => {
    const { prisma } = await import("@/lib/db");
    const { listUserAchievements } = await import("./queries");
    const suspicious = await prisma.userAchievement.findFirst({ where: { suspicious: true }, select: { userId: true, achievementId: true } });
    if (!suspicious) return;
    const { items } = await listUserAchievements(suspicious.userId, {}, { perPage: 80 });
    expect(items.map((a) => a.id)).not.toContain(suspicious.achievementId);
  });

  it("summarizes hours, games and achievements", async () => {
    const { getProfileStats, getProfileSummary, listUserAchievements } = await import("./queries");
    const { getPlaytimeTotals } = await import("@/lib/library/queries");
    const user = await lucas();
    const [summary, stats, totals, all] = await Promise.all([
      getProfileSummary(user.id),
      getProfileStats(user.id),
      getPlaytimeTotals(user.id),
      listUserAchievements(user.id, {}),
    ]);
    expect(summary).toMatchObject({ handle: "lucas", playtimeMin: totals.totalMin, gamesCount: totals.gamesOwned });
    expect(stats.achievements).toBe(all.total);
    expect(stats.achievementsByPlatform.reduce((s, r) => s + r.count, 0)).toBe(all.total);
    expect(stats.achievementsByYear.reduce((s, r) => s + r.count, 0)).toBe(all.total);
    expect(Object.values(stats.rarityCounts).reduce((s, n) => s + n, 0)).toBe(all.total);
    expect(stats.averageCompletion).not.toBeNull();
    expect(stats.averageCompletion!).toBeGreaterThanOrEqual(0);
    expect(stats.averageCompletion!).toBeLessThanOrEqual(100);
    expect(await getProfileSummary("nobody")).toBeNull();
  });

  it("an unlock of unknown date is listed last in every order and counts, but is in no year", async () => {
    const { prisma } = await import("@/lib/db");
    const { getProfileStats, listUserAchievements } = await import("./queries");
    const slug = "test-profile-undated";
    await prisma.user.deleteMany({ where: { handle: "test_profile_undated" } });
    await prisma.game.deleteMany({ where: { slug } });
    const user = await prisma.user.create({ data: { handle: "test_profile_undated", displayName: "Undated" } });
    const game = await prisma.game.create({
      data: {
        slug,
        name: "Undated",
        achievementCount: 3,
        platforms: ["PC"],
        achievements: { create: ["A", "B", "C"].map((apiName) => ({ apiName, name: apiName, globalPct: 30 })) },
      },
      include: { achievements: { orderBy: { apiName: "asc" } } },
    });
    const [a, b, c] = game.achievements;
    await prisma.userAchievement.createMany({
      data: [
        { userId: user.id, achievementId: a.id, unlockedAt: new Date("2020-01-01T12:00:00Z") },
        { userId: user.id, achievementId: b.id, unlockedAt: null },
        { userId: user.id, achievementId: c.id, unlockedAt: new Date("2024-01-01T12:00:00Z") },
      ],
    });
    try {
      for (const sort of ["recentes", "antigas", "raras"] as const) {
        const { items, total } = await listUserAchievements(user.id, {}, { sort });
        expect(total).toBe(3);
        expect(items.at(-1)).toMatchObject({ name: "B", unlockedAt: null });
      }
      const stats = await getProfileStats(user.id);
      expect(stats.achievements).toBe(3);
      expect(stats.achievementsByYear).toEqual([
        { year: 2020, count: 1 },
        { year: 2024, count: 1 },
      ]);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.game.delete({ where: { id: game.id } });
    }
  });
});
