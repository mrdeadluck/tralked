import hollowKnight from "./__fixtures__/hollow-knight.json";
import ownedGames from "./__fixtures__/owned-games.json";
import player from "./__fixtures__/player.json";
import type { SteamApi } from "./types";

/** Offline Steam adapter backed by JSON fixtures (Hollow Knight + the demo library). */
export function createSteamFixture(): SteamApi {
  const hasData = (appId: number) => appId === hollowKnight.appId;

  return {
    async getPlayerSummary(steamId) {
      return { ...player, steamId: steamId || player.steamId };
    },

    async getOwnedGames() {
      return ownedGames.map(({ appId, playtimeMin }) => ({ appId, playtimeMin }));
    },

    async getSchemaForGame(appId) {
      return hasData(appId) ? hollowKnight.schema.map((a) => ({ ...a })) : [];
    },

    async getGlobalAchievementPercentages(appId) {
      return hasData(appId) ? { ...hollowKnight.globalPercentages } : {};
    },

    async getPlayerAchievements(_steamId, appId) {
      if (!hasData(appId)) return [];
      return hollowKnight.playerUnlocks.map((u) => ({
        apiName: u.apiName,
        unlockedAt: u.unlockTime > 0 ? new Date(u.unlockTime * 1000) : null,
      }));
    },
  };
}
