import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { backfillTrophyLists } from "./backfill";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-bf` prefix and are removed. Every
// run is limited to the games of the fixtures (gameIds), so rows of other tests are never touched.
const PREFIX = "test-bf";
let userId: string;
let n = 0;

async function cleanup() {
  const ids = (await prisma.game.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } })).map((g) => g.id);
  await prisma.trophyList.deleteMany({ where: { gameId: { in: ids } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
}

async function game(over: { steamAppId?: number; name?: string } = {}) {
  const i = ++n;
  return prisma.game.create({
    data: { slug: `${PREFIX}-${i}`, name: over.name ?? `Game ${i}`, achievementCount: 0, platforms: [], steamAppId: over.steamAppId },
  });
}

async function rows(gameId: string, platform: string, count: number) {
  await prisma.achievement.createMany({
    data: Array.from({ length: count }, (_, k) => ({ gameId, platform, apiName: `A${k}`, name: `A${k}` })),
  });
}

const link = (gameId: string, platform: string, externalId: string) =>
  prisma.gamePlatformLink.create({ data: { gameId, platform, externalId } });

beforeAll(async () => {
  await cleanup();
  userId = (await prisma.user.create({ data: { handle: `${PREFIX}-u`, displayName: "Teste" } })).id;
});
afterAll(cleanup);

describe("backfillTrophyLists", () => {
  it("single-list psn game is linked in place", async () => {
    const g = await game({ name: "Single" });
    await link(g.id, "psn", "NPWR9TBF1_00");
    await rows(g.id, "psn", 3);
    const done = new Date("2024-01-02T03:04:05Z");
    await prisma.userGame.create({ data: { userId, gameId: g.id, platform: "psn", playtimeMin: 0, unlockedCount: 3, completedAt: done } });

    const r = await backfillTrophyLists({ gameIds: [g.id] });
    expect(r).toMatchObject({ listsCreated: 1, achievementsLinked: 3, achievementsLeftForResync: 0, userListsCreated: 1 });

    const list = await prisma.trophyList.findUniqueOrThrow({
      where: { platform_externalId: { platform: "psn", externalId: "NPWR9TBF1_00" } },
    });
    expect(list).toMatchObject({ gameId: g.id, console: null, name: "Single", trophyCount: 3, region: null });
    expect(await prisma.achievement.count({ where: { gameId: g.id, listId: list.id } })).toBe(3);
    const utl = await prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId, listId: list.id } } });
    expect(utl).toMatchObject({ unlockedCount: 3, hardcoreCount: 0 });
    expect(utl.completedAt).toEqual(done);
  });

  it("retro single-list copies the hardcore count", async () => {
    const g = await game();
    await link(g.id, "retro", "test-bf-77");
    await rows(g.id, "retro", 2);
    const ach = await prisma.achievement.findMany({ where: { gameId: g.id } });
    await prisma.userAchievement.createMany({
      data: [
        { userId, achievementId: ach[0].id, unlockedAt: new Date(), hardcore: true },
        { userId, achievementId: ach[1].id, unlockedAt: new Date(), hardcore: false },
      ],
    });
    await prisma.userGame.create({ data: { userId, gameId: g.id, platform: "retro", playtimeMin: 0, unlockedCount: 2 } });
    await backfillTrophyLists({ gameIds: [g.id] });
    const list = await prisma.trophyList.findFirstOrThrow({ where: { gameId: g.id } });
    expect(await prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId, listId: list.id } } })).toMatchObject({
      unlockedCount: 2,
      hardcoreCount: 1,
    });
  });

  it("multi-list psn game is left for the resync", async () => {
    const g = await game({ name: "ゲーム" });
    await link(g.id, "psn", "NPWR9TBF2_00");
    await link(g.id, "psn", "NPWR9TBF3_00");
    await link(g.id, "psn", "CUSA9TBF_00"); // a store id is not a list
    await rows(g.id, "psn", 4);
    await prisma.userGame.create({ data: { userId, gameId: g.id, platform: "psn", playtimeMin: 0, unlockedCount: 1 } });

    const r = await backfillTrophyLists({ gameIds: [g.id] });
    expect(r).toMatchObject({ listsCreated: 2, achievementsLinked: 0, achievementsLeftForResync: 4, userListsCreated: 0, multiListGames: 1 });
    const lists = await prisma.trophyList.findMany({ where: { gameId: g.id } });
    expect(lists.map((l) => [l.trophyCount, l.region])).toEqual([
      [0, "jp"],
      [0, "jp"],
    ]);
    expect(await prisma.achievement.count({ where: { gameId: g.id, listId: null } })).toBe(4);
    expect(await prisma.userTrophyList.count({ where: { list: { gameId: g.id } } })).toBe(0);
  });

  it("steam game without appid gets a game: list", async () => {
    const withApp = await game({ steamAppId: 990001 });
    const without = await game();
    await rows(withApp.id, "steam", 2);
    await rows(without.id, "steam", 2);
    const r = await backfillTrophyLists({ gameIds: [withApp.id, without.id] });
    expect(r).toMatchObject({ listsCreated: 2, achievementsLinked: 4, achievementsLeftForResync: 0, steamWithoutAppId: 1, userListsCreated: 0 });
    const a = await prisma.trophyList.findFirstOrThrow({ where: { gameId: withApp.id } });
    const b = await prisma.trophyList.findFirstOrThrow({ where: { gameId: without.id } });
    expect(a).toMatchObject({ platform: "steam", externalId: "990001", console: "PC", trophyCount: 2 });
    expect(b.externalId).toBe(`game:${without.id}`);
    expect(await prisma.achievement.count({ where: { gameId: without.id, listId: b.id } })).toBe(2);
  });

  it("running twice creates nothing new", async () => {
    const g = await game();
    await link(g.id, "xbox", "test-bf-X1");
    await rows(g.id, "xbox", 2);
    await prisma.userGame.create({ data: { userId, gameId: g.id, platform: "xbox", playtimeMin: 0, unlockedCount: 1 } });
    const first = await backfillTrophyLists({ gameIds: [g.id] });
    expect(first).toMatchObject({ listsCreated: 1, achievementsLinked: 2, userListsCreated: 1 });
    const second = await backfillTrophyLists({ gameIds: [g.id] });
    expect(second).toMatchObject({ listsCreated: 0, achievementsLinked: 0, userListsCreated: 0, achievementsLeftForResync: 0 });
  });

  it("dry run writes nothing", async () => {
    const g = await game();
    await link(g.id, "psn", "NPWR9TBF4_00");
    await rows(g.id, "psn", 2);
    await prisma.userGame.create({ data: { userId, gameId: g.id, platform: "psn", playtimeMin: 0, unlockedCount: 1 } });
    const r = await backfillTrophyLists({ dryRun: true, gameIds: [g.id] });
    expect(r).toMatchObject({ dryRun: true, listsCreated: 1, achievementsLinked: 2, userListsCreated: 1 });
    expect(await prisma.trophyList.count({ where: { gameId: g.id } })).toBe(0);
    expect(await prisma.achievement.count({ where: { gameId: g.id, listId: { not: null } } })).toBe(0);
    expect(await prisma.userTrophyList.count({ where: { userId, list: { gameId: g.id } } })).toBe(0);
  });

  it("keeps what a sync already wrote: no duplicate list, no overwritten progress, no duplicate apiName", async () => {
    const g = await game();
    await link(g.id, "psn", "NPWR9TBF5_00");
    await rows(g.id, "psn", 3); // list-less A0..A2
    // A sync after the deploy: the list exists with its own A0 row and progress.
    const list = await prisma.trophyList.create({
      data: { gameId: g.id, platform: "psn", externalId: "NPWR9TBF5_00", console: "PS4", name: "Game", trophyCount: 1 },
    });
    await prisma.achievement.create({ data: { gameId: g.id, platform: "psn", apiName: "A0", name: "A0", listId: list.id } });
    await prisma.userGame.create({ data: { userId, gameId: g.id, platform: "psn", playtimeMin: 0, unlockedCount: 9 } });
    await prisma.userTrophyList.create({ data: { userId, listId: list.id, unlockedCount: 1 } });

    const r = await backfillTrophyLists({ gameIds: [g.id] });
    expect(r).toMatchObject({ listsCreated: 0, achievementsLinked: 2, achievementsLeftForResync: 1, userListsCreated: 0 });
    expect(await prisma.trophyList.count({ where: { gameId: g.id } })).toBe(1);
    expect((await prisma.trophyList.findUniqueOrThrow({ where: { id: list.id } })).console).toBe("PS4");
    expect((await prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId, listId: list.id } } })).unlockedCount).toBe(1);
    expect(await prisma.achievement.count({ where: { gameId: g.id, listId: null } })).toBe(1);
  });
});
