import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

// The community Server Actions run for real; only the session and cache invalidation are faked.
const session = vi.hoisted(() => ({ user: null as { id: string; handle: string } | null }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag: () => {},
}));

// Needs Postgres up and seeded (see db.test.ts); skipped when unreachable.
async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

const PREFIX = "test_lgpd_";
const MARK = "lgpd-test"; // in every free-text field, to clean up rows that outlive their author

describe.skipIf(!reachable)("LGPD export and account deletion", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.comment.deleteMany({ where: { body: { contains: MARK } } });
    await prisma.forumThread.deleteMany({ where: { title: { contains: MARK } } });
    await prisma.photo.deleteMany({ where: { caption: { contains: MARK } } });
    await prisma.guideTip.deleteMany({ where: { body: { contains: MARK } } });
    await prisma.family.deleteMany({ where: { name: { contains: MARK } } });
    await prisma.newsletterSubscriber.deleteMany({ where: { email: { endsWith: "@lgpd.test", mode: "insensitive" } } });
    await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  }

  async function newUser(label: string) {
    const { prisma } = await import("@/lib/db");
    counter++;
    return prisma.user.create({
      data: {
        handle: `${PREFIX}${label}_${counter}`,
        displayName: `Pessoa ${label.toUpperCase()}`,
        email: `${label}${counter}@lgpd.test`,
        bio: `bio de ${label} ${MARK}`,
      },
    });
  }

  /** A user with a bit of everything: progress, linked accounts, content and notifications. */
  async function populate(user: { id: string; handle: string }, label: string) {
    const { prisma } = await import("@/lib/db");
    const achievement = await prisma.achievement.findFirstOrThrow({
      where: { platform: "steam", game: { slug: "hollow-knight" } },
    });
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "psn", externalId: `psn-${user.id}`, handle: `psn_${label}`, verifiedAt: new Date() },
    });
    await prisma.userGame.create({
      data: { userId: user.id, gameId: achievement.gameId, platform: "steam", playtimeMin: 600, unlockedCount: 1 },
    });
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: achievement.id, unlockedAt: new Date() } });
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "achievement", sourceKey: achievement.id, xp: 1234, skills: ["soulslike"] },
    });
    await prisma.userStats.create({ data: { userId: user.id, totalXp: 1234, level: 3, vocation: "Recruta" } });
    await prisma.attributeProgress.create({ data: { userId: user.id, attribute: "vigor", level: 2, points: 40 } });
    await prisma.notification.create({ data: { userId: user.id, kind: "system", title: `aviso para ${label} ${MARK}` } });
    const photo = await prisma.photo.create({
      data: { authorId: user.id, width: 1600, height: 900, caption: `foto de ${label} ${MARK}` },
    });
    const thread = await prisma.forumThread.create({
      data: { authorId: user.id, title: `tópico de ${label} ${MARK}`, slug: "topico" },
    });
    await prisma.forumPost.create({ data: { threadId: thread.id, authorId: user.id, body: `post de ${label} ${MARK}` } });
    return { photo, thread, achievement };
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("exports only the user's own data", async () => {
    const { prisma } = await import("@/lib/db");
    const { exportUserData } = await import("./export");
    const a = await newUser("a");
    const b = await newUser("b");
    const mineA = await populate(a, "a");
    const mineB = await populate(b, "b");

    // B interacts with A's content through the real Server Actions (which also notify A, quoting
    // B's name and text): none of it belongs in A's export.
    const { postComment, replyToThread } = await import("@/lib/community/actions");
    const { reactTo } = await import("@/lib/community/engagement-actions");
    session.user = b;
    expect(await reactTo({ targetType: "photo", targetId: mineA.photo.id, value: 1 })).toMatchObject({
      status: "ok",
      mine: 1,
    });
    expect(
      await postComment({ targetType: "photo", targetId: mineA.photo.id, body: `comentário de b ${MARK}` }),
    ).toMatchObject({ status: "ok" });
    expect(await replyToThread({ threadId: mineA.thread.id, body: `resposta de b ${MARK}` })).toMatchObject({
      status: "ok",
    });
    // A's own comment, and a pending link whose code must not leak.
    session.user = a;
    const article = await prisma.article.findFirstOrThrow({ where: { status: "published" }, select: { id: true } });
    expect(
      await postComment({ targetType: "article", targetId: article.id, body: `comentário de a ${MARK}` }),
    ).toMatchObject({ status: "ok" });
    session.user = null;
    // Both subscribe to the newsletter (A with different capitalization): only A's is exported.
    const confirmedAt = new Date("2026-10-30T12:00:00Z");
    await prisma.newsletterSubscriber.create({ data: { email: a.email!.toUpperCase(), confirmedAt } });
    await prisma.newsletterSubscriber.create({ data: { email: b.email! } });
    await prisma.linkedAccount.create({
      data: {
        userId: a.id,
        platform: "xbox",
        externalId: `pending:${a.id}`,
        linkedAt: null,
        handle: "gt_a",
        verifyCode: "TRK-ABCDEF",
        verifyExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    // The notifications B's actions sent A do quote B (that is why their text is not exported).
    const inbox = await prisma.notification.findMany({ where: { userId: a.id, kind: { not: "system" } } });
    expect(inbox.length).toBeGreaterThan(0);
    expect(JSON.stringify(inbox)).toMatch(/Pessoa B|de b/);
    const data = await exportUserData(a.id);
    expect(data).not.toBeNull();
    const json = JSON.stringify(data);

    expect(data!.user).toMatchObject({ id: a.id, handle: a.handle, email: a.email, bio: a.bio });
    expect(data!.linkedAccounts).toEqual([expect.objectContaining({ platform: "psn", handle: "psn_a" })]);
    // B's like paid A "reaction_received" XP: the entry is A's, but not B's user id in its key.
    // A's own comment paid "comment_posted" (5 XP); the recompute it triggers may also complete a mission.
    expect(data!.progress.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ xp: 1234 }),
        expect.objectContaining({ source: "reaction_received", sourceKey: `photo:${mineA.photo.id}` }),
        expect.objectContaining({ source: "comment_posted", xp: 5 }),
      ]),
    );
    expect(data!.progress.ledger.every((e) => !String(e.sourceKey).includes(b.id))).toBe(true);
    // The ledger tells entries with an unknown date apart.
    await prisma.xpLedgerEntry.create({
      data: { userId: a.id, source: "achievement", sourceKey: `${MARK}-undated`, xp: 7, dateUnknown: true },
    });
    const again = await exportUserData(a.id);
    expect(again!.progress.ledger).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceKey: `${MARK}-undated`, dateUnknown: true })]),
    );
    expect(again!.progress.ledger.find((e) => e.xp === 1234)).toMatchObject({ dateUnknown: false });
    expect(json).not.toContain(b.id);
    expect(data!.progress.achievements).toHaveLength(1);
    expect(data!.community.photos).toEqual([expect.objectContaining({ id: mineA.photo.id, likeCount: 1 })]);
    expect(data!.community.comments.map((c) => c.body)).toEqual([`comentário de a ${MARK}`]);
    expect(data!.community.forumPosts.map((p) => p.body)).toEqual([`post de a ${MARK}`]);
    expect(data!.community.reactions).toEqual([]);
    expect(data!.newsletter).toMatchObject({ email: a.email!.toUpperCase(), confirmedAt });
    // Notifications keep only kind, link and dates: their texts quote other people.
    expect(data!.notifications.length).toBe(inbox.length + 1);
    for (const n of data!.notifications) expect(Object.keys(n).sort()).toEqual(["createdAt", "href", "kind", "readAt"]);

    for (const foreign of [
      b.id,
      b.handle,
      b.email!,
      b.displayName,
      `psn-${b.id}`,
      mineB.photo.id,
      mineB.thread.id,
      "comentário de b",
      "resposta de b",
      "foto de b",
      "post de b",
      "aviso para b",
      "TRK-ABCDEF",
      "pending:",
    ]) {
      expect(json).not.toContain(foreign);
    }
  });

  it("the notifications cron deletes notifications older than 90 days", async () => {
    const { prisma } = await import("@/lib/db");
    const { deleteOldNotifications } = await import("@/lib/notifications/retention");
    const user = await newUser("n");
    const now = new Date("2026-10-31T12:00:00Z");
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    await prisma.notification.createMany({
      data: [
        { userId: user.id, kind: "photo_like", title: "velha", createdAt: daysAgo(91) },
        { userId: user.id, kind: "photo_like", title: "recente", createdAt: daysAgo(89) },
      ],
    });
    const { processed } = await deleteOldNotifications(now);
    expect(processed).toBeGreaterThanOrEqual(1);
    const left = await prisma.notification.findMany({ where: { userId: user.id }, select: { title: true } });
    expect(left).toEqual([{ title: "recente" }]);
  });

  it("returns null for a user that does not exist", async () => {
    const { exportUserData } = await import("./export");
    expect(await exportUserData("no-such-user")).toBeNull();
  });

  it("deletes personal data and keeps authored content without an author", async () => {
    const { prisma } = await import("@/lib/db");
    const { deleteAccount } = await import("./delete");
    const { createFamily } = await import("@/lib/family/service");
    const d = await newUser("d");
    const heir = await newUser("e");
    const other = await newUser("f");
    const mine = await populate(d, "d");
    const otherPhoto = await prisma.photo.create({
      data: { authorId: other.id, width: 800, height: 800, caption: `foto de f ${MARK}`, likeCount: 1 },
    });
    await prisma.reaction.create({
      data: { userId: d.id, targetType: "photo", targetId: otherPhoto.id, value: 1, targetOwnerId: other.id },
    });
    const comment = await prisma.comment.create({
      data: { authorId: d.id, targetType: "photo", targetId: otherPhoto.id, body: `comentário de d ${MARK}` },
    });
    const guide = await prisma.guide.findFirstOrThrow({ select: { id: true } });
    const tip = await prisma.guideTip.create({ data: { guideId: guide.id, authorId: d.id, body: `dica de d ${MARK}` } });
    const family = await createFamily(d.id, `Família ${MARK}`);
    await prisma.familyMember.create({ data: { familyId: family.id, userId: heir.id, role: "member" } });
    await prisma.newsletterSubscriber.create({ data: { email: d.email! } });

    const deleted = await deleteAccount(d.id);
    expect(deleted).toEqual({
      photoIds: [mine.photo.id, otherPhoto.id],
      threadIds: [mine.thread.id],
      guideGameSlugs: [expect.any(String)],
    });

    // Personal data is gone.
    expect(await prisma.user.findUnique({ where: { id: d.id } })).toBeNull();
    const where = { userId: d.id };
    expect(
      await Promise.all([
        prisma.linkedAccount.count({ where }),
        prisma.userGame.count({ where }),
        prisma.userAchievement.count({ where }),
        prisma.xpLedgerEntry.count({ where }),
        prisma.userStats.count({ where }),
        prisma.attributeProgress.count({ where }),
        prisma.notification.count({ where }),
        prisma.reaction.count({ where }),
        prisma.familyMember.count({ where }),
        prisma.newsletterSubscriber.count({ where: { email: d.email! } }),
      ]),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    // Authored content stays, anonymous.
    expect(await prisma.photo.findUnique({ where: { id: mine.photo.id } })).toMatchObject({ authorId: null });
    expect(await prisma.forumThread.findUnique({ where: { id: mine.thread.id } })).toMatchObject({ authorId: null });
    expect(await prisma.forumPost.findFirst({ where: { threadId: mine.thread.id } })).toMatchObject({
      authorId: null,
      body: `post de d ${MARK}`,
    });
    expect(await prisma.comment.findUnique({ where: { id: comment.id } })).toMatchObject({ authorId: null });
    expect(await prisma.guideTip.findUnique({ where: { id: tip.id } })).toMatchObject({ authorId: null });

    // The family passes to the remaining member; other people's data is untouched.
    expect(await prisma.family.findUnique({ where: { id: family.id } })).toMatchObject({ ownerId: heir.id });
    expect(await prisma.familyMember.findUnique({ where: { userId: heir.id } })).toMatchObject({ role: "owner" });
    expect(await prisma.photo.findUnique({ where: { id: otherPhoto.id } })).toMatchObject({ authorId: other.id, likeCount: 0 });
    expect(await prisma.user.count({ where: { id: { in: [heir.id, other.id] } } })).toBe(2);

    expect(await deleteAccount(d.id)).toBeNull();
  });
});
