import type { Prisma } from "@/generated/prisma/client";

/** A Prisma client or an open transaction: community functions work inside either. */
export type Db = Prisma.TransactionClient;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Simple per-user limits, counted from the rows the user already created. */
export const RATE_LIMITS = {
  /** Comments on news, guides, photos and threads. */
  comment: { max: 10, windowMs: MINUTE },
  /** Forum posts, including the first post of a new thread. */
  post: { max: 5, windowMs: MINUTE },
  /** Gallery uploads (rolling 24 hours). */
  upload: { max: 10, windowMs: DAY },
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
  const where = { authorId: userId, createdAt: { gte: new Date(now.getTime() - windowMs) } };
  const count =
    kind === "comment"
      ? await db.comment.count({ where })
      : kind === "post"
        ? await db.forumPost.count({ where })
        : await db.photo.count({ where });
  return count < max;
}

export const RATE_LIMIT_MESSAGES: Record<RateLimitKind, string> = {
  comment: "Você comentou muitas vezes em pouco tempo. Espere um minuto e tente de novo.",
  post: "Você postou muitas vezes em pouco tempo. Espere um minuto e tente de novo.",
  upload: "Você chegou ao limite de 10 fotos por dia. Volte amanhã para enviar mais.",
};
