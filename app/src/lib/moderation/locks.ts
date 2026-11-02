import type { Prisma } from "@/generated/prisma/client";

type Db = Prisma.TransactionClient;

/** True when the moderation locked the comments of this target (DiscussionLock row). */
export async function isDiscussionLocked(db: Db, targetType: string, targetId: string): Promise<boolean> {
  const lock = await db.discussionLock.findUnique({
    where: { targetType_targetId: { targetType, targetId } },
    select: { targetId: true },
  });
  return lock !== null;
}
