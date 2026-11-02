"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { photoTag } from "./cached";
import { listReplies, type CommentView } from "./comments";
import { RATE_LIMIT_MESSAGES, takeLikeToggle } from "./limits";
import { myReactions, react, reactSchema, type MyReaction, type ReactionCounts } from "./reactions";

// Server Actions of replies and reactions (items 09 and 17). Same failure shapes as ./actions.

type Failure =
  | { status: "unauthenticated"; message: string }
  | { status: "invalid"; message: string }
  | { status: "not_found"; message: string }
  | { status: "rate_limited"; message: string };

const NOT_FOUND: Failure = { status: "not_found", message: "Isso não existe mais ou foi removido." };

export type ReactOk = { status: "ok"; mine: MyReaction; counts: ReactionCounts };

/**
 * Like (value 1) or dislike (value -1) an article, comment, photo or guide; the same value again
 * removes it. Every click takes a slot of the in-memory per-user limit before the database.
 */
export async function reactTo(raw: unknown): Promise<ReactOk | Failure> {
  const user = await getSessionUser();
  if (!user) return { status: "unauthenticated", message: "Entre na sua conta para reagir." };
  const parsed = reactSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", message: "Dados inválidos." };
  if (!takeLikeToggle(user.id)) return { status: "rate_limited", message: RATE_LIMIT_MESSAGES.like };

  const { targetType, targetId, value } = parsed.data;
  const result = await prisma.$transaction((tx) => react(tx, user.id, targetType, targetId, value));
  if (result.status === "not_found") return NOT_FOUND;
  if (result.status === "rate_limited") return { status: "rate_limited", message: RATE_LIMIT_MESSAGES.like };
  // The photo page caches its counts; articles, guides and comments read them live.
  if (targetType === "photo") updateTag(photoTag(targetId));
  return { status: "ok", mine: result.mine, counts: result.counts };
}

const repliesSchema = z.object({ commentId: z.string().min(1).max(64) });

/** Every reply of a top-level comment (public), with the viewer's reactions to them. */
export async function loadReplies(
  raw: unknown,
): Promise<{ status: "ok"; replies: CommentView[]; mine: Record<string, 1 | -1> } | Failure> {
  const parsed = repliesSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", message: "Dados inválidos." };
  const [replies, user] = await Promise.all([listReplies(prisma, parsed.data.commentId), getSessionUser()]);
  const mine = user ? await myReactions(prisma, user.id, "comment", replies.map((r) => r.id)) : {};
  return { status: "ok", replies, mine };
}
