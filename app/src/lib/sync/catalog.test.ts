import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SteamApi } from "@/lib/integrations";
import { env } from "@/lib/env";

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

const failingApp = 96000001;
const healthyApp = 96000002;
const steamState = vi.hoisted(() => ({ api: null as unknown as SteamApi }));
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  return {
    ...actual,
    getSteam: () => steamState.api,
    getIgdb: () => ({ findBySteamAppId: async () => null }),
    getRawg: () => ({ findBySteamAppId: async () => null }),
    getSgdb: () => ({ getArt: async () => ({}) }),
  };
});

describe.skipIf(!reachable)("catalog jobs", () => {
  const where = { steamAppId: { in: [failingApp, healthyApp] } };

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where });
  }

  beforeAll(async () => {
    const { prisma } = await import("@/lib/db");
    await cleanup();
    const { createAchievements } = await import("@/lib/trophies/test-lists");
    for (const appId of [failingApp, healthyApp]) {
      const game = await prisma.game.create({
        data: {
          slug: `test-catalog-${appId}`,
          name: `Catalog ${appId}`,
          steamAppId: appId,
          achievementCount: 1,
          platforms: ["PC"],
        },
      });
      await createAchievements(game.id, [{ apiName: "A0", name: "A0", globalPct: 10 }]);
    }
    // The healthy game was attempted long ago; the failing one never was (sorts first).
    await prisma.game.update({
      where: { steamAppId: healthyApp },
      data: { lastSyncAttemptAt: new Date("2020-01-01T00:00:00Z") },
    });
    steamState.api = {
      async getPlayerSummary() {
        throw new Error("unused");
      },
      async getOwnedGames() {
        return [];
      },
      async getSchemaForGame(appId) {
        if (appId === failingApp) throw new Error("Steam is down for this game");
        return [{ apiName: "A0", name: "A0", hidden: false }];
      },
      async getGlobalAchievementPercentages(appId) {
        if (appId === failingApp) throw new Error("Steam is down for this game");
        return { A0: 42 };
      },
      async getPlayerAchievements() {
        return [];
      },
      async getWishlist() {
        return [];
      },
      async getAppList() {
        return "unsupported";
      },
    };
  });

  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("does not let a failing game starve the catalog and rarity batches", async () => {
    const { prisma } = await import("@/lib/db");
    const { refreshRarity, syncCatalog } = await import("./catalog");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await syncCatalog(1, where)).toEqual({ processed: 0, failed: 1 });
    expect(await syncCatalog(1, where)).toEqual({ processed: 1, failed: 0 });
    errors.mockRestore();

    const failing = await prisma.game.findUniqueOrThrow({ where: { steamAppId: failingApp } });
    expect(failing.lastSyncAttemptAt).not.toBeNull();
    const healthy = await prisma.achievement.findFirstOrThrow({ where: { game: { steamAppId: healthyApp } } });
    expect(healthy.globalPct).toBe(42);

    // Rarity rotates the same way: the healthy game was attempted last, so the failing one is next.
    const more = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await refreshRarity(1, where)).toEqual({ processed: 0, failed: 1 });
    more.mockRestore();
  });
});
