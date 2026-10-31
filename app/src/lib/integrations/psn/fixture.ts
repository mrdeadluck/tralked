import type { TrophyTier } from "@/lib/engine/trophies";
import type { PsnApi, PsnProfile, PsnTitle, PsnTrophy } from "./types";

/**
 * Offline PSN adapter. Its accounts and titles mirror the development seed
 * (prisma/seed-data/platforms.ts): lucas's account `Lucas-Exemplo`, the example
 * npCommunicationIds of Hollow Knight, Hades and Resident Evil 4, plus one title
 * the catalog does not know (`Astro Bot`). Every id and name is made up.
 */

type FixtureAccount = Omit<PsnProfile, "isPrivate"> & {
  isPrivate?: boolean;
  /** PSN reports the trophies as earned but without a date (rare; tests the first-seen rule). */
  undated?: boolean;
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
];

const TROPHIES: { name: string; tier: TrophyTier; rarityPct: number }[] = [
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

const DAY_MS = 86_400_000;

function trophiesOf(title: FixtureTitle, undated = false): PsnTrophy[] {
  const start = new Date(title.firstEarnedAt).getTime();
  return TROPHIES.map((t, i) => {
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
      return TITLES.map((title): PsnTitle => {
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
      const title = TITLES.find((t) => t.npTitleId === npTitleId);
      return title && found ? trophiesOf(title, found.undated) : [];
    },
  };
}
