import type { RarityTier } from "./types";

/** Total XP required to reach level L (Tibia curve). */
export function expFor(level: number): number {
  const l = level;
  return Math.round((50 / 3) * (l ** 3 - 6 * l ** 2 + 17 * l - 12));
}

export function levelFromXp(totalXp: number): {
  level: number;
  current: number;
  next: number;
  fraction: number;
} {
  let level = 1;
  while (expFor(level + 1) <= totalXp) level++;
  const base = expFor(level);
  const next = expFor(level + 1) - base;
  const current = Math.max(0, totalXp - base);
  return { level, current, next, fraction: current / next };
}

/** XP of an achievement from its global unlock percentage (null = unknown, treated as 50%). */
export function xpForAchievement(globalPct: number | null): number {
  const p = globalPct ?? 50;
  return Math.round(1500 + 60000 / (p + 1.5));
}

export function rarityTier(globalPct: number): RarityTier {
  if (globalPct <= 3) return "lendaria";
  if (globalPct <= 8) return "epica";
  if (globalPct <= 20) return "rara";
  if (globalPct <= 50) return "incomum";
  return "comum";
}

/** Platinum bonus: 10% of the game's achievement XP sum. */
export function platinumBonus(achievementXps: number[]): number {
  const sum = achievementXps.reduce((acc, v) => acc + v, 0);
  return Math.round(sum * 0.1);
}
