import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { containsHtml, HTML_MESSAGE, normalizeText } from "@/lib/community/text";
import { MODERATION_REASON_MAX } from "./permissions";

type Db = Prisma.TransactionClient;

/** Optional reason a moderator gives (plain text, shown to the owner and kept in the history). */
export const moderationReasonSchema = z
  .string()
  .transform(normalizeText)
  .pipe(
    z
      .string()
      .max(MODERATION_REASON_MAX, `O motivo pode ter no máximo ${MODERATION_REASON_MAX} caracteres.`)
      .refine((value) => !containsHtml(value), HTML_MESSAGE),
  )
  .optional();

/**
 * Tells the owner of moderated content what happened (Notification kind "moderation"). Nothing
 * happens when the owner is unknown (deleted account) or is the moderator themselves.
 */
export async function notifyOwner(
  db: Db,
  input: { userId: string | null; actorId: string; title: string; reason?: string | null; href?: string | null },
): Promise<void> {
  if (!input.userId || input.userId === input.actorId) return;
  await db.notification.create({
    data: {
      userId: input.userId,
      kind: "moderation",
      title: input.title,
      body: input.reason ? `Motivo: ${input.reason}` : null,
      href: input.href ?? null,
    },
  });
}
