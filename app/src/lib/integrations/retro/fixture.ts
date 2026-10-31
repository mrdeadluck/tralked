import type { RetroAchievement, RetroApi, RetroGame, RetroProfile } from "./types";

/**
 * Offline RetroAchievements adapter: lucas's seeded account `LucasExemplo`, a test account and
 * one retro game (not in the catalog) with hardcore and softcore unlocks. Ids are made up.
 */

export const RETRO_FIXTURE_ACCOUNTS: RetroProfile[] = [
  { user: "LucasExemplo", ulid: "01JTRALKED00000000000LUCAS", motto: "Hardcore ou nada.", avatarUrl: null },
  { user: "TralkedTeste", ulid: "01JTRALKED00000000000TESTE", motto: "Conta de teste do Tralked.", avatarUrl: null },
];

const GAME: RetroGame = {
  gameId: "990001",
  title: "Sonic the Hedgehog",
  consoleName: "Mega Drive",
  maxPossible: 4,
  numAwarded: 3,
  numAwardedHardcore: 2,
  lastPlayed: new Date("2026-10-20T22:00:00Z"),
};

const ACHIEVEMENTS: RetroAchievement[] = [
  { id: "9901", name: "Primeira fase", description: "Complete a Green Hill Zone 1.", iconUrl: null, points: 3, rarityPct: 80.5, earned: true, earnedAt: new Date("2026-10-18T20:00:00Z"), hardcore: true },
  { id: "9902", name: "Sem anéis", description: "Derrote um chefe sem anéis.", iconUrl: null, points: 25, rarityPct: 3.2, earned: true, earnedAt: new Date("2026-10-19T21:00:00Z"), hardcore: true },
  { id: "9903", name: "Esmeralda", description: "Pegue uma esmeralda do caos.", iconUrl: null, points: 10, rarityPct: 22.4, earned: true, earnedAt: new Date("2026-10-20T22:00:00Z"), hardcore: false },
  { id: "9904", name: "Final verdadeiro", description: "Pegue as seis esmeraldas.", iconUrl: null, points: 50, rarityPct: 1.1, earned: false, earnedAt: null, hardcore: false },
];

export function createRetroFixture(): RetroApi {
  const account = (user: string) =>
    RETRO_FIXTURE_ACCOUNTS.find(
      (a) => a.user.toLowerCase() === user.toLowerCase() || a.ulid === user,
    );
  return {
    async findProfile(user) {
      const found = account(user);
      return found ? { ...found } : null;
    },
    async getGames(user) {
      return account(user) ? [{ ...GAME }] : [];
    },
    async getGameProgress(user, gameId) {
      if (!account(user) || gameId !== GAME.gameId) return { playtimeMin: null, achievements: [] };
      return { playtimeMin: 300, achievements: ACHIEVEMENTS.map((a) => ({ ...a })) };
    },
  };
}
