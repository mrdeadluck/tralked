import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getGameVersion, getGameVersions, getPlayerVersions } from "./game-versions";

// Test database only (vitest.db-guard.ts). A GTA V-like game: Steam, PS3, PS4 and a PS5 with two
// regional lists. Fixtures use the `test-gv` prefix and are removed.
const PREFIX = "test-gv";
let gameId: string;
let userId: string;
let listIds: Record<string, string>;
const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 0, m));

async function cleanup() {
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  gameId = (await prisma.game.create({ data: { slug: `${PREFIX}-gta`, name: "GTA V", achievementCount: 2, platforms: [] } })).id;
  userId = (await prisma.user.create({ data: { handle: `${PREFIX}-u`, displayName: "T" } })).id;

  const defs = [
    // Created out of display order on purpose.
    { key: "ps3", platform: "psn", console: "PS3", name: "GTA V", m: 1, region: null },
    { key: "ps5a", platform: "psn", console: "PS5", name: "GTA V", m: 2, region: null },
    { key: "ps5b", platform: "psn", console: "PS5", name: "グランド・セフト・オート V", m: 3, region: "jp" },
    { key: "ps4", platform: "psn", console: "PS4", name: "GTA V", m: 4, region: null },
    { key: "steam", platform: "steam", console: "PC", name: "GTA V", m: 5, region: null },
  ];
  listIds = {};
  for (const d of defs) {
    const l = await prisma.trophyList.create({
      data: {
        gameId,
        platform: d.platform,
        externalId: `${PREFIX}-${d.key}`,
        console: d.console,
        name: d.name,
        region: d.region,
        trophyCount: 2,
        createdAt: at(d.m),
      },
    });
    listIds[d.key] = l.id;
    const psn = d.platform === "psn";
    await prisma.achievement.createMany({
      data: [
        { gameId, platform: d.platform, listId: l.id, apiName: "0", name: "Platina", trophyTier: psn ? "platinum" : null, globalPct: 1 },
        { gameId, platform: d.platform, listId: l.id, apiName: "1", name: "Bronze", trophyTier: psn ? "bronze" : null, globalPct: 60 },
      ],
    });
  }
});
afterAll(cleanup);

describe("getGameVersions", () => {
  it("GTA V has three PSN versions and Steam in order", async () => {
    const versions = await getGameVersions(gameId);
    expect(versions.map((v) => [v.key, v.label])).toEqual([
      ["psn:PS5", "PS5"],
      ["psn:PS4", "PS4"],
      ["psn:PS3", "PS3"],
      ["steam", "PC · Steam"],
    ]);
    expect(versions[3].total).toBe(2);
    expect(versions[0].total).toBe(2);
    expect(versions[0].nativePlatinum).toBe(true);
  });

  it('a version with two regions shows both labels and the note "2 listas · conta 1"', async () => {
    const versions = await getGameVersions(gameId);
    expect(versions.find((v) => v.key === "psn:PS5")!.lists.map((l) => l.label)).toEqual(["Lista 1", "🇯🇵 Ásia"]);
    expect(versions.find((v) => v.key === "psn:PS4")!.lists.map((l) => l.label)).toEqual([null]);

    expect(await getPlayerVersions(gameId, userId)).toEqual([]);

    await prisma.userTrophyList.create({ data: { userId, listId: listIds.ps5a, unlockedCount: 0 } });
    await prisma.userTrophyList.create({ data: { userId, listId: listIds.ps5b, unlockedCount: 0 } });
    const [ps5] = await getPlayerVersions(gameId, userId);
    expect(ps5.key).toBe("psn:PS5");
    expect(ps5.countedNote).toBe("2 listas · conta 1");
    expect(ps5.lists.map((l) => l.label)).toEqual(["Lista 1", "🇯🇵 Ásia"]);
  });

  it("earnedIn marks a trophy with the regions it was earned in, matched by apiName", async () => {
    const rows = await prisma.achievement.findMany({ where: { gameId, listId: { in: [listIds.ps5a, listIds.ps5b] } } });
    const of = (listKey: string, apiName: string) => rows.find((r) => r.listId === listIds[listKey] && r.apiName === apiName)!.id;
    await prisma.userAchievement.createMany({
      data: [
        { userId, achievementId: of("ps5a", "1"), unlockedAt: at(20) },
        { userId, achievementId: of("ps5b", "1"), unlockedAt: at(10) },
        { userId, achievementId: of("ps5b", "0"), unlockedAt: at(11) },
      ],
    });
    await prisma.userTrophyList.update({ where: { userId_listId: { userId, listId: listIds.ps5a } }, data: { unlockedCount: 1 } });
    await prisma.userTrophyList.update({
      where: { userId_listId: { userId, listId: listIds.ps5b } },
      data: { unlockedCount: 2, completedAt: at(11) },
    });
    const ps5 = (await getPlayerVersions(gameId, userId)).find((v) => v.key === "psn:PS5")!;
    expect(ps5.earnedIn["1"]).toEqual(["Lista 1", "🇯🇵 Ásia"]);
    expect(ps5.earnedIn["0"]).toEqual(["🇯🇵 Ásia"]);
    expect(ps5.unlocked).toBe(2);
    expect(ps5.pct).toBe(100);
    expect(ps5.platinum).toBe(true);
    expect(ps5.lists.map((l) => l.complete)).toEqual([false, true]);
    expect(ps5.tiersEarned).toEqual({ platinum: 1, gold: 0, silver: 0, bronze: 1 });
    expect(ps5.earnedAt["1"].map((e) => e.label)).toEqual(["🇯🇵 Ásia", "Lista 1"]);

    // The XP of a trophy is what the ledger paid (keyed by the canonical list's copy), voided ones aside.
    await prisma.xpLedgerEntry.createMany({
      data: [
        { userId, source: "achievement", sourceKey: of("ps5a", "1"), xp: 2400, skills: [] },
        { userId, source: "achievement", sourceKey: of("ps5a", "0"), xp: 9000, skills: [], voidedAt: at(30) },
      ],
    });
    const paid = (await getPlayerVersions(gameId, userId)).find((v) => v.key === "psn:PS5")!;
    expect(paid.xp).toEqual({ "1": 2400 });
  });

  it("getGameVersion reads one version, the same as in the whole game's", async () => {
    const all = await getGameVersions(gameId);
    for (const key of ["psn:PS5", "psn:PS3", "steam"]) {
      expect(await getGameVersion(`${PREFIX}-gta`, key)).toEqual(all.find((v) => v.key === key));
    }
    expect(await getGameVersion(`${PREFIX}-gta`, "psn:PS9")).toBeNull();
    expect(await getGameVersion(`${PREFIX}-nope`, "steam")).toBeNull();
  });

  it("a visitor sees the first region's trophies", async () => {
    const ps5 = (await getGameVersions(gameId)).find((v) => v.key === "psn:PS5")!;
    expect(ps5.trophies.map((t) => [t.apiName, t.tier])).toEqual([
      ["0", "platinum"],
      ["1", "bronze"],
    ]);
    expect(ps5.lists[0].id).toBe(listIds.ps5a);
  });
});
