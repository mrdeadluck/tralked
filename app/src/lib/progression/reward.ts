/**
 * What an XP-granting action hands back to the client, so the global reward host
 * (components/fx/RewardHost) can show "+5 XP · Curtida" and, when the level changed, the level-up
 * overlay. Pure types and helpers: safe to import from client components.
 */

export type LevelChange = { from: number; to: number };

export type Reward = {
  /** XP credited to the viewer by this action (0 when nothing was paid: cap, already paid). */
  xpGained: number;
  /** Short pt-BR label of where it came from: "Curtida", "Foto publicada", "Sincronização". */
  reason: string;
  /** SkillId the XP went to, when it went to one (the toast shows its icon). */
  skill?: string | null;
  /** The viewer's character level before and after, only when it went up. */
  levelUp?: LevelChange | null;
};

/** The level change between two readings, or null when it did not go up (or is unknown). */
export function levelChange(before: number | null | undefined, after: number | null | undefined): LevelChange | null {
  if (before == null || after == null || after <= before) return null;
  return { from: before, to: after };
}

/** A reward worth showing (some XP or a level up), else null. */
export function rewardOf(
  xpGained: number,
  reason: string,
  extra: { skill?: string | null; levelUp?: LevelChange | null } = {},
): Reward | null {
  if (xpGained <= 0 && !extra.levelUp) return null;
  return { xpGained: Math.max(0, xpGained), reason, skill: extra.skill ?? null, levelUp: extra.levelUp ?? null };
}
