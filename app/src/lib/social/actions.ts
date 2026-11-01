"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { threadTag } from "@/lib/community/cached";
import { takeLikeToggle } from "@/lib/community/limits";
import { recomputeQuietly } from "@/lib/community/xp";
import { prisma } from "@/lib/db";
import { itemRefSchema } from "./items";
import { CAN_MESSAGE_TEXT, clearConversation, DM_POLICIES, messageBodySchema, sendMessage, type MessageView } from "./messages";
import { markHelpful, react, reactSchema } from "./reactions";
import {
  acceptFriendship,
  blockUser,
  endFriendship,
  follow,
  requestFriendship,
  unblockUser,
  unfollow,
  type FriendRequestResult,
} from "./relations";

/** Failures carry a pt-BR message ready to show. */
export type SocialFailure = { status: "error"; message: string };

const LOGIN: SocialFailure = { status: "error", message: "Entre na sua conta para continuar." };
const INVALID: SocialFailure = { status: "error", message: "Dados inválidos." };
const GONE: SocialFailure = { status: "error", message: "Isso não existe mais ou foi removido." };
const BLOCKED: SocialFailure = { status: "error", message: "Não é possível interagir com essa pessoa." };
const TOO_FAST: SocialFailure = { status: "error", message: "Muitos cliques em pouco tempo. Espere um minuto e tente de novo." };

async function session<S extends z.ZodType>(schema: S, raw: unknown) {
  const user = await getSessionUser();
  if (!user) return { ok: false, failure: LOGIN } as const;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, failure: { status: "error", message: parsed.error.issues[0]?.message ?? INVALID.message } as SocialFailure } as const;
  }
  return { ok: true, user, data: parsed.data as z.output<S> } as const;
}

// ---------- Reactions and helpful replies ----------

/** Curtir/descurtir a comment or forum post (click again to undo). */
export async function reactAction(
  raw: unknown,
): Promise<{ status: "ok"; mine: 1 | -1 | 0; likeCount: number; dislikeCount: number } | SocialFailure> {
  const ready = await session(reactSchema, raw);
  if (!ready.ok) return ready.failure;
  if (!takeLikeToggle(ready.user.id)) return TOO_FAST;
  const result = await prisma.$transaction((tx) => react(tx, ready.user.id, ready.data));
  if (result.status === "not_found") return GONE;
  if (result.status === "own") return { status: "error", message: "Você não pode reagir ao que você mesmo escreveu." };
  if (result.status === "blocked") return BLOCKED;
  if (result.paidTo) await recomputeQuietly(result.paidTo);
  // The forum thread page is cached with its counters (comments are read per request).
  if (result.threadId) updateTag(threadTag(result.threadId));
  return { status: "ok", mine: result.mine, likeCount: result.likeCount, dislikeCount: result.dislikeCount };
}

/** "Útil": the parent's author marks a reply as helpful. */
export async function markHelpfulAction(raw: unknown): Promise<{ status: "ok" } | SocialFailure> {
  const ready = await session(itemRefSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await prisma.$transaction((tx) => markHelpful(tx, ready.user.id, ready.data));
  switch (result.status) {
    case "not_found":
      return GONE;
    case "forbidden":
      return { status: "error", message: "Só quem escreveu o comentário respondido pode marcar a resposta como útil." };
    case "own":
      return { status: "error", message: "Marque a resposta de outra pessoa." };
    case "already":
      return { status: "error", message: "Essa resposta já foi marcada como útil." };
  }
  if (result.paidTo) await recomputeQuietly(result.paidTo);
  if (result.threadId) updateTag(threadTag(result.threadId));
  return { status: "ok" };
}

// ---------- Follows, friends, blocks ----------

const userIdSchema = z.object({ userId: z.string().min(1).max(64) });
const followSchema = userIdSchema.extend({ follow: z.boolean() });
const friendSchema = userIdSchema.extend({ op: z.enum(["request", "accept", "decline", "cancel", "remove"]) });
const blockSchema = userIdSchema.extend({ block: z.boolean() });

function relationFailure(status: string): SocialFailure | null {
  if (status === "self") return { status: "error", message: "Essa é a sua própria conta." };
  if (status === "not_found") return GONE;
  if (status === "blocked") return BLOCKED;
  if (status === "rate_limited") return { status: "error", message: "Você mandou muitos pedidos de amizade hoje. Volte amanhã." };
  return null;
}

/** Seguir / deixar de seguir. */
export async function followAction(raw: unknown): Promise<{ status: "ok" } | SocialFailure> {
  const ready = await session(followSchema, raw);
  if (!ready.ok) return ready.failure;
  if (!takeLikeToggle(`follow:${ready.user.id}`)) return TOO_FAST;
  const { userId, follow: on } = ready.data;
  const result = on ? await prisma.$transaction((tx) => follow(tx, ready.user.id, userId)) : await unfollow(prisma, ready.user.id, userId);
  const failure = relationFailure(result.status);
  if (failure) return failure;
  refresh();
  return { status: "ok" };
}

const FRIEND_MESSAGES: Partial<Record<FriendRequestResult["status"], string>> = {
  requested: "Pedido enviado. Você já está seguindo essa pessoa.",
  accepted: "Agora vocês são amigos e seguem um ao outro.",
  already_friends: "Vocês já são amigos.",
  already_requested: "Você já mandou um pedido. Aguarde a resposta.",
};

/** Pedido de amizade: request, accept, decline, cancel or remove (ending keeps the follows). */
export async function friendAction(raw: unknown): Promise<{ status: "ok"; message?: string } | SocialFailure> {
  const ready = await session(friendSchema, raw);
  if (!ready.ok) return ready.failure;
  if (!takeLikeToggle(`friend:${ready.user.id}`)) return TOO_FAST;
  const me = ready.user.id;
  const { userId, op } = ready.data;
  let message: string | undefined;
  let friendsChanged = false;
  if (op === "request" || op === "accept") {
    const result = await prisma.$transaction((tx) =>
      op === "request" ? requestFriendship(tx, me, userId) : acceptFriendship(tx, me, userId),
    );
    const failure = relationFailure(result.status);
    if (failure) return op === "accept" && result.status === "not_found" ? { status: "error", message: "Esse pedido não existe mais." } : failure;
    message = FRIEND_MESSAGES[result.status];
    friendsChanged = result.status === "accepted";
  } else {
    const result = await endFriendship(prisma, me, userId);
    friendsChanged = result.wasFriend;
    message = op === "remove" ? "Amizade desfeita. Vocês continuam se seguindo até alguém deixar de seguir." : undefined;
  }
  // Carisma counts friends.
  if (friendsChanged) await Promise.all([recomputeQuietly(me), recomputeQuietly(userId)]);
  refresh();
  return { status: "ok", message };
}

/** Bloquear / desbloquear. Blocking ends follows and friendship both ways. */
export async function blockAction(raw: unknown): Promise<{ status: "ok" } | SocialFailure> {
  const ready = await session(blockSchema, raw);
  if (!ready.ok) return ready.failure;
  const me = ready.user.id;
  const { userId, block } = ready.data;
  if (block) {
    const result = await prisma.$transaction((tx) => blockUser(tx, me, userId));
    const failure = relationFailure(result.status);
    if (failure) return failure;
    if (result.wasFriend) await Promise.all([recomputeQuietly(me), recomputeQuietly(userId)]);
  } else {
    await unblockUser(prisma, me, userId);
  }
  refresh();
  return { status: "ok" };
}

// ---------- Private messages ----------

const sendSchema = z.object({ to: z.string().min(1).max(64), body: messageBodySchema });

/** Sends a private message to the user with id `to`. */
export async function sendMessageAction(raw: unknown): Promise<{ status: "ok"; message: MessageView } | SocialFailure> {
  const ready = await session(sendSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await prisma.$transaction((tx) => sendMessage(tx, ready.user.id, ready.data.to, ready.data.body));
  if (result.status === "denied") return { status: "error", message: CAN_MESSAGE_TEXT[result.reason] };
  if (result.status === "rate_limited") return { status: "error", message: result.message };
  return { status: "ok", message: result.message };
}

/** "Apagar conversa para mim". */
export async function clearConversationAction(raw: unknown): Promise<{ status: "ok" } | SocialFailure> {
  const ready = await session(z.object({ conversationId: z.string().min(1).max(64) }), raw);
  if (!ready.ok) return ready.failure;
  const result = await prisma.$transaction((tx) => clearConversation(tx, ready.user.id, ready.data.conversationId));
  if (result.status === "not_found") return GONE;
  return { status: "ok" };
}

/** "Quem pode me mandar mensagem" (/conta). */
export async function setDmPolicyAction(raw: unknown): Promise<{ status: "ok" } | SocialFailure> {
  const ready = await session(z.object({ policy: z.enum(DM_POLICIES) }), raw);
  if (!ready.ok) return ready.failure;
  await prisma.user.update({ where: { id: ready.user.id }, data: { dmPolicy: ready.data.policy } });
  return { status: "ok" };
}
