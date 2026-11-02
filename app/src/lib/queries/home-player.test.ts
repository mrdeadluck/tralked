import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { expFor } from "@/lib/engine/xp";
import { dailyPeriodKey } from "@/lib/progression/periods";
import { getHomePlayer } from "./home-player";

const P = "homeplayer-test";

describe("getHomePlayer", () => {
  let userId = "";
  const now = new Date();

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { handle: { startsWith: P } } });
    await prisma.game.deleteMany({ where: { slug: { startsWith: P } } });
    const user = await prisma.user.create({
      data: {
        handle: `${P}-me`,
        displayName: "Home Player",
        profilePublic: true,
        stats: { create: { totalXp: expFor(10) + Math.round((expFor(11) - expFor(10)) / 4), level: 10, vocation: "Recruta", streakCurrent: 3 } },
      },
    });
    userId = user.id;
    const [near, far, done] = await Promise.all(
      ["near", "far", "done"].map((s) =>
        prisma.game.create({ data: { slug: `${P}-${s}`, name: `Home ${s}`, achievementCount: 10, coverUrl: s === "near" ? "https://example.com/c.jpg" : null } }),
      ),
    );
    await prisma.userGame.createMany({
      data: [
        { userId, gameId: near.id, platform: "steam", playtimeMin: 60, unlockedCount: 8 },
        { userId, gameId: far.id, platform: "steam", playtimeMin: 60, unlockedCount: 2 },
        // 100% on Steam: never "closest", even with a lower count on another platform.
        { userId, gameId: done.id, platform: "steam", playtimeMin: 60, unlockedCount: 10, completedAt: now },
      ],
    });
    await prisma.mission.createMany({
      data: [
        { userId, kind: "daily", periodKey: dailyPeriodKey(now), title: "Feita", condition: { minCount: 1 }, rewardXp: 100, progress: 1, completedAt: now },
        { userId, kind: "daily", periodKey: dailyPeriodKey(now), title: "Aberta", condition: { minCount: 5 }, rewardXp: 300, progress: 2 },
        { userId, kind: "daily", periodKey: "2000-01-01", title: "Velha", condition: { minCount: 1 }, rewardXp: 1 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { handle: { startsWith: P } } });
    await prisma.game.deleteMany({ where: { slug: { startsWith: P } } });
  });

  it("level progress, the closest unfinished game, the open mission, streak and rank", async () => {
    const player = await getHomePlayer(userId, now);
    expect(player).toMatchObject({
      handle: `${P}-me`,
      started: true,
      level: 10,
      levelPct: 25,
      closest: { slug: `${P}-near`, unlocked: 8, total: 10, pct: 80, coverUrl: "https://example.com/c.jpg" },
      mission: { title: "Aberta", progress: 2, goal: 5, rewardXp: 300, done: false, allDone: false },
      streak: { current: 3, activeToday: false },
    });
    expect(player!.xpToNext).toBe(expFor(11) - expFor(10) - Math.round((expFor(11) - expFor(10)) / 4));
    expect(player!.rank?.position).toBeGreaterThan(0);
  });

  it("a private profile has no rank; unknown users are null", async () => {
    await prisma.user.update({ where: { id: userId }, data: { profilePublic: false } });
    expect((await getHomePlayer(userId, now))?.rank).toBeNull();
    expect(await getHomePlayer("nobody-home-player", now)).toBeNull();
  });
});
