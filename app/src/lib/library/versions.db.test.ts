import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platinumTally } from "@/lib/character/counts";
import { prisma } from "@/lib/db";
import { getProfileSummary } from "@/lib/profile/queries";
import { getUserLibrary } from "./queries";

// Test database only (vitest.db-guard.ts). A GTA V-like library: PS5 platinum in two regions, PS4
// platinum, PS3 at 34%, Steam at 64%, and a Steam game finished. Fixtures use the `test-b3` prefix.
const PREFIX = "test-b3";
const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 0, m));
let userId: string;

async function cleanup() {
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  userId = (await prisma.user.create({ data: { handle: `${PREFIX}-u`, displayName: "T" } })).id;
  const gta = await prisma.game.create({ data: { slug: `${PREFIX}-gta`, name: "GTA V", achievementCount: 0, platforms: [] } });
  const hk = await prisma.game.create({ data: { slug: `${PREFIX}-hk`, name: "Hollow Knight", achievementCount: 0, platforms: [] } });

  // PSN lists of GTA: [console, unlocked of 4, platinum earned, complete].
  const defs: [string, string, number, boolean, boolean][] = [
    ["ps5a", "PS5", 4, true, true],
    ["ps5b", "PS5", 4, true, true],
    ["ps4", "PS4", 3, true, false],
    ["ps3", "PS3", 1, false, false],
  ];
  for (const [i, [key, console, unlocked, plat, complete]] of defs.entries()) {
    const l = await prisma.trophyList.create({
      data: { gameId: gta.id, platform: "psn", externalId: `${PREFIX}-${key}`, console, name: "GTA V", trophyCount: 4, createdAt: at(i) },
    });
    const rows = await prisma.achievement.createManyAndReturn({
      data: ["0", "1", "2", "3"].map((apiName) => ({
        gameId: gta.id,
        platform: "psn",
        listId: l.id,
        apiName,
        name: `T${apiName}`,
        trophyTier: apiName === "0" ? "platinum" : "bronze",
      })),
    });
    const earned = (plat ? rows : rows.filter((r) => r.apiName !== "0")).slice(0, unlocked);
    await prisma.userAchievement.createMany({ data: earned.map((r, n) => ({ userId, achievementId: r.id, unlockedAt: at(10 + i * 5 + n) })) });
    await prisma.userTrophyList.create({
      data: { userId, listId: l.id, unlockedCount: unlocked, completedAt: complete ? at(20 + i) : null },
    });
  }
  // Steam: GTA at 64% (16 of 25), Hollow Knight finished.
  for (const [game, total, unlocked] of [
    [gta, 25, 16],
    [hk, 3, 3],
  ] as const) {
    await prisma.trophyList.create({
      data: { gameId: game.id, platform: "steam", externalId: `${PREFIX}-steam-${game.slug}`, console: "PC", name: game.name, trophyCount: total },
    });
    const rows = await prisma.achievement.createManyAndReturn({
      data: Array.from({ length: total }, (_, n) => ({ gameId: game.id, platform: "steam", apiName: `A${n}`, name: `A${n}` })),
    });
    await prisma.userAchievement.createMany({ data: rows.slice(0, unlocked).map((r) => ({ userId, achievementId: r.id, unlockedAt: at(40) })) });
    await prisma.userGame.create({
      data: { userId, gameId: game.id, platform: "steam", playtimeMin: 600, unlockedCount: unlocked, completedAt: unlocked === total ? at(41) : null },
    });
  }
  await prisma.userGame.create({ data: { userId, gameId: gta.id, platform: "psn", playtimeMin: 0, unlockedCount: 12, completedAt: at(20) } });
});
afterAll(cleanup);

describe("library versions and the header counters", () => {
  it("getUserLibrary gives each game once, with one version per console and Steam from its UserGame", async () => {
    const library = await getUserLibrary(userId, { versions: true });
    expect(library.map((g) => g.slug).sort()).toEqual([`${PREFIX}-gta`, `${PREFIX}-hk`]);
    const gta = library.find((g) => g.slug === `${PREFIX}-gta`)!;
    expect(gta.versions!.map((v) => [v.label, v.platinum, v.pct, v.regions])).toEqual([
      ["PS5", true, 100, 2],
      ["PS4", true, 75, 1],
      ["PS3", false, 25, 0],
      ["PC", false, 64, 0],
    ]);
    expect(library.find((g) => g.slug === `${PREFIX}-hk`)!.versions).toEqual([
      { key: "steam", platform: "steam", label: "PC", pct: 100, platinum: true, regions: 1 },
    ]);
  });

  it("the header's Platinas count one per list (both PS5 regions, PS4, the Steam 100%), 3 on PSN", async () => {
    const summary = (await getProfileSummary(userId))!;
    // The PS4 platinum trophy counts though its list is at 3/4.
    expect(summary.platinums).toBe(4);
    expect(summary.psnPlatinums).toBe(3);
    expect(summary.gamesCount).toBe(2);
    // The same numbers as the sheet and the migration snapshot (lib/character/counts).
    expect(await platinumTally(userId)).toMatchObject({ platinums: summary.platinums, psnPlatinums: summary.psnPlatinums });
  });

  it("the versions are read only when asked", async () => {
    const library = await getUserLibrary(userId);
    expect(library.every((g) => g.versions === undefined)).toBe(true);
  });
});
