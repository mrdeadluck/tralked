import type { TrophyTier } from "@/lib/engine/trophies";
import type { PsnApi, PsnPlayedGame, PsnProfile, PsnTitle, PsnTrophy } from "./types";

/**
 * Offline PSN adapter. Its accounts and titles mirror the development seed
 * (prisma/seed-data/platforms.ts): lucas's account `Lucas-Exemplo`, the example
 * npCommunicationIds of Hollow Knight, Hades and Resident Evil 4, plus one title
 * the catalog does not know (`Astro Bot`). `Tres-Consoles` holds only Grand Theft Auto V, with a
 * PS3, a PS4 and a PS5 trophy list of the same name (the lists that used to collide on one game).
 * Every id is made up.
 */

type FixtureAccount = Omit<PsnProfile, "isPrivate"> & {
  isPrivate?: boolean;
  /** PSN reports the trophies as earned but without a date (rare; tests the first-seen rule). */
  undated?: boolean;
  /** `gta-v`: the account has only the GTA_V_LISTS titles and no played games (default: TITLES and PLAYED). */
  library?: "gta-v";
};

export const PSN_FIXTURE_ACCOUNTS: FixtureAccount[] = [
  {
    accountId: "9000000000000000001",
    onlineId: "Lucas-Exemplo",
    aboutMe: "Caçador de platinas.",
    avatarUrl: null,
  },
  {
    accountId: "9000000000000000002",
    onlineId: "Tralked-Teste",
    aboutMe: "Conta de teste do Tralked.",
    avatarUrl: null,
  },
  {
    accountId: "9000000000000000003",
    onlineId: "Perfil-Fechado",
    aboutMe: "",
    avatarUrl: null,
    isPrivate: true,
  },
  {
    accountId: "9000000000000000004",
    onlineId: "Sem-Data",
    aboutMe: "",
    avatarUrl: null,
    undated: true,
  },
  {
    accountId: "9000000000000000005",
    onlineId: "Tres-Consoles",
    aboutMe: "",
    avatarUrl: null,
    library: "gta-v",
  },
];

type FixtureTrophy = { name: string; tier: TrophyTier; rarityPct: number };

const TROPHIES: FixtureTrophy[] = [
  { name: "Lenda completa", tier: "platinum", rarityPct: 2.1 },
  { name: "Mestre do desafio", tier: "gold", rarityPct: 4.8 },
  { name: "Sem olhar para trás", tier: "gold", rarityPct: 7.5 },
  { name: "Caçador de segredos", tier: "silver", rarityPct: 12.4 },
  { name: "Rota alternativa", tier: "silver", rarityPct: 18.9 },
  { name: "Primeiro chefe", tier: "bronze", rarityPct: 61.2 },
  { name: "Explorador", tier: "bronze", rarityPct: 44.0 },
  { name: "Primeiros passos", tier: "bronze", rarityPct: 88.5 },
];

type FixtureTitle = {
  npTitleId: string;
  name: string;
  platform: string;
  /** Indexes of TROPHIES the fixture accounts have earned. */
  earned: number[];
  /** Earn time of the first trophy; each next one is a day later. */
  firstEarnedAt: string;
  /** The title's own trophy list (default: TROPHIES). */
  trophies?: FixtureTrophy[];
};

const TITLES: FixtureTitle[] = [
  {
    npTitleId: "NPWR90001_00",
    name: "Hollow Knight",
    platform: "PS4",
    earned: [0, 1, 2, 3, 4, 5, 6, 7],
    firstEarnedAt: "2026-06-01T20:00:00Z",
  },
  {
    npTitleId: "NPWR90002_00",
    name: "Hades",
    platform: "PS5",
    earned: [3, 5, 6, 7],
    firstEarnedAt: "2026-07-01T21:00:00Z",
  },
  {
    npTitleId: "NPWR90003_00",
    name: "Resident Evil 4",
    platform: "PS5",
    earned: [],
    firstEarnedAt: "2026-08-01T22:00:00Z",
  },
  {
    npTitleId: "NPWR90004_00",
    name: "Astro Bot",
    platform: "PS5",
    earned: [5, 7],
    firstEarnedAt: "2026-09-01T19:00:00Z",
  },
];

/** A made-up list of `count` trophies: a platinum first, then gold, silver and bronze. */
function trophyList(count: number): FixtureTrophy[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Troféu ${i + 1}`,
    tier: i === 0 ? "platinum" : i % 10 === 0 ? "gold" : i % 4 === 0 ? "silver" : "bronze",
    rarityPct: i === 0 ? 1.5 : 5 + ((i * 7) % 90),
  }));
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Grand Theft Auto V: three lists of one game, the same trophy numbers in each. */
const GTA_V_LISTS: FixtureTitle[] = [
  {
    npTitleId: "NPWR90011_00",
    name: "Grand Theft Auto V",
    platform: "PS3",
    earned: range(1, 20),
    firstEarnedAt: "2014-03-01T20:00:00Z",
    trophies: trophyList(59),
  },
  {
    npTitleId: "NPWR90012_00",
    name: "Grand Theft Auto V",
    platform: "PS4",
    earned: range(1, 46),
    firstEarnedAt: "2015-02-01T20:00:00Z",
    trophies: trophyList(77),
  },
  {
    npTitleId: "NPWR90013_00",
    name: "Grand Theft Auto V",
    platform: "PS5",
    earned: range(1, 26),
    firstEarnedAt: "2022-04-01T20:00:00Z",
    trophies: trophyList(77),
  },
];

/**
 * Played games with PSN play time (gamelist): the trophy titles' games under their store title ids,
 * plus one game without any trophy earned (Resident Evil 4) and one made-up game the trophy list
 * does not have (Jornada Submersa). No concept: the concept tests spy their own played games.
 */
const PLAYED: PsnPlayedGame[] = [
  {
    titleId: "CUSA90001_00",
    name: "Hollow Knight",
    category: "ps4_game",
    playtimeMin: 1500,
    firstPlayedAt: new Date("2026-05-30T20:00:00Z"),
    lastPlayedAt: new Date("2026-06-08T22:00:00Z"),
    conceptId: null,
    conceptTitleIds: [],
  },
  {
    titleId: "PPSA90002_00",
    name: "Hades",
    category: "ps5_native_game",
    playtimeMin: 905,
    firstPlayedAt: new Date("2026-06-30T21:00:00Z"),
    lastPlayedAt: new Date("2026-07-05T23:00:00Z"),
    conceptId: null,
    conceptTitleIds: [],
  },
  {
    titleId: "PPSA90003_00",
    name: "Resident Evil 4",
    category: "ps5_native_game",
    playtimeMin: 200,
    firstPlayedAt: new Date("2026-08-01T21:00:00Z"),
    lastPlayedAt: new Date("2026-08-02T23:00:00Z"),
    conceptId: null,
    conceptTitleIds: [],
  },
  {
    titleId: "PPSA90004_00",
    name: "Astro Bot",
    category: "ps5_native_game",
    playtimeMin: 610,
    firstPlayedAt: new Date("2026-09-01T18:00:00Z"),
    lastPlayedAt: new Date("2026-09-03T20:00:00Z"),
    conceptId: null,
    conceptTitleIds: [],
  },
  {
    titleId: "PPSA90005_00",
    name: "Jornada Submersa",
    category: "ps5_native_game",
    playtimeMin: 75,
    firstPlayedAt: new Date("2026-09-10T18:00:00Z"),
    lastPlayedAt: new Date("2026-09-10T19:15:00Z"),
    conceptId: null,
    conceptTitleIds: [],
  },
];

const DAY_MS = 86_400_000;

const titlesOf = (account: FixtureAccount | undefined) => (account?.library === "gta-v" ? GTA_V_LISTS : TITLES);

function trophiesOf(title: FixtureTitle, undated = false): PsnTrophy[] {
  const start = new Date(title.firstEarnedAt).getTime();
  return (title.trophies ?? TROPHIES).map((t, i) => {
    const order = title.earned.indexOf(i);
    const earned = order >= 0;
    return {
      // 1-based, like the seeded Achievement.apiName of these titles.
      trophyId: String(i + 1),
      name: t.name,
      description: null,
      iconUrl: null,
      hidden: false,
      tier: t.tier,
      earned,
      earnedAt: earned && !undated ? new Date(start + order * DAY_MS) : null,
      rarityPct: t.rarityPct,
    };
  });
}

function countBy(trophies: PsnTrophy[]): Record<TrophyTier, number> {
  const result: Record<TrophyTier, number> = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
  for (const t of trophies) result[t.tier]++;
  return result;
}

export function createPsnFixture(): PsnApi {
  const account = (accountId: string) => PSN_FIXTURE_ACCOUNTS.find((a) => a.accountId === accountId);
  return {
    async findProfile(onlineId) {
      const found = PSN_FIXTURE_ACCOUNTS.find(
        (a) => a.onlineId.toLowerCase() === onlineId.toLowerCase(),
      );
      return found ? { ...found, isPrivate: found.isPrivate ?? false } : null;
    },
    async getTitles(accountId) {
      const found = account(accountId);
      if (!found) return [];
      if (found.isPrivate) return "private";
      return titlesOf(found).map((title): PsnTitle => {
        const trophies = trophiesOf(title, found.undated);
        const earned = trophies.filter((t) => t.earned);
        return {
          npTitleId: title.npTitleId,
          serviceName: title.platform === "PS5" ? "trophy2" : "trophy",
          name: title.name,
          platform: title.platform,
          progress: Math.round((earned.length / trophies.length) * 100),
          trophyCounts: countBy(trophies),
          earnedCounts: countBy(earned),
          lastPlayed: earned.at(-1)?.earnedAt ?? null,
        };
      });
    },
    async getTrophies(accountId, npTitleId) {
      const found = account(accountId);
      if (found?.isPrivate) return "private";
      const title = titlesOf(found).find((t) => t.npTitleId === npTitleId);
      return title && found ? trophiesOf(title, found.undated) : [];
    },
    async getPlayedGames(accountId) {
      const found = account(accountId);
      if (!found) return [];
      if (found.isPrivate) return "private";
      return (found.library === "gta-v" ? [] : PLAYED).map((g) => ({ ...g }));
    },
    async getTrophyListsOfTitles(accountId, titleIds) {
      const found = account(accountId);
      if (found?.isPrivate) return "private";
      // Each played store title id has the trophy list of the same number (CUSA90001_00 -> NPWR90001_00).
      const lists = new Map(PLAYED.map((g) => [g.titleId, `NPWR${g.titleId.slice(4)}`]));
      const own = new Set(titlesOf(found).map((t) => t.npTitleId));
      return new Map(
        titleIds.map((id) => {
          const list = lists.get(id);
          return [id, found && list && own.has(list) ? [list] : []];
        }),
      );
    },
  };
}
