import type { Db } from "./limits";

type NotificationInput = {
  /** Who receives it; nothing happens when null (deleted account) or equal to `actorId`. */
  userId: string | null;
  actorId: string;
  kind: "comment_reply" | "forum_reply" | "thread_solved" | "photo_like";
  title: string;
  body?: string;
  href: string;
};

const PREVIEW_LENGTH = 140;

/** Short plain-text preview for a notification body. */
export function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

/** Creates an in-site notification for community activity on someone else's content. */
export async function notify(db: Db, input: NotificationInput): Promise<void> {
  if (!input.userId || input.userId === input.actorId) return;
  await db.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href,
    },
  });
}
