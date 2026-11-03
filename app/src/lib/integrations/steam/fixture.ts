import appList from "./__fixtures__/app-list.json";
import hollowKnight from "./__fixtures__/hollow-knight.json";
import ownedGames from "./__fixtures__/owned-games.json";
import player from "./__fixtures__/player.json";
import wishlist from "./__fixtures__/wishlist.json";
import type { SteamApi } from "./types";

/** PT-BR names the offline schema answers for `l=brazilian` (the rest keeps the English name). */
const PT_NAMES: Record<string, string> = {
  FALSEHOOD: "Falsidade",
  TEST_OF_RESOLVE: "Prova de Determinação",
};

const fromUnix = (seconds: number | undefined) => (seconds ? new Date(seconds * 1000) : null);

/**
 * Offline public profiles read when a Steam is connected, and by a claim's code check (code in the
 * "Resumo"). Each code is fixed, so a test sets the pending claim's code to it (as if the user had
 * pasted it). They mirror the seed: `jogador-demo` is lucas's Steam (seeded with a password),
 * `taverneira-gerta` is Taverneira_Gerta's (an account of the old Steam login, without credentials);
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
    vanity: "taverneira-gerta",
    personaName: "Taverneira_Gerta",
    summary: "Jogando desde sempre. TRK-HERDA2",
    profilePublic: true,
  },
] as const;

/**
 * Offline Steam adapter backed by JSON fixtures (Hollow Knight + the demo library). The library
 * has played games (playtime, last 2 weeks, last played) and three owned but never played made-up
 * games; the wishlist has two made-up games and one owned game; the app list is a small store
 * catalog (with a duplicate name, as the real one has) for the catalog import.
 */
export function createSteamFixture(): SteamApi {
  const hasData = (appId: number) => appId === hollowKnight.appId;

  return {
    async getPlayerSummary(steamId) {
      return { ...player, steamId: steamId || player.steamId };
    },

    async getOwnedGames() {
      return ownedGames.map((g) => ({
        appId: g.appId,
        name: g.name,
        playtimeMin: g.playtimeMin,
        playtime2WeeksMin: "playtime2WeeksMin" in g ? g.playtime2WeeksMin : 0,
        lastPlayedAt: fromUnix("lastPlayed" in g ? g.lastPlayed : undefined),
      }));
    },

    async getWishlist() {
      return wishlist.map((w) => ({ appId: w.appId, priority: w.priority, addedAt: fromUnix(w.dateAdded) }));
    },

    async getAppList({ lastAppId = 0, maxResults = 10_000 } = {}) {
      const rest = appList.filter((a) => a.appId > lastAppId);
      const page = rest.slice(0, maxResults);
      return {
        apps: page.map((a) => ({ appId: a.appId, name: a.name, lastModified: a.lastModified })),
        haveMore: rest.length > page.length,
        lastAppId: page.at(-1)?.appId ?? lastAppId,
      };
    },

    async getSchemaForGame(appId, lang = "english") {
      if (!hasData(appId)) return [];
      return hollowKnight.schema.map((a) => ({
        ...a,
        ...(lang === "brazilian" && { name: PT_NAMES[a.apiName] ?? a.name }),
      }));
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
