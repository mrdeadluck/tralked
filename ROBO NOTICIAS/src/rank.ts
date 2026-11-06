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
  // Coverage is the engagement we can see: every outlet (and Reddit hot list) that picked the story up.
  const extraSources = Math.max(0, Math.min(s.sourceCount - 1, 7));
  return s.maxImportance + tierWeight + extraSources * 5 - (s.rumor ? 15 : 0);
}

/**
 * Importance >= 90, at least 3 sources and a non-`outro` one, never a rumor. With `fullTextSources`, only
 * sources with their own text count toward the 3 (a Reddit hot list or a title-only Google News item is a
 * signal, not coverage).
 */
export function isBomb(
  s: Pick<StoryStats, "maxImportance" | "sourceCount" | "tiers"> & { rumor?: boolean; fullTextSources?: number },
): boolean {
  if (s.rumor) return false;
  return s.maxImportance >= 90 && (s.fullTextSources ?? s.sourceCount) >= 3 && s.tiers.some((t) => t !== "outro");
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

/**
 * Expired once older than 24 h when `score < 70`, otherwise once older than 48 h (exactly 24/48 h is not yet
 * expired). With `maxAgeHours`, that age for every score (the robot's NEWS_MAX_AGE_HOURS: news of the day only).
 */
export function isExpired(s: { score: number; firstSeenAt: Date }, now: Date, maxAgeHours?: number): boolean {
  const maxAgeMs = (maxAgeHours ?? (s.score < 70 ? 24 : 48)) * HOUR_MS;
  return now.getTime() - s.firstSeenAt.getTime() > maxAgeMs;
}
