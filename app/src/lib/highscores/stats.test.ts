import { describe, expect, it } from "vitest";
import { computeRankStats } from "./stats";

describe("computeRankStats", () => {
  const stats = computeRankStats({
    games: [
      // Same game on Steam and PSN: one game for `all`, hours add up.
      { gameId: "hk", platform: "steam", playtimeMin: 600 },
      { gameId: "hk", platform: "psn", playtimeMin: 120 },
      // Owned, never played.
      { gameId: "idle", platform: "steam", playtimeMin: 0 },
      { gameId: "halo", platform: "xbox", playtimeMin: 300 },
      // A negative report never subtracts.
      { gameId: "odd", platform: "steam", playtimeMin: -5 },
    ],
    unlocks: [
      { gameId: "hk", platform: "steam", globalPct: 2 },
      { gameId: "hk", platform: "steam", globalPct: 15 },
      { gameId: "hk", platform: "psn", globalPct: 40 },
      { gameId: "hk", platform: "psn", globalPct: null },
      // An unlock without a library row still makes the game owned and played.
      { gameId: "retro1", platform: "retro", globalPct: 1 },
    ],
    // The profile's Tralked (one per list at 100%): two PSN regional lists and a RA set.
    tralked: { tralked: 3, tralkedByPlatform: { psn: 2, retro: 1 } },
  });

  it("merges platforms for `all`", () => {
    expect(stats.all).toEqual({
      playtimeMin: 600 + 120 + 300,
      achievements: 5,
      rareAchievements: 3,
      legendaryAchievements: 2,
      perfectGames: 3,
      gamesOwned: 5,
      // hk, halo, retro1 (idle and odd were never played)
      gamesPlayed: 3,
      acervo: 3 * 10 + 2 * 5,
    });
  });

  it("splits by platform", () => {
    expect(stats.steam).toMatchObject({ playtimeMin: 600, achievements: 2, rareAchievements: 2, legendaryAchievements: 1, perfectGames: 0, gamesOwned: 3, gamesPlayed: 1 });
    expect(stats.psn).toMatchObject({ playtimeMin: 120, achievements: 2, rareAchievements: 0, perfectGames: 2, gamesOwned: 1, gamesPlayed: 1, acervo: 10 });
    expect(stats.xbox).toMatchObject({ playtimeMin: 300, perfectGames: 0, gamesPlayed: 1 });
    expect(stats.retro).toMatchObject({ achievements: 1, legendaryAchievements: 1, perfectGames: 1, gamesOwned: 1, gamesPlayed: 1 });
  });

  it("is all zeros for an empty account", () => {
    const empty = computeRankStats({ games: [], unlocks: [], tralked: { tralked: 0, tralkedByPlatform: {} } });
    for (const scope of Object.values(empty)) {
      expect(Object.values(scope).every((v) => v === 0)).toBe(true);
    }
  });
});
