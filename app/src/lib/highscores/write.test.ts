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

describe("rank stats count a PSN trophy once per console", () => {
  it("a trophy earned in two PS5 regions counts once for rank stats", async () => {
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
    expect(all.achievements).toBe(1);
    const psn = await prisma.userRankStats.findUniqueOrThrow({ where: { userId_scope: { userId: user.id, scope: "psn" } } });
    expect(psn.achievements).toBe(1);
    // Attributes see one bronze trophy too (Glória = tier weight x 10).
    const gloria = await prisma.attributeProgress.findUniqueOrThrow({ where: { userId_attribute: { userId: user.id, attribute: "gloria" } } });
    expect(gloria.points).toBe(10);

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
    expect(again.achievements).toBe(1);
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
