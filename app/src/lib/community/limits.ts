import type { Prisma } from "@/generated/prisma/client";

/** A Prisma client or an open transaction: community functions work inside either. */
export type Db = Prisma.TransactionClient;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Simple per-user limits, counted from the rows the user already created. Rows are never
 * deleted by their authors (comments are soft-deleted), so deleting does not reset a limit.
 */
export const RATE_LIMITS = {
  /** Comments on news, guides, photos and threads. */
  comment: { max: 10, windowMs: MINUTE },
  /** Forum posts, including the first post of a new thread. */
  post: { max: 5, windowMs: MINUTE },
  /** Gallery uploads (rolling 24 hours). */
  upload: { max: 10, windowMs: DAY },
  /** New likes/dislikes on anything (and, through `takeLikeToggle`, every reaction click). */
  like: { max: 30, windowMs: MINUTE },
} as const;

export type RateLimitKind = keyof typeof RATE_LIMITS;

/** True when `userId` may create one more item of `kind` now. */
export async function withinRateLimit(
  db: Db,
  kind: RateLimitKind,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { max, windowMs } = RATE_LIMITS[kind];
  const since = { gte: new Date(now.getTime() - windowMs) };
  const where = { authorId: userId, createdAt: since };
  let count: number;
  switch (kind) {
    case "comment":
      count = await db.comment.count({ where });
      break;
    case "post":
      count = await db.forumPost.count({ where });
      break;
    case "upload":
      count = await db.photo.count({ where });
      break;
    case "like":
      count = await db.reaction.count({ where: { userId, createdAt: since } });
      break;
  }
  return count < max;
}

export const RATE_LIMIT_MESSAGES: Record<RateLimitKind, string> = {
  comment: "Você comentou muitas vezes em pouco tempo. Espere um minuto e tente de novo.",
  post: "Você postou muitas vezes em pouco tempo. Espere um minuto e tente de novo.",
  upload: "Você chegou ao limite de 10 fotos por dia. Volte amanhã para enviar mais.",
  like: "Você reagiu muitas vezes em pouco tempo. Espere um minuto e tente de novo.",
};

// Removing a reaction deletes its row, so a like/unlike loop never shows up in the table count.
// Every toggle is also counted here, per server instance (best effort: no extra table needed).
const likeToggles = new Map<string, number[]>();

/**
 * Takes one like/unlike slot for `userId` (30 per minute, sliding window, in memory).
 * Returns false when the user is over the limit.
 */
export function takeLikeToggle(userId: string, now: number = Date.now()): boolean {
  const { max, windowMs } = RATE_LIMITS.like;
  const recent = (likeToggles.get(userId) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= max) {
    likeToggles.set(userId, recent);
    return false;
  }
  recent.push(now);
  likeToggles.set(userId, recent);
  // Keep the map small: forget users with no recent clicks.
  if (likeToggles.size > 10_000) {
    for (const [key, times] of likeToggles) {
      if (times.every((t) => t <= now - windowMs)) likeToggles.delete(key);
    }
  }
  return true;
}
