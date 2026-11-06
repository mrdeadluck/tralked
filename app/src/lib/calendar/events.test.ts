import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

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

// March 2039: nothing of the seed's lands there.
const MONTH = { year: 2039, month: 3 };
const at = (iso: string) => new Date(iso);

describe.skipIf(!reachable)("calendar events", () => {
  let userId = "";
  let gameId = "";

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: "cal_test_player" } });
    await prisma.article.deleteMany({ where: { slug: { startsWith: "cal-test-" } } });
    await prisma.game.deleteMany({ where: { slug: { startsWith: "cal-test-" } } });
  }

  beforeAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    const author = await prisma.author.findFirstOrThrow();
    const user = await prisma.user.create({ data: { handle: "cal_test_player", displayName: "Cal" } });
    userId = user.id;
    const { createAchievements } = await import("@/lib/trophies/test-lists");
    const game = await prisma.game.create({
      data: {
        slug: "cal-test-jogo",
        name: "Cal Test Jogo",
        platforms: ["PC", "PLAYSTATION"],
        achievementCount: 3,
        releaseDate: at("2039-03-20T00:00:00Z"),
      },
    });
    const achievements = await createAchievements(game.id, [
      { apiName: "A", name: "Comum", globalPct: 60 },
      { apiName: "B", name: "Rara", globalPct: 2.5 },
      { apiName: "C", name: "Fraude", globalPct: 1 },
    ]);
    gameId = game.id;
    const byName = new Map(achievements.map((a) => [a.name, a.id]));
    await prisma.userAchievement.createMany({
      data: [
        // 01:30 UTC on Mar 6 is still Mar 5 in Brasília.
        { userId, achievementId: byName.get("Comum")!, unlockedAt: at("2039-03-06T01:30:00Z") },
        { userId, achievementId: byName.get("Rara")!, unlockedAt: at("2039-03-05T20:00:00Z") },
        { userId, achievementId: byName.get("Fraude")!, unlockedAt: at("2039-03-05T21:00:00Z"), fraudReview: "confirmed" },
      ],
    });
    await prisma.xpLedgerEntry.createMany({
      data: [
        { userId, source: "playtime", sourceKey: `steam:${gameId}:10`, xp: 4000, skills: [], createdAt: at("2039-03-10T15:00:00Z") },
        { userId, source: "playtime", sourceKey: `psn:${gameId}:25`, xp: 9000, skills: [], createdAt: at("2039-03-11T15:00:00Z"), voidedAt: at("2039-03-12T00:00:00Z") },
        { userId, source: "achievement", sourceKey: "x", xp: 100, skills: [], createdAt: at("2039-03-10T15:00:00Z") },
      ],
    });
    await prisma.mission.create({
      data: { userId, kind: "daily", periodKey: "2039-03-14", title: "Desbloqueie 1 conquista", condition: {}, rewardXp: 300, completedAt: at("2039-03-14T12:00:00Z") },
    });
    await prisma.article.createMany({
      data: [
        { slug: "cal-test-publicada", title: "Cal Test Publicada", body: "", category: "GAMES", imageLabel: "x", authorId: author.id, status: "published", publishedAt: at("2039-03-01T02:00:00Z") },
        { slug: "cal-test-rascunho", title: "Cal Test Rascunho", body: "", category: "GAMES", imageLabel: "x", authorId: author.id, status: "draft", publishedAt: at("2039-03-02T12:00:00Z") },
      ],
    });
    await prisma.gameRelease.create({
      data: { gameId, platform: "PLAYSTATION", date: at("2039-03-22T00:00:00Z"), source: "igdb", score: 5, seenAt: new Date() },
    });
  });
  afterAll(cleanup);

  it("public month: published articles on their Brasília day and releases", async () => {
    const { getPublicMonth } = await import("./events");
    const events = await getPublicMonth(MONTH);
    const mine = events.filter((e) => e.title.startsWith("Cal Test"));
    // 02:00 UTC on Mar 1 is Feb 28 in Brasília: outside March.
    expect(mine.filter((e) => e.kind === "article")).toEqual([]);
    // The GameRelease row wins over the catalog date (one entry per game).
    expect(mine.filter((e) => e.kind === "release")).toEqual([
      expect.objectContaining({ day: "2039-03-22", title: "Cal Test Jogo", detail: "PlayStation", href: "/jogos/cal-test-jogo" }),
    ]);
    const feb = await getPublicMonth({ year: 2039, month: 2 });
    expect(feb.filter((e) => e.title === "Cal Test Publicada")).toEqual([
      expect.objectContaining({ kind: "article", day: "2039-02-28", href: "/noticias/cal-test-publicada", detail: "Games" }),
    ]);
  });

  it("personal month: unlocks per game and day, hours milestones and missions; fraud and voided left out", async () => {
    const { getPersonalMonth, byDay } = await import("./events");
    const events = await getPersonalMonth(userId, MONTH);
    const days = byDay(events);
    expect(days.get("2039-03-05")).toEqual([
      expect.objectContaining({ kind: "unlock", title: "2 conquistas em Cal Test Jogo", detail: "Mais rara: Rara (2,5%)" }),
    ]);
    expect(days.get("2039-03-10")).toEqual([
      expect.objectContaining({ kind: "playtime", title: "10 h em Cal Test Jogo", detail: "Steam · +4.000 XP" }),
    ]);
    expect(days.has("2039-03-11")).toBe(false);
    expect(days.get("2039-03-14")).toEqual([expect.objectContaining({ kind: "mission", title: "Desbloqueie 1 conquista" })]);
    expect(await getPersonalMonth(userId, { year: 2039, month: 4 })).toEqual([]);
  });
});
