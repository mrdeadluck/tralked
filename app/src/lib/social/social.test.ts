import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moderateContent } from "@/lib/admin/moderation";
import { createComment, deleteComment, listComments } from "@/lib/community/comments";
import { createPost } from "@/lib/community/forum";
import { prisma } from "@/lib/db";
import { COMMENT_HELPFUL_XP, COMMENT_LIKE_XP } from "@/lib/engine/social";
import { recomputeUser } from "@/lib/progression/recompute";
import { getFeed } from "./feed";
import { clearConversation, listInbox, openConversation, sendMessage, unreadConversations } from "./messages";
import { markHelpful, react } from "./reactions";
import {
  acceptFriendship,
  blockUser,
  endFriendship,
  follow,
  getRelationship,
  requestFriendship,
  socialCounts,
} from "./relations";

// Test database only (vitest.db-guard.ts). Users use the `test_social_` prefix and are removed.

const PREFIX = "test_social_";
const MARK = "social-test";
const DAY1 = new Date("2026-10-20T15:00:00Z");

let n = 0;
async function user(label: string, data: { profilePublic?: boolean; dmPolicy?: string } = {}) {
  n++;
  return prisma.user.create({
    data: { handle: `${PREFIX}${label}${n}`, displayName: `Pessoa ${label}`, profilePublic: true, ...data },
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { handle: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.conversation.deleteMany({
    where: { OR: [{ userLowId: { in: ids } }, { userHighId: { in: ids } }, { messages: { some: { body: { contains: MARK } } } }] },
  });
  await prisma.comment.deleteMany({ where: { body: { contains: MARK } } });
  await prisma.forumThread.deleteMany({ where: { title: { contains: MARK } } });
  await prisma.report.deleteMany({ where: { reporterId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function ledger(userId: string, source: string) {
  return prisma.xpLedgerEntry.findMany({ where: { userId, source }, orderBy: { createdAt: "asc" } });
}

let articleId: string;

beforeAll(async () => {
  await cleanup();
  articleId = (await prisma.article.findFirstOrThrow({ where: { status: "published" }, select: { id: true } })).id;
});
afterAll(cleanup);

async function comment(authorId: string, body: string, parentId?: string) {
  const result = await createComment(prisma, authorId, { targetType: "article", targetId: articleId, body: `${body} ${MARK}`, parentId });
  if (result.status !== "ok") throw new Error(`comment failed: ${result.status}`);
  return result.comment;
}

describe("follows, friendships and blocks", () => {
  it("following needs no approval and notifies once while unread", async () => {
    const a = await user("a");
    const b = await user("b");
    expect(await follow(prisma, a.id, b.id)).toEqual({ status: "ok" });
    expect(await follow(prisma, a.id, b.id)).toEqual({ status: "ok" });
    expect(await follow(prisma, a.id, a.id)).toEqual({ status: "self" });
    expect(await socialCounts(prisma, b.id)).toEqual({ followers: 1, following: 0, friends: 0 });
    expect(await prisma.notification.count({ where: { userId: b.id, kind: "follow" } })).toBe(1);
  });

  it("a friend request follows; accepting makes both follow; ending keeps the follows", async () => {
    const a = await user("a");
    const b = await user("b");
    expect(await requestFriendship(prisma, a.id, b.id)).toEqual({ status: "requested" });
    expect(await getRelationship(prisma, a.id, b.id)).toMatchObject({ following: true, followedBy: false, friendship: "sent" });
    expect(await getRelationship(prisma, b.id, a.id)).toMatchObject({ friendship: "received" });
    expect(await acceptFriendship(prisma, b.id, a.id)).toEqual({ status: "accepted" });
    expect(await getRelationship(prisma, a.id, b.id)).toMatchObject({ following: true, followedBy: true, friendship: "friends" });
    expect(await endFriendship(prisma, a.id, b.id)).toEqual({ status: "ok", wasFriend: true });
    expect(await getRelationship(prisma, a.id, b.id)).toMatchObject({ following: true, followedBy: true, friendship: "none" });
  });

  it("asking someone who already asked accepts their request", async () => {
    const a = await user("a");
    const b = await user("b");
    await requestFriendship(prisma, a.id, b.id);
    expect(await requestFriendship(prisma, b.id, a.id)).toEqual({ status: "accepted" });
    expect((await socialCounts(prisma, a.id)).friends).toBe(1);
  });

  it("blocking ends follows and friendship both ways and refuses new ones", async () => {
    const a = await user("a");
    const b = await user("b");
    await requestFriendship(prisma, a.id, b.id);
    await acceptFriendship(prisma, b.id, a.id);
    expect(await blockUser(prisma, b.id, a.id)).toEqual({ status: "ok", wasFriend: true });
    expect(await getRelationship(prisma, a.id, b.id)).toEqual({
      following: false,
      followedBy: false,
      friendship: "none",
      blocked: false,
      blockedBy: true,
    });
    expect(await follow(prisma, a.id, b.id)).toEqual({ status: "blocked" });
    expect(await requestFriendship(prisma, a.id, b.id)).toEqual({ status: "blocked" });
  });
});

describe("reactions and rewards", () => {
  it("a like pays the author (not the liker); unliking and liking again never pays twice; dislikes take nothing", async () => {
    const author = await user("autor");
    const fan = await user("fa");
    const c = await comment(author.id, "comentário");
    const like = { kind: "comment" as const, id: c.id, value: 1 as const };

    expect(await react(prisma, fan.id, like, DAY1)).toMatchObject({ status: "ok", mine: 1, likeCount: 1, paidTo: author.id });
    expect(await react(prisma, fan.id, like, DAY1)).toMatchObject({ status: "ok", mine: 0, likeCount: 0, paidTo: null });
    expect(await react(prisma, fan.id, like, DAY1)).toMatchObject({ status: "ok", mine: 1, likeCount: 1, paidTo: null });
    expect(await react(prisma, fan.id, { ...like, value: -1 }, DAY1)).toMatchObject({ mine: -1, likeCount: 0, dislikeCount: 1 });

    const entries = await ledger(author.id, "comment_liked");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ xp: COMMENT_LIKE_XP, sourceKey: `comment:${c.id}:${fan.id}`, voidedAt: null });
    expect(await prisma.xpLedgerEntry.count({ where: { userId: fan.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: author.id, kind: "comment_like" } })).toBe(1);
  });

  it("refuses reacting to one's own comment", async () => {
    const author = await user("autor");
    const c = await comment(author.id, "meu");
    expect(await react(prisma, author.id, { kind: "comment", id: c.id, value: 1 }, DAY1)).toEqual({ status: "own" });
  });

  it("a pair stops earning after 3 likes a day, both directions together", async () => {
    const a = await user("a");
    const b = await user("b");
    const byA = await Promise.all([1, 2, 3].map((i) => comment(a.id, `a${i}`)));
    const byB = await Promise.all([1, 2].map((i) => comment(b.id, `b${i}`)));
    // b likes 2 of a's; a likes 1 of b's: 3 paid. The 4th like between them (any direction) is not.
    for (const c of byA.slice(0, 2)) await react(prisma, b.id, { kind: "comment", id: c.id, value: 1 }, DAY1);
    await react(prisma, a.id, { kind: "comment", id: byB[0].id, value: 1 }, DAY1);
    expect(await react(prisma, b.id, { kind: "comment", id: byA[2].id, value: 1 }, DAY1)).toMatchObject({ paidTo: null });
    expect(await react(prisma, a.id, { kind: "comment", id: byB[1].id, value: 1 }, DAY1)).toMatchObject({ paidTo: null });
    expect((await ledger(a.id, "comment_liked")).length + (await ledger(b.id, "comment_liked")).length).toBe(3);
    // The next day the pair earns again.
    const nextDay = new Date(DAY1.getTime() + 86_400_000);
    const fresh = await comment(a.id, "dia seguinte");
    expect(await react(prisma, b.id, { kind: "comment", id: fresh.id, value: 1 }, nextDay)).toMatchObject({ paidTo: a.id });
  });

  it("a receiver earns at most 10 likes a day", async () => {
    const star = await user("estrela");
    const c = await comment(star.id, "popular");
    const fans = await Promise.all(Array.from({ length: 11 }, (_, i) => user(`fa${i}`)));
    for (const fan of fans) await react(prisma, fan.id, { kind: "comment", id: c.id, value: 1 }, DAY1);
    expect(await ledger(star.id, "comment_liked")).toHaveLength(10);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).likeCount).toBe(11);
  });

  it("only the parent's author marks a reply helpful, once, paying the reply's author", async () => {
    const asker = await user("pergunta");
    const helper = await user("ajuda");
    const other = await user("outro");
    const root = await comment(asker.id, "como passo do chefe?");
    const answer = await comment(helper.id, "use fogo", root.id);
    const ref = { kind: "comment" as const, id: answer.id };
    expect(await markHelpful(prisma, other.id, ref, DAY1)).toEqual({ status: "forbidden" });
    expect(await markHelpful(prisma, asker.id, { kind: "comment", id: root.id }, DAY1)).toEqual({ status: "not_found" });
    expect(await markHelpful(prisma, asker.id, ref, DAY1)).toMatchObject({ status: "ok", paidTo: helper.id });
    expect(await markHelpful(prisma, asker.id, ref, DAY1)).toEqual({ status: "already" });
    expect(await ledger(helper.id, "comment_helpful")).toEqual([
      expect.objectContaining({ xp: COMMENT_HELPFUL_XP, sourceKey: `comment:${answer.id}` }),
    ]);
    // A second helpful mark between the same pair that day does not pay.
    const answer2 = await comment(helper.id, "ou gelo", root.id);
    expect(await markHelpful(prisma, asker.id, { kind: "comment", id: answer2.id }, DAY1)).toMatchObject({ paidTo: null });
  });

  it("deleting or removing an item voids the XP it earned, and Carisma follows the ledger", async () => {
    const author = await user("autor");
    const fan = await user("fa");
    const mod = await prisma.user.create({ data: { handle: `${PREFIX}mod${++n}`, displayName: "Mod", role: "editor" } });
    const c1 = await comment(author.id, "um");
    const c2 = await comment(author.id, "dois");
    await react(prisma, fan.id, { kind: "comment", id: c1.id, value: 1 }, DAY1);
    await react(prisma, fan.id, { kind: "comment", id: c2.id, value: 1 }, DAY1);
    await recomputeUser(author.id, DAY1);
    const carisma = async () =>
      (await prisma.attributeProgress.findUniqueOrThrow({ where: { userId_attribute: { userId: author.id, attribute: "carisma" } } })).points;
    expect(await carisma()).toBe(10);

    expect(await deleteComment(prisma, author.id, c1.id, DAY1)).toMatchObject({ status: "ok", xpVoided: 1 });
    const removed = await moderateContent({ targetType: "comment", targetId: c2.id, action: "remove" }, mod.id, DAY1);
    expect(removed).toMatchObject({ ok: true, voided: 1, recompute: [author.id] });
    expect((await ledger(author.id, "comment_liked")).every((e) => e.voidedAt !== null)).toBe(true);
    await recomputeUser(author.id, DAY1);
    expect(await carisma()).toBe(0);
  });

  it("forum posts take reactions and threaded replies; a removed thread voids its posts' XP", async () => {
    const author = await user("forum");
    const fan = await user("fa");
    const mod = await prisma.user.create({ data: { handle: `${PREFIX}mod${++n}`, displayName: "Mod", role: "editor" } });
    const thread = await prisma.forumThread.create({
      data: { authorId: author.id, title: `Tópico ${MARK}`, slug: "topico", posts: { create: { authorId: author.id, body: "abertura" } } },
      include: { posts: true },
    });
    const opening = thread.posts[0];
    const reply = await createPost(prisma, fan.id, { threadId: thread.id, body: `resposta ${MARK}`, parentId: opening.id });
    expect(reply).toMatchObject({ status: "ok", post: { parentId: opening.id } });
    expect(await react(prisma, fan.id, { kind: "post", id: opening.id, value: 1 }, DAY1)).toMatchObject({ paidTo: author.id, threadId: thread.id });
    const result = await moderateContent({ targetType: "thread", targetId: thread.id, action: "remove" }, mod.id, DAY1);
    expect(result).toMatchObject({ ok: true, voided: 1 });
  });
});

describe("threads, mentions and blocks", () => {
  it("replies go two levels deep; answering a 2nd-level reply adds a sibling", async () => {
    const a = await user("a");
    const b = await user("b");
    const root = await comment(a.id, "raiz");
    const r1 = await comment(b.id, "nível 1", root.id);
    const r2 = await comment(a.id, "nível 2", r1.id);
    const r3 = await comment(b.id, "irmão", r2.id);
    expect([r1.depth, r2.depth, r3.depth]).toEqual([1, 2, 2]);
    expect(r3.parentId).toBe(r1.id);
    const page = await listComments(prisma, "article", articleId);
    const tree = page.comments.find((c) => c.id === root.id)!;
    expect(tree.replies.map((r) => r.id)).toEqual([r1.id]);
    expect(tree.replies[0].replies.map((r) => r.id)).toEqual([r2.id, r3.id]);
  });

  it("mentions notify, except people in a block with the author; blocked users cannot reply", async () => {
    const a = await user("a");
    const friend = await user("amiga");
    const foe = await user("rival");
    await blockUser(prisma, foe.id, a.id);
    await comment(a.id, `oi @${friend.handle} e @${foe.handle}`);
    expect(await prisma.notification.count({ where: { userId: friend.id, kind: "mention" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: foe.id, kind: "mention" } })).toBe(0);
    const foeComment = await comment(foe.id, "do rival");
    const refused = await createComment(prisma, a.id, {
      targetType: "article",
      targetId: articleId,
      body: `resposta ${MARK}`,
      parentId: foeComment.id,
    });
    expect(refused).toEqual({ status: "blocked" });
  });
});

describe("private messages", () => {
  it("sends, marks unread for the recipient, reads, and respects the DM setting and blocks", async () => {
    const a = await user("a");
    const b = await user("b", { dmPolicy: "following" });
    expect(await sendMessage(prisma, a.id, b.id, `oi ${MARK}`)).toEqual({ status: "denied", reason: "policy_following" });
    await follow(prisma, b.id, a.id);
    const sent = await sendMessage(prisma, a.id, b.id, `oi ${MARK}`);
    expect(sent).toMatchObject({ status: "ok", message: { mine: true } });
    expect(await unreadConversations(prisma, b.id)).toBe(1);
    expect(await unreadConversations(prisma, a.id)).toBe(0);
    const opened = await openConversation(prisma, b.id, a.id);
    expect(opened.messages.map((m) => [m.body, m.mine])).toEqual([[`oi ${MARK}`, false]]);
    expect(await unreadConversations(prisma, b.id)).toBe(0);

    await prisma.user.update({ where: { id: b.id }, data: { dmPolicy: "friends" } });
    expect(await sendMessage(prisma, a.id, b.id, `de novo ${MARK}`)).toEqual({ status: "denied", reason: "policy_friends" });
    await prisma.user.update({ where: { id: b.id }, data: { dmPolicy: "everyone" } });
    await blockUser(prisma, a.id, b.id);
    expect(await sendMessage(prisma, b.id, a.id, `resposta ${MARK}`)).toEqual({ status: "denied", reason: "blocked" });
  });

  it("limits 10 messages a minute", async () => {
    const a = await user("a");
    const b = await user("b");
    const now = new Date();
    for (let i = 0; i < 10; i++) expect((await sendMessage(prisma, a.id, b.id, `m${i} ${MARK}`, now)).status).toBe("ok");
    expect(await sendMessage(prisma, a.id, b.id, `m10 ${MARK}`, now)).toMatchObject({ status: "rate_limited" });
  });

  it("deleting for oneself hides the history until a new message; both deleting removes it", async () => {
    const a = await user("a");
    const b = await user("b");
    const first = await sendMessage(prisma, a.id, b.id, `primeira ${MARK}`, new Date(Date.now() - 60_000));
    if (first.status !== "ok") throw new Error("send failed");
    expect(await clearConversation(prisma, b.id, first.conversationId)).toEqual({ status: "ok", deleted: false });
    expect((await listInbox(prisma, b.id)).total).toBe(0);
    expect((await listInbox(prisma, a.id)).total).toBe(1);
    await sendMessage(prisma, a.id, b.id, `segunda ${MARK}`);
    expect((await openConversation(prisma, b.id, a.id)).messages.map((m) => m.body)).toEqual([`segunda ${MARK}`]);
    expect((await openConversation(prisma, a.id, b.id)).messages).toHaveLength(2);
    await clearConversation(prisma, b.id, first.conversationId);
    expect(await clearConversation(prisma, a.id, first.conversationId)).toEqual({ status: "ok", deleted: true });
    expect(await prisma.directMessage.count({ where: { conversationId: first.conversationId } })).toBe(0);
  });
});

describe("feed", () => {
  it("shows rare achievements of followed public profiles only, and articles", async () => {
    const viewer = await user("leitor");
    const open = await user("aberto");
    const hidden = await user("fechado", { profilePublic: false });
    await follow(prisma, viewer.id, open.id);
    await follow(prisma, viewer.id, hidden.id);
    const rare = await prisma.achievement.findFirstOrThrow({ where: { globalPct: { lte: 5 } } });
    const at = new Date();
    await prisma.userAchievement.createMany({
      data: [
        { userId: open.id, achievementId: rare.id, unlockedAt: at },
        { userId: hidden.id, achievementId: rare.id, unlockedAt: at },
      ],
    });
    const feed = await getFeed(prisma, viewer.id, 1);
    expect(feed.following).toBe(2);
    const rares = feed.items.filter((i) => i.kind === "rare");
    expect(rares.map((i) => i.user.handle)).toEqual([open.handle]);
    expect(await getFeed(prisma, open.id, 1)).toMatchObject({ following: 0, items: [] });
  });
});
