import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import type { PsnTrophy } from "@/lib/integrations/psn/types";

// Needs Postgres up and migrated (see db.test.ts); skipped when unreachable. No Sony call is made:
// the list-definitions call is a stub.
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
const LIST = "NPWR98001_00";
const OTHER = "NPWR98002_00";
const SLUG = "zzpsnopen-game";
const HANDLE = "test_psnopen";
const ACCOUNT = "9000000000000000002"; // the PSN fixture's public test account

const trophy = (id: number, tier: PsnTrophy["tier"], over: Partial<PsnTrophy> = {}): PsnTrophy => ({
  trophyId: String(id),
  name: `Troféu ${id}`,
  description: `Faça ${id}`,
  iconUrl: `https://image.api.playstation.com/trophy/np/${LIST}_00AA${id}.PNG`,
  hidden: false,
  tier,
  earned: false,
  earnedAt: null,
  rarityPct: null,
  ...over,
});
const DEFINITIONS = [trophy(0, "platinum"), trophy(1, "gold"), trophy(2, "bronze")];
// What the catalog says of the list: 1 platinum, 1 gold, 1 bronze.
const COUNTS: [number, number, number, number] = [1, 0, 1, 1];

function fakeApi(answer: () => Promise<PsnTrophy[] | null> = async () => DEFINITIONS) {
  const calls: string[] = [];
  return {
    calls,
    async getListTrophies(npTitleId: string) {
      calls.push(npTitleId);
      // Icons name the list asked, as Sony's do.
      return (await answer())?.map((t) => ({ ...t, iconUrl: t.iconUrl?.replace(LIST, npTitleId) ?? null })) ?? null;
    },
  };
}

describe.skipIf(!reachable)("PSN trophies read when the page opens", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE } } });
    await prisma.game.deleteMany({ where: { slug: { startsWith: SLUG } } });
    await prisma.psnCatalogList.deleteMany({ where: { id: { in: [LIST, OTHER] } } });
  }

  /** A game with the catalog lists (as matchPsnCatalog leaves them: TrophyList without trophies, plus the link). */
  async function seed(ids: string[] = [LIST]) {
    const { prisma } = await import("@/lib/db");
    const { ensureTrophyList } = await import("@/lib/trophies/lists");
    const game = await prisma.game.create({ data: { slug: SLUG, name: "Zz Psn Open", platforms: ["PLAYSTATION"], achievementCount: 0 } });
    const [bronze, silver, gold, platinum] = COUNTS;
    for (const id of ids) {
      await prisma.psnCatalogList.create({
        data: { id, name: "Zz Psn Open", console: "PS5", serviceName: "trophy2", trophyCount: 3, tiers: { bronze, silver, gold, platinum }, matchedAt: new Date() },
      });
      await ensureTrophyList(prisma, { gameId: game.id, platform: "psn", externalId: id, console: "PS5", name: "Zz Psn Open", serviceName: "trophy2", trophyCount: 3 });
      await prisma.gamePlatformLink.create({ data: { gameId: game.id, platform: "psn", externalId: id } });
    }
    return game;
  }

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("first open reads the definitions once", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const api = fakeApi();

    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("loaded");
    expect(api.calls).toEqual([LIST]);
    const list = await prisma.trophyList.findUniqueOrThrow({ where: { platform_externalId: { platform: "psn", externalId: LIST } } });
    const rows = await prisma.achievement.findMany({ where: { listId: list.id }, orderBy: { apiName: "asc" } });
    expect(rows.map((r) => [r.apiName, r.trophyTier, r.gameId, r.platform, r.globalPct])).toEqual([
      ["0", "platinum", game.id, "psn", null],
      ["1", "gold", game.id, "psn", null],
      ["2", "bronze", game.id, "psn", null],
    ]);
    expect(rows[0]).toMatchObject({ name: "Troféu 0", description: "Faça 0", hidden: false });
    expect((await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: LIST } })).trophiesSyncedAt).not.toBeNull();

    // The next open finds it read: no call, nothing new.
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("none");
    expect(api.calls).toHaveLength(1);
    expect(await prisma.achievement.count({ where: { listId: list.id } })).toBe(3);
  });

  it("concurrent opens read once", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const api = fakeApi(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return DEFINITIONS;
    });

    const results = await Promise.all(Array.from({ length: 5 }, () => loadPsnCatalogTrophies(game.id, api)));
    expect(api.calls).toHaveLength(1);
    expect(results.filter((r) => r === "loaded")).toHaveLength(1);
    expect(await prisma.achievement.count({ where: { gameId: game.id } })).toBe(3);
  });

  it("a later player sync fills the same list without duplicating rows", async () => {
    const { prisma } = await import("@/lib/db");
    const { getPsn } = await import("@/lib/integrations");
    const { syncPlatformAccount } = await import("./platform-user");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    await loadPsnCatalogTrophies(game.id, fakeApi());
    const before = await prisma.achievement.findMany({ where: { gameId: game.id }, orderBy: { apiName: "asc" } });

    const psn = getPsn();
    const earnedAt = new Date("2026-03-01T20:00:00Z");
    const titles = vi.spyOn(psn, "getTitles").mockResolvedValue([
      {
        npTitleId: LIST,
        serviceName: "trophy2",
        name: "Zz Psn Open",
        platform: "PS5",
        progress: 33,
        trophyCounts: { bronze: 1, silver: 0, gold: 1, platinum: 1 },
        earnedCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 },
        lastPlayed: earnedAt,
      },
    ]);
    const trophies = vi.spyOn(psn, "getTrophies").mockResolvedValue(
      DEFINITIONS.map((t) => ({ ...t, earned: t.trophyId === "2", earnedAt: t.trophyId === "2" ? earnedAt : null, rarityPct: 40 })),
    );
    const played = vi.spyOn(psn, "getPlayedGames").mockResolvedValue([]);
    try {
      await prisma.linkedAccount.deleteMany({ where: { platform: "psn", externalId: ACCOUNT, user: { handle: { startsWith: "test_" } } } });
      const user = await prisma.user.create({
        data: {
          handle: `${HANDLE}_1`,
          displayName: "Teste",
          linkedAccounts: { create: { platform: "psn", externalId: ACCOUNT, handle: "Tralked-Teste", verifiedAt: new Date() } },
        },
      });
      expect((await syncPlatformAccount(user.id, "psn")).newUnlocks).toBe(1);

      const after = await prisma.achievement.findMany({ where: { gameId: game.id }, orderBy: { apiName: "asc" } });
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id)); // same rows, none added
      expect(after.every((r) => r.globalPct === 40)).toBe(true); // the player's read adds the rarity
      expect(await prisma.trophyList.count({ where: { gameId: game.id } })).toBe(1);
      expect(await prisma.userTrophyList.count({ where: { userId: user.id, list: { gameId: game.id } } })).toBe(1);
    } finally {
      titles.mockRestore();
      trophies.mockRestore();
      played.mockRestore();
    }
  });

  it("reads one list per call", async () => {
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed([LIST, OTHER]);
    const api = fakeApi();
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("loaded");
    expect(api.calls).toEqual([LIST]);
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("loaded");
    expect(api.calls).toEqual([LIST, OTHER]);
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("none");
  });

  it("a Sony failure gives the claim back and writes nothing", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const boom = fakeApi(async () => {
        throw new Error("HTTP 429");
      });
      expect(await loadPsnCatalogTrophies(game.id, boom)).toBe("failed");
      expect(await loadPsnCatalogTrophies(game.id, fakeApi(async () => null))).toBe("failed");
    } finally {
      warn.mockRestore();
    }
    expect(await prisma.achievement.count({ where: { gameId: game.id } })).toBe(0);
    expect((await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: LIST } })).trophiesSyncedAt).toBeNull();
    // Try later: the next open reads it.
    expect(await loadPsnCatalogTrophies(game.id, fakeApi())).toBe("loaded");
  });

  it("refuses an answer that is not the list's", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Wrong counts (two bronze) and another list's icons.
      const counts = fakeApi(async () => [trophy(0, "platinum"), trophy(1, "bronze"), trophy(2, "bronze")]);
      expect(await loadPsnCatalogTrophies(game.id, counts)).toBe("failed");
      const foreign = DEFINITIONS.map((t) => ({ ...t, iconUrl: "https://image.api.playstation.com/trophy/np/NPWR14350_00BB.PNG" }));
      expect(await loadPsnCatalogTrophies(game.id, fakeApi(async () => foreign))).toBe("failed");
    } finally {
      warn.mockRestore();
    }
    expect(await prisma.achievement.count({ where: { gameId: game.id } })).toBe(0);
  });

  it("leaves a list a player already filled alone", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const list = await prisma.trophyList.findUniqueOrThrow({ where: { platform_externalId: { platform: "psn", externalId: LIST } } });
    await prisma.achievement.create({ data: { gameId: game.id, platform: "psn", listId: list.id, apiName: "0", name: "x", trophyTier: "platinum" } });
    const api = fakeApi();
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("none");
    expect(api.calls).toEqual([]);
  });
});
