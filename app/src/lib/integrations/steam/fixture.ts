import hollowKnight from "./__fixtures__/hollow-knight.json";
import ownedGames from "./__fixtures__/owned-games.json";
import player from "./__fixtures__/player.json";
import type { SteamApi } from "./types";

/**
 * Offline public profiles read when a Steam is connected, and by a claim's code check (code in the
 * "Resumo"). Each code is fixed, so a test sets the pending claim's code to it (as if the user had
 * pasted it). They mirror the seed: `jogador-demo` is lucas's Steam (seeded with a password),
 * `morrigan77` is Morrigan77's (an account of the old Steam login, without credentials);
 * `tralked-teste` and `tralked-dois` belong to nobody.
 */
export const STEAM_FIXTURE_PROFILES = [
  {
    steamId: player.steamId,
    vanity: "jogador-demo",
    personaName: player.personaName,
    summary: "Perfil de demonstração do Tralked. TRK-LUCAS2",
    profilePublic: true,
  },
  {
    steamId: "76561198000000042",
    vanity: "tralked-teste",
    personaName: "Tralked Teste",
    summary: "Conta de teste do Tralked.<br>Código: TRK-STEAM2",
    profilePublic: true,
  },
  {
    steamId: "76561198000000044",
    vanity: "tralked-dois",
    personaName: "Tralked Dois",
    summary: "Outra conta de teste do Tralked.",
    profilePublic: true,
  },
  {
    steamId: "76561198000000043",
    vanity: "perfil-fechado",
    personaName: "Perfil Fechado",
    summary: "",
    profilePublic: false,
  },
  {
    steamId: "76561198000001011",
    vanity: "morrigan77",
    personaName: "Morrigan77",
    summary: "Jogando desde sempre. TRK-HERDA2",
    profilePublic: true,
  },
] as const;

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
