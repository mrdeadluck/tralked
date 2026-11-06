import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import type { RetroCatalogApi, RetroSetAchievement } from "@/lib/integrations/retro/catalog";

// Needs Postgres up and migrated (see db.test.ts); skipped when unreachable.
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
const RA = 98_100_000;
const SLUG = "test-retro-ach-";

const ach = (id: string, extra: Partial<RetroSetAchievement> = {}): RetroSetAchievement => ({
  id,
  name: `Conquista ${id}`,
  description: null,
  iconUrl: null,
  points: 5,
  rarityPct: 10,
  ...extra,
});

function api(sets: Record<number, RetroSetAchievement[] | Error>) {
  const getGameAchievements = vi.fn(async (id: number) => {
    const set = sets[id];
    if (set instanceof Error) throw set;
    return set ?? null;
  });
  return { api: { getConsoles: async () => [], getGameList: async () => [], getGameAchievements } as RetroCatalogApi, getGameAchievements };
}

describe.skipIf(!reachable)("RetroAchievements lists on demand", () => {
  let gameId = "";

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: { startsWith: SLUG } } });
    await prisma.retroCatalogGame.deleteMany({ where: { id: { gte: RA, lt: RA + 100 } } });
  }
  beforeEach(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    gameId = (
      await prisma.game.create({
        data: {
          slug: `${SLUG}game`,
          name: "Retro Achievements Test",
          platforms: ["NINTENDO"],
          achievementCount: 0,
          stub: true,
          platformLinks: { create: [{ platform: "retro", externalId: String(RA + 1) }] },
        },
      })
    ).id;
    await prisma.retroCatalogGame.create({
      data: { id: RA + 1, title: "Retro Achievements Test", consoleId: 3, consoleName: "SNES", achievementCount: 2, points: 10, setModifiedAt: new Date("2026-01-01T00:00:00Z") },
    });
  });
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("reads a never-read set once, then only when RA changed it", async () => {
    const { prisma } = await import("@/lib/db");
    const { hasRetroAchievementsDue, syncRetroAchievements } = await import("./retro-achievements");
    expect(await hasRetroAchievementsDue(gameId)).toBe(true);

    const first = api({ [RA + 1]: [ach("1", { description: "Faça", iconUrl: "https://media.retroachievements.org/Badge/1.png" }), ach("2")] });
    const t1 = new Date("2026-11-02T12:00:00Z");
    await expect(syncRetroAchievements(gameId, first.api, t1)).resolves.toEqual({ sets: 1, written: 2, failed: 0 });
    const rows = await prisma.achievement.findMany({ where: { gameId, platform: "retro" }, orderBy: { apiName: "asc" } });
    expect(rows.map((r) => [r.apiName, r.name, r.points, r.globalPct, r.description])).toEqual([
      ["1", "Conquista 1", 5, 10, "Faça"],
      ["2", "Conquista 2", 5, 10, null],
    ]);
    expect(await hasRetroAchievementsDue(gameId)).toBe(false);
    await expect(syncRetroAchievements(gameId, first.api, t1)).resolves.toEqual({ sets: 0, written: 0, failed: 0 });
    expect(first.getGameAchievements).toHaveBeenCalledTimes(1);

    // RA changed the set: one achievement renamed, one added.
    await prisma.retroCatalogGame.update({ where: { id: RA + 1 }, data: { setModifiedAt: new Date("2026-11-03T00:00:00Z"), achievementCount: 3 } });
    const second = api({ [RA + 1]: [ach("1", { name: "Renomeada", description: "Faça", iconUrl: "https://media.retroachievements.org/Badge/1.png" }), ach("2"), ach("3")] });
    await expect(syncRetroAchievements(gameId, second.api, new Date("2026-11-03T12:00:00Z"))).resolves.toEqual({ sets: 1, written: 2, failed: 0 });
    expect(await prisma.achievement.count({ where: { gameId, platform: "retro" } })).toBe(3);
  });

  it("an RA set read on demand gets its own list", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncRetroAchievements } = await import("./retro-achievements");
    const read = api({ [RA + 1]: [ach("1"), ach("2")] });
    await syncRetroAchievements(gameId, read.api);
    const list = await prisma.trophyList.findUniqueOrThrow({
      where: { platform_externalId: { platform: "retro", externalId: String(RA + 1) } },
    });
    expect(list).toMatchObject({ gameId, console: "SNES", name: "Retro Achievements Test", trophyCount: 2 });
    const rows = await prisma.achievement.findMany({ where: { gameId, platform: "retro" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.listId === list.id)).toBe(true);
  });

  it("gives the claim back when RA fails, so the next open tries again", async () => {
    const { prisma } = await import("@/lib/db");
    const { hasRetroAchievementsDue, syncRetroAchievements } = await import("./retro-achievements");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = api({ [RA + 1]: new Error("RetroAchievements API_GetGameExtended failed with HTTP 500") });
    await expect(syncRetroAchievements(gameId, failing.api)).resolves.toEqual({ sets: 0, written: 0, failed: 1 });
    expect((await prisma.retroCatalogGame.findUniqueOrThrow({ where: { id: RA + 1 } })).achievementsSyncedAt).toBeNull();
    expect(await hasRetroAchievementsDue(gameId)).toBe(true);
    warn.mockRestore();
  });

  it("only marks a set whose rows a player's sync already wrote", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncRetroAchievements } = await import("./retro-achievements");
    const list = await prisma.trophyList.create({
      data: { gameId, platform: "retro", externalId: String(RA + 1), console: "SNES", name: "Set", trophyCount: 2 },
    });
    await prisma.achievement.createMany({
      data: ["1", "2"].map((apiName) => ({ gameId, platform: "retro", listId: list.id, apiName, name: apiName })),
    });
    const spy = api({});
    await expect(syncRetroAchievements(gameId, spy.api)).resolves.toEqual({ sets: 1, written: 0, failed: 0 });
    expect(spy.getGameAchievements).not.toHaveBeenCalled();
    expect((await prisma.retroCatalogGame.findUniqueOrThrow({ where: { id: RA + 1 } })).achievementsSyncedAt).not.toBeNull();
  });

  it("does nothing for a game without RA sets", async () => {
    const { prisma } = await import("@/lib/db");
    const { hasRetroAchievementsDue, syncRetroAchievements } = await import("./retro-achievements");
    const other = await prisma.game.create({ data: { slug: `${SLUG}other`, name: "No RA", achievementCount: 0 } });
    expect(await hasRetroAchievementsDue(other.id)).toBe(false);
    const spy = api({});
    await expect(syncRetroAchievements(other.id, spy.api)).resolves.toEqual({ sets: 0, written: 0, failed: 0 });
  });
});
