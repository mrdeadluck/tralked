import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// Needs Postgres up and seeded (`pnpm db:up && pnpm db:migrate && pnpm db:seed`);
// skipped when the database is not reachable.
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

describe.skipIf(!reachable)("news queries (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("getHomeNews returns the main highlight, 4 side highlights and the latest list", async () => {
    const { getHomeNews } = await import("./news");
    const { hero, side, latest } = await getHomeNews();
    expect(hero.featured).toBe(2);
    expect(side).toHaveLength(4);
    expect(side.every((a) => a.featured === 1)).toBe(true);
    expect(latest.length).toBeGreaterThan(0);
    expect(latest.every((a) => a.featured === 0)).toBe(true);
    const times = latest.map((a) => a.publishedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("getArticle returns the article with author, or null for an unknown slug", async () => {
    const { getArticle } = await import("./news");
    const article = await getArticle("25-conquistas-mais-raras-da-steam-em-2026");
    expect(article?.authorHandle).toBe("Fuyushiro");
    expect(article?.body.length).toBeGreaterThan(0);
    expect(await getArticle("nao-existe")).toBeNull();
  });

  it("getArticle exposes the related game and whether it has a published guide", async () => {
    const { prisma } = await import("@/lib/db");
    const { getArticle } = await import("./news");
    const withGame = await prisma.article.findFirstOrThrow({ where: { gameId: { not: null } } });
    const article = await getArticle(withGame.slug);
    expect(article?.game?.slug).toBeTruthy();
    expect(typeof article?.game?.hasGuide).toBe("boolean");
  });

  it("getTopPlayers returns public profiles ordered by total XP", async () => {
    const { getTopPlayers } = await import("./news");
    const players = await getTopPlayers(5);
    expect(players).toHaveLength(5);
    const xp = players.map((p) => p.totalXp);
    expect(xp).toEqual([...xp].sort((a, b) => b - a));
    expect(players[0]).toEqual(
      expect.objectContaining({ handle: expect.any(String), level: expect.any(Number) }),
    );
    expect(players[0].handle.startsWith("@")).toBe(false);
  });

  it("getTodayMission returns the user's daily mission for today, or null", async () => {
    const { prisma } = await import("@/lib/db");
    const { getTodayMission } = await import("./news");
    const { toLocalDay } = await import("@/lib/engine/streak");
    const now = new Date();
    const user = await prisma.user.create({
      data: { steamId: "test-news-mission", handle: "test-news-mission", displayName: "Test" },
    });
    try {
      expect(await getTodayMission(user.id, now)).toBeNull();
      await prisma.mission.createMany({
        data: [
          { userId: user.id, kind: "weekly", periodKey: toLocalDay(now), title: "W", condition: { minCount: 9 }, rewardXp: 1 },
          { userId: user.id, kind: "daily", periodKey: "2000-01-01", title: "Old", condition: { minCount: 9 }, rewardXp: 1 },
          { userId: user.id, kind: "daily", periodKey: toLocalDay(now), title: "Hoje", condition: { minCount: 3 }, rewardXp: 12000, progress: 1 },
        ],
      });
      expect(await getTodayMission(user.id, now)).toEqual({
        title: "Hoje",
        progress: 1,
        goal: 3,
        rewardXp: 12000,
      });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
