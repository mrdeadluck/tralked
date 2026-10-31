import { xpForAchievement } from "./xp";

export type TrophyTier = "bronze" | "silver" | "gold" | "platinum";
export type PlatformId = "steam" | "psn" | "xbox" | "retro";

/**
 * Tier of an achievement from its global rarity. Platinum is never derived from
 * rarity: it only exists for native platinum trophies / 100% completion.
 */
export function trophyTierFromRarity(pct: number | null): TrophyTier {
  if (pct === null) return "bronze";
  if (pct <= 5) return "gold";
  if (pct <= 20) return "silver";
  return "bronze";
}

const GLORY: Record<TrophyTier, number> = {
  bronze: 1,
  silver: 2,
  gold: 5,
  platinum: 15,
};

export function gloryPoints(tier: TrophyTier): number {
  return GLORY[tier];
}

const PSN_TIER_XP: Record<TrophyTier, number> = {
  bronze: 2000,
  silver: 4000,
  gold: 9000,
  platinum: 25000,
};

const XBOX_GAMERSCORE_XP = 120;
const RETRO_HARDCORE_MULTIPLIER = 1.25;

export function xpForPlatformAchievement(input: {
  platform: PlatformId;
  globalPct: number | null;
  points: number | null;
  trophyTier: TrophyTier | null;
  hardcore: boolean;
}): number {
  const { platform, globalPct, points, trophyTier, hardcore } = input;

  if (platform === "psn" && globalPct === null && trophyTier) {
    return PSN_TIER_XP[trophyTier];
  }

  const base = xpForAchievement(globalPct);

  if (platform === "xbox" && points !== null) {
    return Math.max(base, points * XBOX_GAMERSCORE_XP);
  }
  if (platform === "retro" && hardcore) {
    return Math.round(base * RETRO_HARDCORE_MULTIPLIER);
  }
  return base;
}
