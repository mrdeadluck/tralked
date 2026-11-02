import { listPhotosByAuthor } from "@/lib/community/gallery";
import type { PhotoCardView } from "@/lib/community/gallery";
import { prisma } from "@/lib/db";
import { ATTRIBUTES, attributeLevel, type AttributeId } from "@/lib/engine/attributes";
import { trophyTierFromRarity, type PlatformId, type TrophyTier } from "@/lib/engine/trophies";
import { validCompletions } from "@/lib/progression/completions";
import { platinumCount } from "./counts";

/**
 * Character sheet v2 (Plan 2): attributes, linked platforms, trophies by tier and the player's
 * photos. Read from the database only; the sync and recompute write these.
 */

/** Short "where it comes from" hint shown under each attribute bar. */
export const ATTRIBUTE_SOURCE: Record<AttributeId, string> = {
  vigor: "horas jogadas",
  precisao: "conquistas raras",
  gloria: "troféus",
  colecao: "jogos 100%",
  exploracao: "jogos e gêneros",
  constancia: "dias jogados",
  sabedoria: "guias e respostas",
  resistencia: "horas totais",
  acervo: "jogos da biblioteca",
};

export type CharacterAttribute = {
  id: AttributeId;
  name: string;
  description: string;
  source: string;
  level: number;
  points: number;
  /** Points earned inside the current level and the points the level spans. */
  current: number;
  span: number;
};

/** Points where `level` starts (inverse of `attributeLevel`: level L starts at 25·(L−1)²). */
export const attributeLevelStart = (level: number) => 25 * (level - 1) ** 2;

/** Progress inside the current attribute level. */
export function attributeBand(points: number): { level: number; current: number; span: number } {
  const safe = Math.max(0, points);
  const level = attributeLevel(safe);
  const start = attributeLevelStart(level);
  return { level, current: safe - start, span: attributeLevelStart(level + 1) - start };
}

export const PLATFORM_ORDER: PlatformId[] = ["steam", "psn", "xbox", "retro"];

/** An active connection; `verified` false when it was typed in without proof (Exophase model). */
export type CharacterPlatform = { platform: PlatformId; handle: string; verified: boolean };

export type TrophyTotals = Record<TrophyTier, number>;

export type TrophySummary = {
  tiers: TrophyTotals;
  /** Valid unlocks per platform (platforms without unlocks are left out). */
  byPlatform: { platform: PlatformId; unlocks: number }[];
};

type UnlockRow = { gameId: string; platform: string; trophyTier: string | null; globalPct: number | null };

const TIERS = new Set<string>(["bronze", "silver", "gold", "platinum"]);

/**
 * Trophies by tier, with the same rules as the Glória attribute: the native tier (PSN) when there
 * is one, otherwise the tier from the global rarity; a game completed on a platform without a
 * native platinum (Steam, Xbox, RetroAchievements) counts as one platinum.
 */
export function summarizeTrophies(
  unlocks: UnlockRow[],
  completions: { gameId: string; platform: string }[],
): TrophySummary {
  const tiers: TrophyTotals = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  const perPlatform = new Map<string, number>();
  const nativePlatinum: UnlockRow[] = [];
  for (const u of unlocks) {
    const tier =
      u.trophyTier && TIERS.has(u.trophyTier) ? (u.trophyTier as TrophyTier) : trophyTierFromRarity(u.globalPct);
    if (tier === "platinum") nativePlatinum.push(u);
    else tiers[tier]++;
    perPlatform.set(u.platform, (perPlatform.get(u.platform) ?? 0) + 1);
  }
  // The sheet's "Platinas" counts with the same function (lib/character/counts).
  tiers.platinum = platinumCount(nativePlatinum, completions);
  return {
    tiers,
    byPlatform: PLATFORM_ORDER.filter((p) => perPlatform.has(p)).map((platform) => ({
      platform,
      unlocks: perPlatform.get(platform)!,
    })),
  };
}

/** Photos shown on the sheet (a multiple of 3 keeps the grid rows full). */
export const SHEET_PHOTO_LIMIT = 9;

export type CharacterSheetExtras = {
  bio: string | null;
  /** The latest Steam import did not finish (private Steam profile or Steam unavailable). */
  steamSyncFailing: boolean;
  attributes: CharacterAttribute[];
  platforms: CharacterPlatform[];
  trophies: TrophySummary;
  photos: { items: PhotoCardView[]; total: number };
};

export async function getCharacterSheetExtras(userId: string): Promise<CharacterSheetExtras> {
  const [user, attributeRows, accounts, unlocks, completions, photos] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { bio: true, steamId: true, lastSyncedAt: true, lastSyncAttemptAt: true },
    }),
    prisma.attributeProgress.findMany({ where: { userId } }),
    prisma.linkedAccount.findMany({
      where: { userId, linkedAt: { not: null } },
      select: { platform: true, handle: true, verifiedAt: true },
    }),
    prisma.userAchievement.findMany({
      where: { userId, suspicious: false },
      select: { achievement: { select: { gameId: true, platform: true, trophyTier: true, globalPct: true } } },
    }),
    // A tainted 100% (suspicious unlock) is no platinum, as in Glória and the sheet's counters.
    validCompletions(userId),
    listPhotosByAuthor(userId, SHEET_PHOTO_LIMIT),
  ]);

  const pointsById = new Map(attributeRows.map((r) => [r.attribute, r.points]));
  const attributes = ATTRIBUTES.map(({ id, name, description }) => {
    const points = pointsById.get(id) ?? 0;
    return { id, name, description, source: ATTRIBUTE_SOURCE[id], points, ...attributeBand(points) };
  });

  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const platforms = PLATFORM_ORDER.flatMap((platform) => {
    const account = byPlatform.get(platform);
    return account ? [{ platform, handle: account.handle, verified: account.verifiedAt !== null }] : [];
  });

  return {
    bio: user?.bio ?? null,
    steamSyncFailing: Boolean(
      user?.steamId &&
        user.lastSyncAttemptAt &&
        (!user.lastSyncedAt || user.lastSyncAttemptAt > user.lastSyncedAt),
    ),
    attributes,
    platforms,
    trophies: summarizeTrophies(
      unlocks.map((u) => u.achievement),
      completions,
    ),
    photos: { items: photos.photos, total: photos.total },
  };
}
