import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import ownedGames from "@/lib/integrations/steam/__fixtures__/owned-games.json";

// Reads the seeded database (lucas's library, see prisma/seed.ts); skipped when unreachable.
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

describe.skipIf(!reachable)("library queries (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  async function lucasId() {
    const { prisma } = await import("@/lib/db");
    return (await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } })).id;
  }

  it("getUserLibrary merges platforms, keeps never-played games and sorts by playtime", async () => {
    const { getUserLibrary } = await import("./queries");
    const library = await getUserLibrary(await lucasId());
    const hk = library.find((g) => g.slug === "hollow-knight")!;
    expect(hk.platforms.map((p) => p.platform)).toEqual(["steam", "psn", "xbox"]);
    expect(hk.platforms[0]).toMatchObject({ playtimeMin: 3120, playtime2WeeksMin: 95, achievementTotal: 63 });
    expect(hk.playtimeMin).toBe(hk.platforms.reduce((s, p) => s + p.playtimeMin, 0));
    expect(hk.played).toBe(true);
    expect(hk.completionPct).toBeGreaterThan(0);

    const never = library.filter((g) => !g.played);
    expect(never.map((g) => g.name).sort()).toEqual(["Ecos de Ferro", "Lanterna do Farol", "Pomar Estelar"]);
    expect(never.every((g) => g.stub && g.playtimeMin === 0 && g.completionPct === null)).toBe(true);

    for (let i = 1; i < library.length; i++) {
      expect(library[i - 1].playtimeMin).toBeGreaterThanOrEqual(library[i].playtimeMin);
    }
  });

  it("getUserWishlist lists the Steam wishlist in the player's order", async () => {
    const { getUserWishlist } = await import("./queries");
    const wishlist = await getUserWishlist(await lucasId());
    expect(wishlist.map((w) => [w.name, w.priority])).toEqual([
      ["Cidadela de Vidro", 0],
      ["Rota dos Cometas", 1],
      ["Hades", 2],
    ]);
    expect(wishlist[0]).toMatchObject({ platform: "steam", stub: true, addedAt: expect.any(Date) });
  });

  it("getPlaytimeTotals adds up hours per platform and finds the most played game", async () => {
    const { getPlaytimeTotals } = await import("./queries");
    const totals = await getPlaytimeTotals(await lucasId());
    const steamMin = ownedGames.reduce((s, g) => s + g.playtimeMin, 0);
    expect(totals.byPlatform.steam).toBe(steamMin);
    expect(totals.totalMin).toBe(Object.values(totals.byPlatform).reduce((s, m) => s + m, 0));
    expect(totals.last2WeeksMin).toBe(95 + 240);
    expect(totals.gamesNeverPlayed).toBe(3);
    expect(totals.gamesOwned).toBe(totals.gamesPlayed + 3);
    expect(totals.mostPlayed?.slug).toBe("civilization-vi");
  });

  it("an empty library gives zeros", async () => {
    const { getPlaytimeTotals, getUserLibrary, getUserWishlist } = await import("./queries");
    expect(await getUserLibrary("nobody")).toEqual([]);
    expect(await getUserWishlist("nobody")).toEqual([]);
    expect(await getPlaytimeTotals("nobody")).toMatchObject({ totalMin: 0, gamesOwned: 0, mostPlayed: null });
  });
});
