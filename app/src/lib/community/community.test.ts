import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";

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

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back (the seeded DB is shared with other tests). */
async function inRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  const { prisma } = await import("@/lib/db");
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function users(tx: Prisma.TransactionClient, n: number) {
  const tag = `comm${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      tx.user.create({ data: { handle: `${tag}-${i}`, displayName: `User ${i}` } }),
    ),
  );
}

async function threadWithReply(tx: Prisma.TransactionClient) {
  const [author, helper, other] = await users(tx, 3);
  const thread = await tx.forumThread.create({
    data: {
      authorId: author.id,
      title: "Como pego a conquista?",
      slug: "como-pego",
      posts: { create: [{ authorId: author.id, body: "Pergunta" }] },
    },
    include: { posts: true },
  });
  const reply = await tx.forumPost.create({ data: { threadId: thread.id, authorId: helper.id, body: "Assim." } });
  return { author, helper, other, thread, opening: thread.posts[0], reply };
}

describe.skipIf(!reachable)("community (database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("comments: create, list newest first, edit and delete only your own", () =>
    inRollback(async (tx) => {
      const { createComment, deleteComment, editComment, listComments } = await import("./comments");
      const [me, someone] = await users(tx, 2);
      const photo = await tx.photo.findUniqueOrThrow({ where: { id: "seed-photo-05" } });

      const first = await createComment(tx, me.id, { targetType: "photo", targetId: photo.id, body: "Primeiro" });
      const second = await createComment(tx, someone.id, { targetType: "photo", targetId: photo.id, body: "Segundo" });
      expect(first.status).toBe("ok");
      expect(second.status).toBe("ok");
      if (first.status !== "ok") return;

      const page = await listComments(tx, "photo", photo.id, null, 1);
      expect(page.total).toBe(2);
      expect(page.comments.map((c) => c.body)).toEqual(["Segundo"]);
      const next = await listComments(tx, "photo", photo.id, page.nextCursor, 1);
      expect(next.comments.map((c) => c.body)).toEqual(["Primeiro"]);
      expect(next.nextCursor).toBeNull();

      expect((await editComment(tx, someone.id, { id: first.comment.id, body: "x" })).status).toBe("forbidden");
      expect((await deleteComment(tx, someone.id, first.comment.id)).status).toBe("forbidden");
      const edited = await editComment(tx, me.id, { id: first.comment.id, body: "Editado" });
      expect(edited.status === "ok" && edited.comment.editedAt).toBeTruthy();
      // The photo id comes back so the action can refresh the photo page's cached count.
      expect(await deleteComment(tx, me.id, first.comment.id)).toEqual({ status: "ok", photoId: photo.id });
      // Soft delete: the row stays (rate limits keep counting it) with its text cleared.
      expect(await tx.comment.findUniqueOrThrow({ where: { id: first.comment.id } })).toMatchObject({
        status: "deleted",
        body: "",
        authorId: me.id,
      });
      const afterDelete = await listComments(tx, "photo", photo.id);
      expect(afterDelete.total).toBe(1);
      expect(afterDelete.comments.find((c) => c.id === first.comment.id)).toMatchObject({
        deleted: true,
        body: "",
        author: null,
      });
      // A deleted comment can't be edited or deleted again.
      expect((await editComment(tx, me.id, { id: first.comment.id, body: "volta" })).status).toBe("not_found");
      expect((await deleteComment(tx, me.id, first.comment.id)).status).toBe("not_found");

      // The photo author (Mercador_Anselmo) was notified about both comments.
      expect(
        await tx.notification.count({ where: { userId: photo.authorId!, kind: "comment_reply", createdAt: { gte: photo.createdAt } } }),
      ).toBeGreaterThanOrEqual(2);
    }));

  it("comments: unknown or hidden targets are refused, and 10 per minute is the limit", () =>
    inRollback(async (tx) => {
      const { createComment, deleteComment } = await import("./comments");
      const [me] = await users(tx, 1);
      expect((await createComment(tx, me.id, { targetType: "photo", targetId: "nope", body: "x" })).status).toBe(
        "not_found",
      );
      const hidden = await tx.photo.create({ data: { authorId: me.id, width: 1, height: 1, status: "hidden" } });
      expect((await createComment(tx, me.id, { targetType: "photo", targetId: hidden.id, body: "x" })).status).toBe(
        "not_found",
      );

      const article = await tx.article.findFirstOrThrow({ where: { status: "published" } });
      for (let i = 0; i < 10; i++) {
        const r = await createComment(tx, me.id, { targetType: "article", targetId: article.id, body: `c${i}` });
        expect(r.status).toBe("ok");
        // Deleting right away does not free a slot (post + delete used to reset the limit).
        if (r.status === "ok") expect((await deleteComment(tx, me.id, r.comment.id)).status).toBe("ok");
      }
      const eleventh = await createComment(tx, me.id, { targetType: "article", targetId: article.id, body: "c10" });
      expect(eleventh.status).toBe("rate_limited");
    }));

  it("a report creates an open Report once per reporter and target", () =>
    inRollback(async (tx) => {
      const { createReport } = await import("./reports");
      const [me] = await users(tx, 1);
      const input = { targetType: "comment" as const, targetId: "seed-comment-01", reason: "Spam ou propaganda" as const, details: "link suspeito" };

      expect(await createReport(tx, me.id, input)).toEqual({ status: "ok" });
      expect(await createReport(tx, me.id, input)).toEqual({ status: "already_reported" });
      expect(await createReport(tx, me.id, { ...input, targetId: "missing" })).toEqual({ status: "not_found" });

      const reports = await tx.report.findMany({ where: { reporterId: me.id } });
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        targetType: "comment",
        targetId: "seed-comment-01",
        status: "open",
        reason: "Spam ou propaganda: link suspeito",
      });
    }));

  it("photo XP: 50 per photo, at most 3 photos a day, idempotent per photo", () =>
    inRollback(async (tx) => {
      const { awardPhotoXp } = await import("./xp");
      const [me] = await users(tx, 1);
      const day1 = new Date("2026-10-20T13:00:00Z");
      const results: boolean[] = [];
      for (let i = 0; i < 4; i++) results.push(await awardPhotoXp(tx, me.id, `p${i}`, day1));
      expect(results).toEqual([true, true, true, false]);
      expect(await awardPhotoXp(tx, me.id, "p0", day1)).toBe(false);

      // Late evening in São Paulo (02:30 UTC next day) is still the same local day.
      expect(await awardPhotoXp(tx, me.id, "p4", new Date("2026-10-21T02:30:00Z"))).toBe(false);
      // The next local day has a fresh allowance.
      expect(await awardPhotoXp(tx, me.id, "p5", new Date("2026-10-21T12:00:00Z"))).toBe(true);

      const ledger = await tx.xpLedgerEntry.findMany({ where: { userId: me.id }, orderBy: { sourceKey: "asc" } });
      expect(ledger.map((e) => e.sourceKey)).toEqual(["p0", "p1", "p2", "p5"]);
      expect(ledger.every((e) => e.source === "photo_approved" && e.xp === 50 && e.skills.length === 0)).toBe(true);
    }));

  it("forum: only the thread author marks 'Resolveu', once, never on their own post", () =>
    inRollback(async (tx) => {
      const { markSolved } = await import("./forum");
      const { author, helper, other, thread, opening, reply } = await threadWithReply(tx);

      expect((await markSolved(tx, other.id, { threadId: thread.id, postId: reply.id })).status).toBe("forbidden");
      expect((await markSolved(tx, helper.id, { threadId: thread.id, postId: reply.id })).status).toBe("forbidden");
      expect((await markSolved(tx, author.id, { threadId: thread.id, postId: opening.id })).status).toBe("own_post");
      expect((await markSolved(tx, author.id, { threadId: thread.id, postId: "missing" })).status).toBe("not_found");

      const result = await markSolved(tx, author.id, { threadId: thread.id, postId: reply.id });
      expect(result).toEqual({ status: "ok", answerAuthorId: helper.id, xpAwarded: true });
      expect((await markSolved(tx, author.id, { threadId: thread.id, postId: reply.id })).status).toBe(
        "already_solved",
      );

      expect((await tx.forumThread.findUniqueOrThrow({ where: { id: thread.id } })).solvedPostId).toBe(reply.id);
      const ledger = await tx.xpLedgerEntry.findMany({ where: { source: "forum_solved", sourceKey: reply.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ userId: helper.id, xp: 40, skills: ["sabio"], skillPoints: { sabio: 40 } });
      expect(await tx.notification.count({ where: { userId: helper.id, kind: "thread_solved" } })).toBe(1);
    }));

  it("forum: threads and replies, locked threads, 5 posts per minute", () =>
    inRollback(async (tx) => {
      const { createPost, createThread } = await import("./forum");
      const [me, other] = await users(tx, 2);

      expect((await createThread(tx, me.id, { section: "nada-aqui", title: "Título bom", body: "x" })).status).toBe(
        "not_found",
      );
      const created = await createThread(tx, me.id, { section: "hollow-knight", title: "Rota do Panteão", body: "Dúvida" });
      expect(created.status).toBe("ok");
      if (created.status !== "ok") return;
      const thread = await tx.forumThread.findUniqueOrThrow({ where: { id: created.threadId }, include: { game: true } });
      expect(thread).toMatchObject({ slug: "rota-do-panteao", categoryId: null, authorId: me.id });
      expect(thread.game?.slug).toBe("hollow-knight");

      const reply = await createPost(tx, other.id, { threadId: thread.id, body: "Resposta" });
      expect(reply.status).toBe("ok");
      expect(await tx.notification.count({ where: { userId: me.id, kind: "forum_reply" } })).toBe(1);

      // me already has 1 post (the opening one): 4 more fit in the minute, the 6th does not.
      for (let i = 0; i < 4; i++) expect((await createPost(tx, me.id, { threadId: thread.id, body: `r${i}` })).status).toBe("ok");
      expect((await createPost(tx, me.id, { threadId: thread.id, body: "r5" })).status).toBe("rate_limited");

      await tx.forumThread.update({ where: { id: thread.id }, data: { status: "locked" } });
      expect((await createPost(tx, other.id, { threadId: thread.id, body: "tarde" })).status).toBe("locked");
    }));
});
