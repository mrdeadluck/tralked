import { describe, expect, it } from "vitest";
import { computeRankStats } from "./stats";

const done = new Date("2026-10-01T00:00:00Z");

describe("computeRankStats", () => {
  const stats = computeRankStats({
    games: [
      // Same game on Steam and PSN: one game for `all`, hours add up, 100% on PSN only.
      { gameId: "hk", platform: "steam", playtimeMin: 600, completedAt: null },
      { gameId: "hk", platform: "psn", playtimeMin: 120, completedAt: done },
      // Owned, never played.
      { gameId: "idle", platform: "steam", playtimeMin: 0, completedAt: null },
      // 100% on Xbox, but with a suspicious unlock there: no completion.
      { gameId: "halo", platform: "xbox", playtimeMin: 300, completedAt: done },
      // A negative report never subtracts.
      { gameId: "odd", platform: "steam", playtimeMin: -5, completedAt: null },
    ],
    unlocks: [
      { gameId: "hk", platform: "steam", globalPct: 2 },
      { gameId: "hk", platform: "steam", globalPct: 15 },
      { gameId: "hk", platform: "psn", globalPct: 40 },
      { gameId: "hk", platform: "psn", globalPct: null },
      // An unlock without a library row still makes the game owned and played.
      { gameId: "retro1", platform: "retro", globalPct: 1 },
    ],
    taintedKeys: new Set(["halo:xbox"]),
  });

  it("merges platforms for `all`", () => {
    expect(stats.all).toEqual({
      playtimeMin: 600 + 120 + 300,
      achievements: 5,
      rareAchievements: 3,
      legendaryAchievements: 2,
      perfectGames: 1,
      gamesOwned: 5,
      // hk, halo, retro1 (idle and odd were never played)
      gamesPlayed: 3,
      acervo: 3 * 10 + 2 * 5,
    });
  });

  it("splits by platform", () => {
    expect(stats.steam).toMatchObject({ playtimeMin: 600, achievements: 2, rareAchievements: 2, legendaryAchievements: 1, perfectGames: 0, gamesOwned: 3, gamesPlayed: 1 });
    expect(stats.psn).toMatchObject({ playtimeMin: 120, achievements: 2, rareAchievements: 0, perfectGames: 1, gamesOwned: 1, gamesPlayed: 1, acervo: 10 });
    expect(stats.xbox).toMatchObject({ playtimeMin: 300, perfectGames: 0, gamesPlayed: 1 });
    expect(stats.retro).toMatchObject({ achievements: 1, legendaryAchievements: 1, gamesOwned: 1, gamesPlayed: 1 });
  });

  it("is all zeros for an empty account", () => {
    const empty = computeRankStats({ games: [], unlocks: [], taintedKeys: new Set() });
    for (const scope of Object.values(empty)) {
      expect(Object.values(scope).every((v) => v === 0)).toBe(true);
    }
  });
});
