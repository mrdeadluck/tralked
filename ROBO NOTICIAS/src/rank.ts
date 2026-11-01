import type { Source } from "./config.js";

export type Tier = Source["tier"];

export const TIER_WEIGHT: Record<Tier, number> = { oficial: 20, portal: 10, outro: 0 };

export interface StoryStats {
  /** Highest triage importance (0-100) among the story's items. */
  maxImportance: number;
  /** Tier of each source in the story (duplicates are harmless). */
  tiers: Tier[];
  /** Distinct sources, title-only (Google News) ones included. */
  sourceCount: number;
  rumor: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

export function storyScore(s: StoryStats): number {
  const tierWeight = Math.max(0, ...s.tiers.map((t) => TIER_WEIGHT[t]));
  const extraSources = Math.max(0, Math.min(s.sourceCount - 1, 4));
  return s.maxImportance + tierWeight + extraSources * 5 - (s.rumor ? 15 : 0);
}

export function isBomb(s: Pick<StoryStats, "maxImportance" | "sourceCount" | "tiers">): boolean {
  return s.maxImportance >= 90 && s.sourceCount >= 3 && s.tiers.some((t) => t !== "outro");
}

/**
 * A story is publishable with an `oficial` source, or at least 2 sources, or exactly one `portal` source
 * that is not a rumor. A rumor also needs a `portal` or `oficial` source.
 * Ruling R15: at least one source must have full text (not a title-only Google News item); title-only
 * sources still count toward `sourceCount` and `tiers`.
 */
export function isPublishable(s: Pick<StoryStats, "tiers" | "sourceCount" | "rumor"> & { hasFullText: boolean }): boolean {
  if (!s.hasFullText) return false;
  const hasOficial = s.tiers.includes("oficial");
  const hasPortal = s.tiers.includes("portal");
  if (s.rumor && !hasOficial && !hasPortal) return false;
  return hasOficial || s.sourceCount >= 2 || (s.sourceCount === 1 && hasPortal && !s.rumor);
}

/** Expired once older than 24 h when `score < 70`, otherwise once older than 48 h (exactly 24/48 h is not yet expired). */
export function isExpired(s: { score: number; firstSeenAt: Date }, now: Date): boolean {
  const maxAgeMs = (s.score < 70 ? 24 : 48) * HOUR_MS;
  return now.getTime() - s.firstSeenAt.getTime() > maxAgeMs;
}
