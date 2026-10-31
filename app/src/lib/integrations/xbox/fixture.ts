import type { XboxAchievement, XboxApi, XboxProfile, XboxTitle } from "./types";

/**
 * Offline Xbox adapter. Accounts and titles mirror the development seed
 * (prisma/seed-data/platforms.ts): lucas's gamertag `Lucas Exemplo` and the example titleIds of
 * Hollow Knight, Hades and Resident Evil 4. Every id and name is made up.
 */

type FixtureAccount = XboxProfile & { isPrivate?: boolean };

export const XBOX_FIXTURE_ACCOUNTS: FixtureAccount[] = [
  { xuid: "2535400000000001", gamertag: "Lucas Exemplo", bio: "Gamerscore é vida.", avatarUrl: null },
  { xuid: "2535400000000002", gamertag: "Tralked Teste", bio: "Conta de teste do Tralked.", avatarUrl: null },
  { xuid: "2535400000000003", gamertag: "Perfil Fechado", bio: "", avatarUrl: null, isPrivate: true },
];

const ACHIEVEMENTS: { name: string; gamerscore: number; rarityPct: number }[] = [
  { name: "Tudo concluído", gamerscore: 100, rarityPct: 2.6 },
  { name: "Mão firme", gamerscore: 80, rarityPct: 5.3 },
  { name: "Colecionador", gamerscore: 50, rarityPct: 9.9 },
  { name: "Atalho secreto", gamerscore: 30, rarityPct: 16.7 },
  { name: "Primeiro chefe", gamerscore: 20, rarityPct: 58.1 },
  { name: "Explorador", gamerscore: 15, rarityPct: 41.3 },
  { name: "Primeiros passos", gamerscore: 5, rarityPct: 90.2 },
];

const TITLES: {
  titleId: string;
  name: string;
  unlocked: number[];
  firstUnlockedAt: string;
  /** Xbox's MinutesPlayed stat (absent: Xbox has no number for the title). */
  minutesPlayed?: number;
}[] = [
  { titleId: "90000001", name: "Hollow Knight", unlocked: [4, 5, 6], firstUnlockedAt: "2026-01-10T20:00:00Z", minutesPlayed: 720 },
  {
    titleId: "90000003",
    name: "Resident Evil 4",
    unlocked: [1, 2, 3, 4, 5, 6],
    firstUnlockedAt: "2026-08-20T21:00:00Z",
    minutesPlayed: 1830,
  },
  // Played (title history) without any achievement unlocked yet.
  { titleId: "90000005", name: "Forja Abissal", unlocked: [], firstUnlockedAt: "2026-09-15T21:00:00Z", minutesPlayed: 140 },
];

const DAY_MS = 86_400_000;

function achievementsOf(title: (typeof TITLES)[number]): XboxAchievement[] {
  const start = new Date(title.firstUnlockedAt).getTime();
  return ACHIEVEMENTS.map((a, i) => {
    const order = title.unlocked.indexOf(i);
    const unlocked = order >= 0;
    return {
      // 1-based, like the seeded Achievement.apiName of these titles.
      id: String(i + 1),
      name: a.name,
      description: null,
      iconUrl: null,
      hidden: false,
      gamerscore: a.gamerscore,
      unlocked,
      unlockedAt: unlocked ? new Date(start + order * DAY_MS) : null,
      rarityPct: a.rarityPct,
    };
  });
}

export function createXboxFixture(): XboxApi {
  const account = (xuid: string) => XBOX_FIXTURE_ACCOUNTS.find((a) => a.xuid === xuid);
  return {
    async findProfile(gamertag) {
      const found = XBOX_FIXTURE_ACCOUNTS.find(
        (a) => a.gamertag.toLowerCase() === gamertag.toLowerCase(),
      );
      if (!found) return null;
      const { xuid, gamertag: tag, bio, avatarUrl } = found;
      return { xuid, gamertag: tag, bio, avatarUrl };
    },
    async getTitles(xuid) {
      const found = account(xuid);
      if (!found) return [];
      if (found.isPrivate) return "private";
      return TITLES.map((title): XboxTitle => {
        const list = achievementsOf(title);
        const unlocked = list.filter((a) => a.unlocked);
        return {
          titleId: title.titleId,
          name: title.name,
          currentAchievements: unlocked.length,
          totalAchievements: list.length,
          currentGamerscore: unlocked.reduce((sum, a) => sum + a.gamerscore, 0),
          totalGamerscore: list.reduce((sum, a) => sum + a.gamerscore, 0),
          progress: Math.round((unlocked.length / list.length) * 100),
          lastPlayed: unlocked.at(-1)?.unlockedAt ?? new Date(title.firstUnlockedAt),
        };
      });
    },
    async getMinutesPlayed(xuid, titleIds) {
      const found = account(xuid);
      if (found?.isPrivate) return "private";
      const minutes = new Map<string, number>();
      if (!found) return minutes;
      for (const t of TITLES) {
        if (titleIds.includes(t.titleId) && t.minutesPlayed !== undefined) minutes.set(t.titleId, t.minutesPlayed);
      }
      return minutes;
    },
    async getAchievements(xuid, titleId) {
      const found = account(xuid);
      if (found?.isPrivate) return "private";
      const title = TITLES.find((t) => t.titleId === titleId);
      return title && found ? achievementsOf(title) : [];
    },
  };
}
