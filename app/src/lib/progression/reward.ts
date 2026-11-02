/**
 * What an XP-granting action hands back to the client, so the global reward host
 * (components/fx/RewardHost) can show "+5 XP · Curtida" and, when the level changed, the level-up
 * overlay. Pure types and helpers: safe to import from client components.
 */

import { levelFromXp } from "@/lib/engine/xp";

export type LevelChange = { from: number; to: number };

/**
 * Where the reward left the viewer inside their level: the toast draws it as a mini bar that fills
 * from `before` to `after` (shares of the level, 0..1). After a level up `before` is 0: the bar
 * starts over in the new level.
 */
export type LevelProgress = { level: number; before: number; after: number };

export type Reward = {
  /** XP credited to the viewer by this action (0 when nothing was paid: cap, already paid). */
  xpGained: number;
  /** Short pt-BR label of where it came from: "Curtida", "Foto publicada", "Sincronização". */
  reason: string;
  /** SkillId the XP went to, when it went to one (the toast shows its icon). */
  skill?: string | null;
  /** The viewer's character level before and after, only when it went up. */
  levelUp?: LevelChange | null;
  /** The progress bar of the toast (unknown before the viewer's first sync). */
  progress?: LevelProgress | null;
  /** The viewer's XP of the last 7 days, this reward included (what Esta semana ranks). */
  weekXp?: number | null;
};

/** The level bar between two totals (`after` includes the reward). */
export function levelProgress(totalAfter: number, gained: number): LevelProgress {
  const now = levelFromXp(totalAfter);
  const then = levelFromXp(Math.max(0, totalAfter - gained));
  return {
    level: now.level,
    before: then.level === now.level ? Math.min(1, then.fraction) : 0,
    after: Math.min(1, now.fraction),
  };
}

/** The level change between two readings, or null when it did not go up (or is unknown). */
export function levelChange(before: number | null | undefined, after: number | null | undefined): LevelChange | null {
  if (before == null || after == null || after <= before) return null;
  return { from: before, to: after };
}

/** A reward worth showing (some XP or a level up), else null. */
export function rewardOf(
  xpGained: number,
  reason: string,
  extra: {
    skill?: string | null;
    levelUp?: LevelChange | null;
    progress?: LevelProgress | null;
    weekXp?: number | null;
  } = {},
): Reward | null {
  if (xpGained <= 0 && !extra.levelUp) return null;
  return {
    xpGained: Math.max(0, xpGained),
    reason,
    skill: extra.skill ?? null,
    levelUp: extra.levelUp ?? null,
    // Only the fields that are known: the toast draws what it gets, nothing more.
    ...(extra.progress ? { progress: extra.progress } : {}),
    ...(extra.weekXp != null ? { weekXp: extra.weekXp } : {}),
  };
}
