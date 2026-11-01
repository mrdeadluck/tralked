/**
 * Healthy-interaction rewards (Plano 4, F9). Pure rules; lib/social applies them to the ledger.
 *
 * Exact numbers (also in the README, "Social"):
 * - `comment_liked`: 5 XP to the author of a comment or forum post for each like it RECEIVES.
 *   Whoever likes earns nothing. Liking one's own content is refused (never counts).
 *   - at most 10 paid likes per receiver per day (50 XP/day, America/Sao_Paulo days);
 *   - at most 3 paid likes per pair of users per day, both directions together (A→B plus B→A), so
 *     two people trading likes stop earning after the 3rd;
 *   - a like is paid once per liker and item: unliking and liking again never pays twice, and
 *     unliking does not take the XP back.
 * - `comment_helpful`: 20 XP to the author of a reply the PARENT's author marks as helpful ("Útil").
 *   Not on one's own reply; at most 3 per receiver per day and 1 per pair per day.
 * - Dislikes never remove XP. An item with at least 5 more dislikes than likes is collapsed
 *   ("ver mesmo assim").
 * - Removing an item (moderation "Remover", or its author deleting it) voids every
 *   `comment_liked` / `comment_helpful` entry it generated (lib/social/xp.ts). Hiding keeps them.
 * - Carisma (attribute): 5 points per paid like received, 25 per helpful reply, 10 per friend
 *   (at most 50 friends count), all from non-voided entries, so it inherits the caps above.
 */

export const COMMENT_LIKE_XP = 5;
export const COMMENT_LIKE_DAILY_CAP = 10;
export const COMMENT_LIKE_PAIR_DAILY_CAP = 3;

export const COMMENT_HELPFUL_XP = 20;
export const COMMENT_HELPFUL_DAILY_CAP = 3;
export const COMMENT_HELPFUL_PAIR_DAILY_CAP = 1;

/** dislikes − likes at or above this collapses the item. */
export const COLLAPSE_MARGIN = 5;

export const CARISMA_PER_LIKE = 5;
export const CARISMA_PER_HELPFUL = 25;
export const CARISMA_PER_FRIEND = 10;
export const CARISMA_MAX_FRIENDS = 50;

export type SocialItemKind = "comment" | "post";

/** sourceKey of a `comment_liked` entry: `${kind}:${itemId}:${likerId}` (cuids never contain ":"). */
export const likeSourceKey = (kind: SocialItemKind, itemId: string, likerId: string) => `${kind}:${itemId}:${likerId}`;
/** sourceKey of a `comment_helpful` entry. */
export const helpfulSourceKey = (kind: SocialItemKind, itemId: string) => `${kind}:${itemId}`;

/** The user who gave a like, from a `comment_liked` sourceKey. */
export const likerOf = (sourceKey: string) => sourceKey.slice(sourceKey.lastIndexOf(":") + 1);

export type RewardCheck = {
  receiverId: string | null;
  actorId: string;
  /** Entries of this source the receiver already got today (voided ones included). */
  receiverToday: number;
  /** Entries of this source between the two users today, both directions (voided included). */
  pairToday: number;
};

export type RewardDecision = { pay: true } | { pay: false; reason: "no_receiver" | "self" | "daily_cap" | "pair_cap" };

function decide(check: RewardCheck, dailyCap: number, pairCap: number): RewardDecision {
  if (!check.receiverId) return { pay: false, reason: "no_receiver" };
  if (check.receiverId === check.actorId) return { pay: false, reason: "self" };
  if (check.receiverToday >= dailyCap) return { pay: false, reason: "daily_cap" };
  if (check.pairToday >= pairCap) return { pay: false, reason: "pair_cap" };
  return { pay: true };
}

/** Whether a like pays `comment_liked` XP to the item's author. */
export const likeReward = (check: RewardCheck) => decide(check, COMMENT_LIKE_DAILY_CAP, COMMENT_LIKE_PAIR_DAILY_CAP);

/** Whether a helpful mark pays `comment_helpful` XP to the reply's author. */
export const helpfulReward = (check: RewardCheck) =>
  decide(check, COMMENT_HELPFUL_DAILY_CAP, COMMENT_HELPFUL_PAIR_DAILY_CAP);

/** Collapsed behind "ver mesmo assim": many more dislikes than likes. */
export function isCollapsed(likes: number, dislikes: number): boolean {
  return dislikes - likes >= COLLAPSE_MARGIN;
}

/** Carisma points from paid likes received, helpful replies and friends. */
export function carismaPoints(likesReceived: number, helpfulReplies: number, friends: number): number {
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  return (
    safe(likesReceived) * CARISMA_PER_LIKE +
    safe(helpfulReplies) * CARISMA_PER_HELPFUL +
    Math.min(safe(friends), CARISMA_MAX_FRIENDS) * CARISMA_PER_FRIEND
  );
}
