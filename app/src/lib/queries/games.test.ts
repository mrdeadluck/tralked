import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { isAlmostComplete, isRealAccount, realRevisions } from "./games";

describe("guide revisions shown to readers", () => {
  type Account = { email: string | null; googleSub: string | null; passwordHash: string | null };
  const person: Account = { email: "a@b.com", googleSub: null, passwordHash: null };
  const seeded: Account = { email: null, googleSub: null, passwordHash: null };
  const guideCreated = new Date("2026-10-20T00:00:00Z");
  const rev = (id: string, createdAt: string, author: Account | null) => ({ id, createdAt: new Date(createdAt), author });

  it("keeps only revisions by real accounts, not older than the guide, newest first", () => {
    expect(isRealAccount(person)).toBe(true);
    expect(isRealAccount({ ...seeded, googleSub: "g" })).toBe(true);
    expect(isRealAccount(seeded)).toBe(false);
    expect(isRealAccount(null)).toBe(false);
    const list = [
      rev("seed-old", "2025-10-20T00:00:00Z", seeded), // "v1.0, há 1 ano" of a seeded history
      rev("backdated", "2026-10-01T00:00:00Z", person), // before the guide existed
      rev("a", "2026-10-25T00:00:00Z", person),
      rev("b", "2026-10-30T00:00:00Z", person),
      rev("orphan", "2026-10-31T00:00:00Z", null),
    ];
    expect(realRevisions(list, guideCreated).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

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

  it("lists the whole catalog without filters (games with details first, then stubs), with no progress for anonymous visitors", async () => {
    const { prisma } = await import("@/lib/db");
    const { listGames } = await import("./games");
    const [all, stubs] = await Promise.all([prisma.game.count(), prisma.game.count({ where: { stub: true } })]);
    const { items, total, stubTotal } = await listGames({}, { perPage: 80 });
    expect(total).toBe(all);
    expect(items).toHaveLength(Math.min(all, 80));
    expect(stubTotal).toBe(stubs);
    const firstStub = items.findIndex((c) => c.stub);
    expect(items.slice(firstStub).every((c) => c.stub)).toBe(true);
    expect(items.every((c) => c.unlockedCount === null)).toBe(true);
  });

  it("gives games still without details the Steam store header as cover", async () => {
    const { prisma } = await import("@/lib/db");
    const { listGames } = await import("./games");
    const stub = await prisma.game.findFirst({ where: { stub: true, steamAppId: { not: null }, coverUrl: null } });
    if (!stub) return;
    const card = (await listGames({}, { perPage: 80 })).items.find((c) => c.slug === stub.slug);
    expect(card?.coverUrl).toBe(
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${stub.steamAppId}/header.jpg`,
    );
  });

  it("paginates with stable pages and clamps a page past the end", async () => {
    const { listGames } = await import("./games");
    const { prisma } = await import("@/lib/db");
    const all = await prisma.game.count();
    const last = Math.ceil(all / 5);
    const pages = await Promise.all(
      Array.from({ length: last }, (_, i) => listGames({}, { page: i + 1, perPage: 5, sort: "nome" })),
    );
    const items = pages.flatMap((p) => p.items);
    expect(items).toHaveLength(all);
    expect(new Set(items.map((c) => c.slug)).size).toBe(all);
    // Games with details first (by name), then the stubs (by name).
    const named = (list: typeof items) => list.map((c) => c.name);
    const full = items.filter((c) => !c.stub);
    const stubs = items.filter((c) => c.stub);
    expect(items).toEqual([...full, ...stubs]);
    expect(named(full)).toEqual([...named(full)].sort((a, b) => a.localeCompare(b)));
    const past = await listGames({}, { page: 99, perPage: 5, sort: "nome" });
    expect(past.page).toBe(last);
    expect(past.items.map((c) => c.slug)).toEqual(pages[last - 1].items.map((c) => c.slug));
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

    // 1–2 characters have no trigram for the index: stubs are left out.
    const short = await listGames({ q: "lá" }, { perPage: 80 });
    expect(short.stubTotal).toBe(0);
    expect(short.items.length).toBeGreaterThan(0);
    expect(short.items.some((c) => c.stub)).toBe(false);
    expect((await listGames({ q: "lan" })).items.map((c) => c.slug)).toContain("lanterna-do-farol");

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
      // Without a search the stub is listed too, after the games with details.
      const all = (await listGames({}, { perPage: 80 })).items.map((c) => c.slug);
      expect(all.indexOf(`${tag}-stub`)).toBeGreaterThan(all.indexOf(`${tag}-full`));
    } finally {
      await prisma.game.deleteMany({ where: { slug: { startsWith: tag } } });
    }
  });
});
