import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { isAlmostComplete } from "./games";

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

describe("isAlmostComplete", () => {
  it("accepts 70% up to (but excluding) 100%", () => {
    expect(isAlmostComplete(70, 100)).toBe(true);
    expect(isAlmostComplete(99, 100)).toBe(true);
    expect(isAlmostComplete(69, 100)).toBe(false);
    expect(isAlmostComplete(100, 100)).toBe(false);
  });

  it("is false for games without achievements", () => {
    expect(isAlmostComplete(0, 0)).toBe(false);
  });
});

const reachable = await databaseReachable();

describe.skipIf(!reachable)("listGames (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("returns only games between 70% and 100% for { almost: true }", async () => {
    const { prisma } = await import("@/lib/db");
    const { listGames } = await import("./games");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });

    const cards = await listGames({ almost: true }, lucas.id);

    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.unlockedCount).not.toBeNull();
      const ratio = (card.unlockedCount as number) / card.achievementCount;
      expect(ratio).toBeGreaterThanOrEqual(0.7);
      expect(ratio).toBeLessThan(1);
    }

    // Cross-check against the raw rows: nothing eligible is missing.
    const rows = await prisma.userGame.findMany({
      where: { userId: lucas.id },
      include: { game: true },
    });
    const expected = rows
      .filter(
        (r) =>
          r.unlockedCount / r.game.achievementCount >= 0.7 &&
          r.unlockedCount < r.game.achievementCount,
      )
      .map((r) => r.game.slug)
      .sort();
    expect(cards.map((c) => c.slug).sort()).toEqual(expected);
  });

  it("returns nothing for { almost: true } without a user", async () => {
    const { listGames } = await import("./games");
    expect(await listGames({ almost: true })).toEqual([]);
  });

  it("lists the whole catalog without filters, with no progress for anonymous visitors", async () => {
    const { listGames } = await import("./games");
    const cards = await listGames({});
    expect(cards).toHaveLength(14);
    expect(cards.every((c) => c.unlockedCount === null)).toBe(true);
  });

  it("filters by published guide, skill, platform and name", async () => {
    const { listGames } = await import("./games");

    const withGuide = await listGames({ withGuide: true });
    expect(withGuide.map((c) => c.slug)).toEqual(["hollow-knight"]);

    const soulslike = await listGames({ skill: "soulslike" });
    expect(soulslike.length).toBeGreaterThan(0);
    expect(soulslike.every((c) => c.skills.includes("soulslike"))).toBe(true);

    const pc = await listGames({ platform: "PC" });
    expect(pc.every((c) => c.platforms.includes("PC"))).toBe(true);

    const byName = await listGames({ q: "hollow" });
    expect(byName.map((c) => c.slug)).toEqual(["hollow-knight"]);
  });
});
