import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/community/limits";
import { plainText } from "@/lib/community/text";
import { isBlockedEither, pairOf } from "./relations";
import { MESSAGE_MAX, type MessageView } from "./types";

/**
 * Private messages (Plano 4, F9): 1:1 conversations, plain text, per-user only (never in public
 * pages or caches). Each side of a Conversation has its own unread flag, "apagar para mim" time
 * and inbox visibility (columns prefixed `low`/`high` after the side's user).
 */

export { MESSAGE_MAX };
export type { MessageView };
export const messageBodySchema = plainText(1, MESSAGE_MAX, "A mensagem");

export const DM_POLICIES = ["everyone", "following", "friends"] as const;
export type DmPolicy = (typeof DM_POLICIES)[number];
export const DM_POLICY_LABEL: Record<DmPolicy, string> = {
  everyone: "Qualquer pessoa",
  following: "Só quem eu sigo",
  friends: "Só amigos",
};

/** Sending limits, counted from the messages the user sent (they are never deleted by the sender alone). */
export const MESSAGE_LIMITS = {
  perMinute: 10,
  perDay: 300,
  /** Conversations a user may start per rolling day. */
  newConversationsPerDay: 20,
} as const;

/** Messages per page of a conversation (newest page first). */
export const MESSAGES_PAGE_SIZE = 50;
export const INBOX_PAGE_SIZE = 30;

type Side = "low" | "high";

const sideOf = (conversation: { userLowId: string | null }, userId: string): Side =>
  conversation.userLowId === userId ? "low" : "high";

const unreadOf = (side: Side, value: boolean) => (side === "low" ? { lowUnread: value } : { highUnread: value });
const clearOf = (side: Side, at: Date) =>
  side === "low"
    ? { lowClearedAt: at, lowHidden: true, lowUnread: false }
    : { highClearedAt: at, highHidden: true, highUnread: false };

export type CanMessage =
  | { ok: true }
  | { ok: false; reason: "self" | "not_found" | "blocked" | "policy_following" | "policy_friends" };

/**
 * Whether `senderId` may message `recipientId`: never across a block (either way), and only as the
 * recipient's "Quem pode me mandar mensagem" allows (`following`: people the recipient follows;
 * `friends`: accepted friends).
 */
export async function canMessage(db: Db, senderId: string, recipientId: string): Promise<CanMessage> {
  if (senderId === recipientId) return { ok: false, reason: "self" };
  const recipient = await db.user.findUnique({ where: { id: recipientId }, select: { dmPolicy: true } });
  if (!recipient) return { ok: false, reason: "not_found" };
  if (await isBlockedEither(db, senderId, recipientId)) return { ok: false, reason: "blocked" };
  if (recipient.dmPolicy === "following") {
    const follows = await db.follow.count({ where: { followerId: recipientId, followeeId: senderId } });
    if (follows === 0) return { ok: false, reason: "policy_following" };
  } else if (recipient.dmPolicy === "friends") {
    const friends = await db.friendship.count({ where: { ...pairOf(senderId, recipientId), acceptedAt: { not: null } } });
    if (friends === 0) return { ok: false, reason: "policy_friends" };
  }
  return { ok: true };
}

export const CAN_MESSAGE_TEXT: Record<Exclude<CanMessage, { ok: true }>["reason"], string> = {
  self: "Você não pode mandar mensagem para si mesmo.",
  not_found: "Essa conta não existe mais.",
  blocked: "Não é possível trocar mensagens com essa pessoa.",
  policy_following: "Essa pessoa só recebe mensagens de quem ela segue.",
  policy_friends: "Essa pessoa só recebe mensagens de amigos.",
};

export type SendResult =
  | { status: "ok"; message: MessageView; conversationId: string }
  | { status: "denied"; reason: Exclude<CanMessage, { ok: true }>["reason"] }
  | { status: "rate_limited"; message: string };


async function withinLimits(db: Db, senderId: string, startsConversation: boolean, now: Date) {
  const minuteAgo = new Date(now.getTime() - 60_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [lastMinute, lastDay] = await Promise.all([
    db.directMessage.count({ where: { senderId, createdAt: { gte: minuteAgo } } }),
    db.directMessage.count({ where: { senderId, createdAt: { gte: dayAgo } } }),
  ]);
  if (lastMinute >= MESSAGE_LIMITS.perMinute) {
    return "Você mandou muitas mensagens em pouco tempo. Espere um minuto e tente de novo.";
  }
  if (lastDay >= MESSAGE_LIMITS.perDay) return "Você chegou ao limite de mensagens de hoje. Volte amanhã.";
  if (startsConversation) {
    // Conversations whose first message is the sender's, started in the last day.
    const started = await db.conversation.count({
      where: {
        createdAt: { gte: dayAgo },
        OR: [{ userLowId: senderId }, { userHighId: senderId }],
        messages: { some: { senderId, createdAt: { gte: dayAgo } } },
      },
    });
    if (started >= MESSAGE_LIMITS.newConversationsPerDay) {
      return "Você começou muitas conversas hoje. Volte amanhã para falar com mais gente.";
    }
  }
  return null;
}

/**
 * Sends a plain-text message (body validated by `messageBodySchema`), creating the conversation on
 * the first one. The conversation comes back to both inboxes; the recipient's side is unread.
 * Run inside a transaction.
 */
export async function sendMessage(
  db: Db,
  senderId: string,
  recipientId: string,
  body: string,
  now: Date = new Date(),
): Promise<SendResult> {
  const allowed = await canMessage(db, senderId, recipientId);
  if (!allowed.ok) return { status: "denied", reason: allowed.reason };
  const pair = pairOf(senderId, recipientId);
  const existing = await db.conversation.findUnique({ where: { userLowId_userHighId: pair }, select: { id: true } });
  const limited = await withinLimits(db, senderId, !existing, now);
  if (limited) return { status: "rate_limited", message: limited };

  const mine = sideOf(pair, senderId);
  const theirs: Side = mine === "low" ? "high" : "low";
  const conversation = await db.conversation.upsert({
    where: { userLowId_userHighId: pair },
    create: { ...pair, createdAt: now, lastMessageAt: now, ...unreadOf(theirs, true) },
    update: {
      lastMessageAt: now,
      ...unreadOf(theirs, true),
      ...unreadOf(mine, false),
      lowHidden: false,
      highHidden: false,
    },
    select: { id: true },
  });
  const message = await db.directMessage.create({
    data: { conversationId: conversation.id, senderId, body, createdAt: now },
    select: { id: true, body: true, createdAt: true, sender: { select: { handle: true } } },
  });
  return {
    status: "ok",
    conversationId: conversation.id,
    message: { id: message.id, body: message.body, createdAt: message.createdAt, mine: true, senderHandle: message.sender?.handle ?? null },
  };
}

export type InboxRow = {
  conversationId: string;
  other: { id: string; handle: string; displayName: string; avatarUrl: string | null } | null;
  lastMessageAt: Date;
  unread: boolean;
  /** Preview of the latest message visible to the user. */
  preview: string | null;
  lastFromMe: boolean;
};

const otherSelect = { id: true, handle: true, displayName: true, avatarUrl: true } as const;

function sideWhere(userId: string): Prisma.ConversationWhereInput {
  return {
    OR: [
      { userLowId: userId, lowHidden: false },
      { userHighId: userId, highHidden: false },
    ],
  };
}

/** The user's conversations, most recent first (deleted-for-me ones stay out until a new message). */
export async function listInbox(
  db: Db,
  userId: string,
  requestedPage = 1,
): Promise<{ rows: InboxRow[]; page: number; pageCount: number; total: number }> {
  const where = sideWhere(userId);
  const total = await db.conversation.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);
  const conversations = await db.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * INBOX_PAGE_SIZE,
    take: INBOX_PAGE_SIZE,
    select: {
      id: true,
      userLowId: true,
      userHighId: true,
      lastMessageAt: true,
      lowUnread: true,
      highUnread: true,
      lowClearedAt: true,
      highClearedAt: true,
      userLow: { select: otherSelect },
      userHigh: { select: otherSelect },
    },
  });
  const rows = await Promise.all(
    conversations.map(async (c) => {
      const side = sideOf(c, userId);
      const clearedAt = side === "low" ? c.lowClearedAt : c.highClearedAt;
      const last = await db.directMessage.findFirst({
        where: { conversationId: c.id, ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { body: true, senderId: true },
      });
      return {
        conversationId: c.id,
        other: side === "low" ? c.userHigh : c.userLow,
        lastMessageAt: c.lastMessageAt,
        unread: side === "low" ? c.lowUnread : c.highUnread,
        preview: last?.body ?? null,
        lastFromMe: last?.senderId === userId,
      };
    }),
  );
  return { rows, page, pageCount, total };
}

/** Conversations with unread messages (header badge). */
export async function unreadConversations(db: Db, userId: string): Promise<number> {
  return db.conversation.count({
    where: {
      OR: [
        { userLowId: userId, lowUnread: true, lowHidden: false },
        { userHighId: userId, highUnread: true, highHidden: false },
      ],
    },
  });
}

export type ConversationView = {
  conversationId: string | null;
  messages: MessageView[];
  /** Id of the oldest message shown, when older ones exist (load them with `before`). */
  olderCursor: string | null;
};

/**
 * Messages between the user and `otherId` the user can still see (after their "apagar para mim"),
 * oldest first, at most one page; `before` (a message id) pages back. Marks the user's side read.
 */
export async function openConversation(
  db: Db,
  userId: string,
  otherId: string,
  before?: string | null,
): Promise<ConversationView> {
  const pair = pairOf(userId, otherId);
  const conversation = await db.conversation.findUnique({
    where: { userLowId_userHighId: pair },
    select: { id: true, userLowId: true, lowClearedAt: true, highClearedAt: true, lowUnread: true, highUnread: true },
  });
  if (!conversation) return { conversationId: null, messages: [], olderCursor: null };
  const side = sideOf(conversation, userId);
  const clearedAt = side === "low" ? conversation.lowClearedAt : conversation.highClearedAt;
  const cursorAt = before
    ? (await db.directMessage.findFirst({ where: { id: before, conversationId: conversation.id }, select: { createdAt: true } }))
        ?.createdAt
    : undefined;
  const rows = await db.directMessage.findMany({
    where: {
      conversationId: conversation.id,
      createdAt: { ...(clearedAt ? { gt: clearedAt } : {}), ...(cursorAt ? { lt: cursorAt } : {}) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGES_PAGE_SIZE + 1,
    select: { id: true, body: true, createdAt: true, senderId: true, sender: { select: { handle: true } } },
  });
  const page = rows.slice(0, MESSAGES_PAGE_SIZE).reverse();
  if (side === "low" ? conversation.lowUnread : conversation.highUnread) {
    await db.conversation.update({ where: { id: conversation.id }, data: unreadOf(side, false) });
  }
  return {
    conversationId: conversation.id,
    messages: page.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      mine: m.senderId === userId,
      senderHandle: m.sender?.handle ?? null,
    })),
    olderCursor: rows.length > MESSAGES_PAGE_SIZE ? page[0].id : null,
  };
}

/**
 * "Apagar conversa para mim": hides every message so far from the user and drops the conversation
 * from their inbox until a new message arrives. When neither side can see any message anymore
 * (both deleted it, or the other account no longer exists), the conversation is deleted for good.
 */
export async function clearConversation(db: Db, userId: string, conversationId: string, now: Date = new Date()) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, OR: [{ userLowId: userId }, { userHighId: userId }] },
    select: { id: true, userLowId: true, userHighId: true, lowClearedAt: true, highClearedAt: true },
  });
  if (!conversation) return { status: "not_found" as const };
  const side = sideOf(conversation, userId);
  const otherCleared = side === "low" ? conversation.highClearedAt : conversation.lowClearedAt;
  const otherGone = (side === "low" ? conversation.userHighId : conversation.userLowId) === null;
  const lastAt = (
    await db.directMessage.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
  )?.createdAt;
  if (otherGone || (otherCleared && (!lastAt || lastAt <= otherCleared))) {
    await db.conversation.delete({ where: { id: conversationId } });
    return { status: "ok" as const, deleted: true };
  }
  await db.conversation.update({
    where: { id: conversationId },
    data: clearOf(side, now),
  });
  return { status: "ok" as const, deleted: false };
}
