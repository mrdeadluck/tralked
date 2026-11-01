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

    const cards = (await listGames({ almost: true }, { perPage: 80 }, lucas.id)).items;

    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.unlockedCount).not.toBeNull();
      const ratio = (card.unlockedCount as number) / card.achievementCount;
      expect(ratio).toBeGreaterThanOrEqual(0.7);
      expect(ratio).toBeLessThan(1);
    }

    // Cross-check against the raw rows: nothing eligible is missing.
    const rows = await prisma.userGame.findMany({
      where: { userId: lucas.id, platform: "steam" },
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
    expect(await listGames({ almost: true })).toMatchObject({ items: [], total: 0 });
  });

  it("lists the whole catalog without filters (stubs left out), with no progress for anonymous visitors", async () => {
    const { listGames } = await import("./games");
    const { items, total, stubTotal } = await listGames({}, { perPage: 80 });
    expect(total).toBe(14);
    expect(items).toHaveLength(14);
    expect(stubTotal).toBe(0);
    expect(items.every((c) => c.unlockedCount === null && !c.stub)).toBe(true);
  });

  it("paginates with stable pages and clamps a page past the end", async () => {
    const { listGames } = await import("./games");
    const pages = await Promise.all([1, 2, 3].map((page) => listGames({}, { page, perPage: 5, sort: "nome" })));
    expect(pages.map((p) => p.items.length)).toEqual([5, 5, 4]);
    const slugs = pages.flatMap((p) => p.items.map((c) => c.slug));
    expect(new Set(slugs).size).toBe(14);
    expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b)));
    const past = await listGames({}, { page: 99, perPage: 5, sort: "nome" });
    expect(past.page).toBe(3);
    expect(past.items.map((c) => c.slug)).toEqual(pages[2].items.map((c) => c.slug));
  });

  it("filters by published guide, skill, platform and name", async () => {
    const { listGames } = await import("./games");

    const withGuide = (await listGames({ withGuide: true })).items;
    expect(withGuide.map((c) => c.slug)).toEqual(["hollow-knight"]);

    const soulslike = (await listGames({ skill: "soulslike" })).items;
    expect(soulslike.length).toBeGreaterThan(0);
    expect(soulslike.every((c) => c.skills.includes("soulslike"))).toBe(true);

    const pc = (await listGames({ platform: "PC" })).items;
    expect(pc.every((c) => c.platforms.includes("PC"))).toBe(true);

    const byName = (await listGames({ q: "hollow" })).items;
    expect(byName.map((c) => c.slug)).toEqual(["hollow-knight"]);
  });

  it("searches names ignoring accents, case and punctuation, stubs included after the games with details", async () => {
    const { prisma } = await import("@/lib/db");
    const { listGames } = await import("./games");

    expect((await listGames({ q: "BALDURS gate" })).items.map((c) => c.slug)).toEqual(["baldurs-gate-3"]);

    // Seeded stubs: "Lanterna do Farol" (only a search finds it), marked as a stub.
    const lantern = await listGames({ q: "lantérna" });
    expect(lantern.items.map((c) => [c.slug, c.stub])).toEqual([["lanterna-do-farol", true]]);
    expect(lantern.stubTotal).toBe(1);

    const tag = `srch${Date.now().toString(36)}`;
    try {
      await prisma.game.createMany({
        data: [
          { slug: `${tag}-stub`, name: `Ação ${tag} Stub`, platforms: ["PC"], achievementCount: 0, stub: true },
          { slug: `${tag}-full`, name: `Zação ${tag} Completo`, platforms: ["PC"], achievementCount: 0 },
        ],
      });
      const found = await listGames({ q: `acao ${tag.toUpperCase()}` }, { sort: "nome" });
      // "Ação" sorts before "Zação" by name, but the game with details comes first.
      expect(found.items.map((c) => c.slug)).toEqual([`${tag}-full`, `${tag}-stub`]);
      expect(found).toMatchObject({ total: 2, stubTotal: 1 });
      // Without a search the stub stays out.
      expect((await listGames({}, { perPage: 80 })).items.map((c) => c.slug)).not.toContain(`${tag}-stub`);
    } finally {
      await prisma.game.deleteMany({ where: { slug: { startsWith: tag } } });
    }
  });
});
