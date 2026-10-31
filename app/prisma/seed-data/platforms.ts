/**
 * Multi-platform example data: lucas's linked accounts, PSN trophies and Xbox achievements for
 * three games, platform ids, catalog details and fixture media. Every account id, platform id
 * and trophy name here is made up for the development seed.
 */

export type SeedPlatform = "steam" | "psn" | "xbox" | "retro";

/** lucas's non-Steam accounts (Steam comes from User.steamId). All verified. */
export const LUCAS_LINKED_ACCOUNTS: { platform: SeedPlatform; externalId: string; handle: string }[] = [
  { platform: "psn", externalId: "9000000000000000001", handle: "Lucas-Exemplo" },
  { platform: "xbox", externalId: "2535400000000001", handle: "Lucas Exemplo" },
  { platform: "retro", externalId: "LucasExemplo", handle: "LucasExemplo" },
];

type SeedTrophy = {
  name: string;
  tier?: "bronze" | "silver" | "gold" | "platinum";
  points?: number;
  globalPct: number;
};

/** Generic example names, shared by the three games (index = platform achievement id). */
const PSN_TROPHIES: SeedTrophy[] = [
  { name: "Lenda completa", tier: "platinum", globalPct: 2.1 },
  { name: "Mestre do desafio", tier: "gold", globalPct: 4.8 },
  { name: "Sem olhar para trás", tier: "gold", globalPct: 7.5 },
  { name: "Caçador de segredos", tier: "silver", globalPct: 12.4 },
  { name: "Rota alternativa", tier: "silver", globalPct: 18.9 },
  { name: "Primeiro chefe", tier: "bronze", globalPct: 61.2 },
  { name: "Explorador", tier: "bronze", globalPct: 44.0 },
  { name: "Primeiros passos", tier: "bronze", globalPct: 88.5 },
];

const XBOX_ACHIEVEMENTS: SeedTrophy[] = [
  { name: "Tudo concluído", points: 100, globalPct: 2.6 },
  { name: "Mão firme", points: 80, globalPct: 5.3 },
  { name: "Colecionador", points: 50, globalPct: 9.9 },
  { name: "Atalho secreto", points: 30, globalPct: 16.7 },
  { name: "Primeiro chefe", points: 20, globalPct: 58.1 },
  { name: "Explorador", points: 15, globalPct: 41.3 },
  { name: "Primeiros passos", points: 5, globalPct: 90.2 },
];

export type SeedPlatformGame = {
  gameSlug: string;
  platform: "psn" | "xbox";
  /** Example platform id of the game (PSN npCommunicationId / Xbox titleId format). */
  externalId: string;
  achievements: { apiName: string; trophy: SeedTrophy }[];
  /** Indexes of `achievements` lucas has unlocked, and how long ago (days). */
  lucasUnlocked: number[];
  lucasDaysAgo: number;
  lucasPlaytimeMin: number;
};

const withIds = (list: SeedTrophy[]) =>
  list.map((trophy, i) => ({ apiName: String(i + 1), trophy }));

export const PLATFORM_GAMES: SeedPlatformGame[] = [
  // Platinum on PSN: every trophy.
  { gameSlug: "hollow-knight", platform: "psn", externalId: "NPWR90001_00", achievements: withIds(PSN_TROPHIES), lucasUnlocked: [0, 1, 2, 3, 4, 5, 6, 7], lucasDaysAgo: 120, lucasPlaytimeMin: 4800 },
  { gameSlug: "hollow-knight", platform: "xbox", externalId: "90000001", achievements: withIds(XBOX_ACHIEVEMENTS), lucasUnlocked: [4, 5, 6], lucasDaysAgo: 300, lucasPlaytimeMin: 540 },
  { gameSlug: "hades", platform: "psn", externalId: "NPWR90002_00", achievements: withIds(PSN_TROPHIES), lucasUnlocked: [3, 5, 6, 7], lucasDaysAgo: 90, lucasPlaytimeMin: 1500 },
  { gameSlug: "hades", platform: "xbox", externalId: "90000002", achievements: withIds(XBOX_ACHIEVEMENTS), lucasUnlocked: [], lucasDaysAgo: 0, lucasPlaytimeMin: 0 },
  { gameSlug: "resident-evil-4", platform: "psn", externalId: "NPWR90003_00", achievements: withIds(PSN_TROPHIES), lucasUnlocked: [], lucasDaysAgo: 0, lucasPlaytimeMin: 0 },
  { gameSlug: "resident-evil-4", platform: "xbox", externalId: "90000003", achievements: withIds(XBOX_ACHIEVEMENTS), lucasUnlocked: [1, 2, 3, 4, 5, 6], lucasDaysAgo: 60, lucasPlaytimeMin: 1260 },
];

/** Catalog details used to match news and platform titles to games. */
export const GAME_DETAILS: Record<string, { aliases: string[]; developer: string; publisher: string }> = {
  "hollow-knight": { aliases: ["HK", "Hollow Knight: Voidheart Edition"], developer: "Team Cherry", publisher: "Team Cherry" },
  hades: { aliases: ["Hades I"], developer: "Supergiant Games", publisher: "Supergiant Games" },
  "resident-evil-4": { aliases: ["RE4", "Resident Evil 4 Remake"], developer: "Capcom", publisher: "Capcom" },
};

/** Fixture media per game: `url` stays null, so the UI draws generated art. */
export const MEDIA_LAYOUT: { kind: string; count: number; width: number | null; height: number | null }[] = [
  { kind: "cover", count: 1, width: 600, height: 900 },
  { kind: "hero", count: 1, width: 1920, height: 620 },
  { kind: "logo", count: 1, width: 800, height: 310 },
  { kind: "video", count: 2, width: null, height: null },
  { kind: "screenshot", count: 4, width: 1920, height: 1080 },
  { kind: "artwork", count: 2, width: 1920, height: 1080 },
];
