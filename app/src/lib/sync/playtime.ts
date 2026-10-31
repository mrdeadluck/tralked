import { playtimeSourceKey, reachedMilestones } from "@/lib/engine/playtime";

/** Platforms whose real playtime pays XP (lib/engine/playtime.ts). */
export type PlaytimePlatform = "steam" | "psn" | "xbox" | "retro";

export type PlaytimeLedgerRow = {
  userId: string;
  source: "playtime";
  sourceKey: string;
  /** NULL for Steam (the Steam ledger convention; the sourceKey says `steam:`). */
  platform: string | null;
  xp: number;
  skills: string[];
  createdAt: Date;
};

/**
 * Ledger rows of every hours milestone reached on one game and platform, to insert with
 * `skipDuplicates`: each milestone has its own unique key, so it pays once, re-syncs add only the
 * milestones crossed since, and a voided entry (unlinked or claimed account) is never paid again.
 * `playtimeMin` must be the platform's own report: estimates and placeholders never pay. Dated at
 * the last play when the platform says (never in the future), else at `now`.
 */
export function playtimeLedgerRows(input: {
  userId: string;
  platform: PlaytimePlatform;
  gameId: string;
  playtimeMin: number;
  skills: string[];
  lastPlayedAt?: Date | null;
  now: Date;
}): PlaytimeLedgerRow[] {
  const { userId, platform, gameId, playtimeMin, skills, lastPlayedAt, now } = input;
  const createdAt =
    lastPlayedAt && lastPlayedAt.getTime() <= now.getTime() && lastPlayedAt.getUTCFullYear() >= 2000
      ? lastPlayedAt
      : now;
  return reachedMilestones(playtimeMin).map((m) => ({
    userId,
    source: "playtime",
    sourceKey: playtimeSourceKey(platform, gameId, m.hours),
    platform: platform === "steam" ? null : platform,
    xp: m.xp,
    skills,
    createdAt,
  }));
}
