import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

const updateTag = vi.fn();
const refresh = vi.fn();
vi.mock("next/cache", () => ({ updateTag, refresh, cacheLife: vi.fn(), cacheTag: vi.fn() }));

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
const SLUG = "test-retro-action";
// The offline RA catalog fixture's Zelda set (lib/integrations/retro/catalog.ts).
const RA_ID = 990002;

describe.skipIf(!reachable)("loadRetroAchievements", async () => {
  const { prisma } = await import("@/lib/db");
  const { loadRetroAchievements } = await import("./retro-actions");
  let gameId = "";

  async function cleanup() {
    await prisma.game.deleteMany({ where: { slug: SLUG } });
    await prisma.retroCatalogGame.deleteMany({ where: { id: RA_ID } });
  }
  beforeAll(async () => {
    await cleanup();
    gameId = (
      await prisma.game.create({
        data: { slug: SLUG, name: "Zelda Action Test", achievementCount: 0, platformLinks: { create: [{ platform: "retro", externalId: String(RA_ID) }] } },
      })
    ).id;
    await prisma.retroCatalogGame.create({
      data: { id: RA_ID, title: "Legend of Zelda, The: A Link to the Past", consoleId: 3, consoleName: "SNES/Super Famicom", achievementCount: 2, points: 30 },
    });
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("rejects bad ids and unknown games", async () => {
    await expect(loadRetroAchievements("bad id!")).resolves.toEqual({ status: "invalid" });
    await expect(loadRetroAchievements(42)).resolves.toEqual({ status: "invalid" });
    await expect(loadRetroAchievements("nope-no-game")).resolves.toEqual({ status: "not_found" });
  });

  it("reads the set once, expires the game's cache and refreshes the page", async () => {
    await expect(loadRetroAchievements(gameId)).resolves.toEqual({ status: "loaded" });
    expect(updateTag).toHaveBeenCalledWith(`game:${SLUG}`);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await prisma.achievement.count({ where: { gameId, platform: "retro" } })).toBe(2);
    await expect(loadRetroAchievements(gameId)).resolves.toEqual({ status: "none" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
