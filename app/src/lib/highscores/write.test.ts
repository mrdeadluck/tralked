import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recomputeUser } from "@/lib/progression/recompute";
import { getProfileSummary } from "@/lib/profile/queries";
import { rankStatsWrites } from "./write";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-a7w` prefix and are removed.
const PREFIX = "test-a7w";
const NOW = new Date("2026-11-05T12:00:00Z");
const T0 = new Date("2026-10-20T12:00:00Z");
let counter = 0;

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}
beforeAll(cleanup);
afterAll(cleanup);

async function newUser() {
  counter++;
  return prisma.user.create({ data: { handle: `${PREFIX}-${counter}`, displayName: "Teste" } });
}

async function psnGame(consoles: { console: string; createdAt: Date }[]) {
  counter++;
  const game = await prisma.game.create({
    data: { slug: `${PREFIX}-${counter}`, name: `Jogo ${counter}`, achievementCount: 0, platforms: ["PS5"] },
  });
  const lists = [];
  for (const c of consoles) {
    counter++;
    const list = await prisma.trophyList.create({
      data: { gameId: game.id, platform: "psn", externalId: `${PREFIX}-L${counter}`, console: c.console, name: "Lista", createdAt: c.createdAt },
    });
    const ach = await prisma.achievement.create({
      data: { gameId: game.id, platform: "psn", apiName: "1", name: "Bronze", trophyTier: "bronze", globalPct: 30, listId: list.id },
    });
    lists.push({ list, ach });
  }
  return { game, lists };
}

const at = (m: number) => new Date(T0.getTime() + m * 60_000);

describe("rank stats count a PSN trophy in every list", () => {
  it("a trophy earned in two PS5 regions counts twice for rank stats and attributes", async () => {
    const user = await newUser();
    const { lists } = await psnGame([
      { console: "PS5", createdAt: at(0) },
      { console: "PS5", createdAt: at(1) },
    ]);
    for (const [i, l] of lists.entries()) {
      await prisma.userAchievement.create({ data: { userId: user.id, achievementId: l.ach.id, unlockedAt: at(10 + i) } });
    }
    await recomputeUser(user.id, NOW);
    const all = await prisma.userRankStats.findUniqueOrThrow({ where: { userId_scope: { userId: user.id, scope: "all" } } });
    expect(all.achievements).toBe(2);
    const psn = await prisma.userRankStats.findUniqueOrThrow({ where: { userId_scope: { userId: user.id, scope: "psn" } } });
    expect(psn.achievements).toBe(2);
    // Attributes see two bronze trophies too (Glória = tier weight x 10 each).
    const gloria = await prisma.attributeProgress.findUniqueOrThrow({ where: { userId_attribute: { userId: user.id, attribute: "gloria" } } });
    expect(gloria.points).toBe(20);

    // Direct call with the shape recompute passes.
    const rows = await prisma.userAchievement.findMany({
      where: { userId: user.id },
      select: {
        unlockedAt: true,
        achievement: { select: { gameId: true, platform: true, apiName: true, globalPct: true, list: { select: { platform: true, console: true, externalId: true } } } },
      },
    });
    expect(rows).toHaveLength(2);
    await prisma.$transaction(await rankStatsWrites(user.id, rows));
    const again = await prisma.userRankStats.findUniqueOrThrow({ where: { userId_scope: { userId: user.id, scope: "all" } } });
    expect(again.achievements).toBe(2);
  });

  it("profile total still counts both", async () => {
    const user = await newUser();
    const { lists } = await psnGame([
      { console: "PS5", createdAt: at(0) },
      { console: "PS5", createdAt: at(1) },
    ]);
    for (const [i, l] of lists.entries()) {
      await prisma.userAchievement.create({ data: { userId: user.id, achievementId: l.ach.id, unlockedAt: at(10 + i) } });
    }
    await recomputeUser(user.id, NOW);
    expect((await getProfileSummary(user.id))?.achievements).toBe(2);
  });

  it("a PS4 and a PS5 trophy both count", async () => {
    const user = await newUser();
    const { lists } = await psnGame([
      { console: "PS4", createdAt: at(0) },
      { console: "PS5", createdAt: at(1) },
    ]);
    for (const [i, l] of lists.entries()) {
      await prisma.userAchievement.create({ data: { userId: user.id, achievementId: l.ach.id, unlockedAt: at(10 + i) } });
    }
    await recomputeUser(user.id, NOW);
    const all = await prisma.userRankStats.findUniqueOrThrow({ where: { userId_scope: { userId: user.id, scope: "all" } } });
    expect(all.achievements).toBe(2);
  });
});

describe('the "Tralked" board counts as the profile Tralked', () => {
  it("one per list at 100% (two PS5 regions are two; a platinated list short of 100% is none) plus a Steam 100%, by scope", async () => {
    const user = await newUser();
    counter++;
    const game = await prisma.game.create({
      data: { slug: `${PREFIX}-${counter}`, name: `Jogo ${counter}`, achievementCount: 0, platforms: ["PS5"] },
    });
    // The third region holds the platinum trophy but is short of 100% (DLC missing): a Platina, not Tralked.
    for (const k of [0, 1, 2]) {
      counter++;
      const list = await prisma.trophyList.create({
        data: { gameId: game.id, platform: "psn", externalId: `${PREFIX}-L${counter}`, console: "PS5", name: "Lista", createdAt: at(k) },
      });
      const plat = await prisma.achievement.create({
        data: { gameId: game.id, platform: "psn", apiName: "0", name: "Platina", trophyTier: "platinum", globalPct: 5, listId: list.id },
      });
      await prisma.userAchievement.create({ data: { userId: user.id, achievementId: plat.id, unlockedAt: at(10 + k) } });
      await prisma.userTrophyList.create({ data: { userId: user.id, listId: list.id, unlockedCount: 1, completedAt: k < 2 ? at(10 + k) : null } });
    }
    await prisma.userGame.create({
      data: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 60, unlockedCount: 2, completedAt: at(10) },
    });
    counter++;
    const steam = await prisma.game.create({ data: { slug: `${PREFIX}-${counter}`, name: "Steam", achievementCount: 1, platforms: ["PC"] } });
    await prisma.userGame.create({
      data: { userId: user.id, gameId: steam.id, platform: "steam", playtimeMin: 60, unlockedCount: 1, completedAt: at(20) },
    });

    await recomputeUser(user.id, NOW);
    const board = async (scope: string) =>
      (await prisma.userRankStats.findUniqueOrThrow({ where: { userId_scope: { userId: user.id, scope } } })).perfectGames;
    expect(await board("all")).toBe(3);
    expect(await board("psn")).toBe(2);
    expect(await board("steam")).toBe(1);
    expect(await board("xbox")).toBe(0);
    const summary = await getProfileSummary(user.id);
    expect(summary?.tralked).toBe(3);
    expect(summary?.platinums).toBe(3);
    expect(summary?.psnPlatinums).toBe(3);
  });
});
