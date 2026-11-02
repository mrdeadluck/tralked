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

async function inRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  const { prisma } = await import("@/lib/db");
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function users(tx: Prisma.TransactionClient, n: number) {
  const tag = `repl${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  return Promise.all(
    Array.from({ length: n }, (_, i) => tx.user.create({ data: { handle: `${tag}-${i}`, displayName: `User ${i}` } })),
  );
}

describe.skipIf(!reachable)("comment replies (database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("one level deep: a reply to a reply joins the same root and @mentions who is answered", () =>
    inRollback(async (tx) => {
      const { createComment } = await import("./comments");
      const [ana, bia, caio] = await users(tx, 3);
      const photo = await tx.photo.create({ data: { authorId: ana.id, width: 1, height: 1 } });
      const target = { targetType: "photo" as const, targetId: photo.id };

      const root = await createComment(tx, ana.id, { ...target, body: "Raiz" });
      if (root.status !== "ok") throw new Error("root");
      const first = await createComment(tx, bia.id, { ...target, body: "Oi Ana", parentId: root.comment.id });
      if (first.status !== "ok") throw new Error("first");
      expect(first.comment).toMatchObject({ parentId: root.comment.id, replyTo: null });

      const second = await createComment(tx, caio.id, { ...target, body: "Oi Bia", parentId: first.comment.id });
      if (second.status !== "ok") throw new Error("second");
      expect(second.comment).toMatchObject({ parentId: root.comment.id, replyTo: { handle: bia.handle } });

      // The person answered is notified, with a link to the reply.
      const toBia = await tx.notification.findMany({ where: { userId: bia.id, kind: "comment_reply" } });
      expect(toBia).toEqual([
        expect.objectContaining({
          title: `@${caio.handle} respondeu seu comentário`,
          href: `/galeria/${photo.id}#comentario-${second.comment.id}`,
        }),
      ]);
      // Ana: one "respondeu" (from Bia); replies do not repeat "comentou na sua foto".
      const toAna = await tx.notification.findMany({ where: { userId: ana.id, kind: "comment_reply" }, select: { title: true } });
      expect(toAna.map((n) => n.title)).toEqual([`@${bia.handle} respondeu seu comentário`]);

      // Answering yourself notifies nobody.
      await createComment(tx, caio.id, { ...target, body: "Eu mesmo", parentId: second.comment.id });
      expect(await tx.notification.count({ where: { userId: caio.id } })).toBe(0);
    }));

  it("lists top-level comments with their first replies, counts and the rest on demand", () =>
    inRollback(async (tx) => {
      const { createComment, listComments, listReplies, REPLIES_PREVIEW } = await import("./comments");
      const [ana, bia] = await users(tx, 2);
      const photo = await tx.photo.create({ data: { authorId: ana.id, width: 1, height: 1 } });
      const target = { targetType: "photo" as const, targetId: photo.id };
      const root = await createComment(tx, ana.id, { ...target, body: "Raiz" });
      if (root.status !== "ok") throw new Error("root");
      for (let i = 0; i < 5; i++) {
        await createComment(tx, bia.id, { ...target, body: `r${i}`, parentId: root.comment.id });
      }
      const page = await listComments(tx, "photo", photo.id);
      expect(page.total).toBe(6);
      expect(page.comments).toHaveLength(1);
      expect(page.comments[0].replyCount).toBe(5);
      expect(page.comments[0].replies.map((r) => r.body)).toEqual(
        ["r0", "r1", "r2", "r3", "r4"].slice(0, REPLIES_PREVIEW),
      );
      expect((await listReplies(tx, root.comment.id)).map((r) => r.body)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    }));

  it("refuses replies to comments of another item or that are not visible", () =>
    inRollback(async (tx) => {
      const { createComment } = await import("./comments");
      const [ana] = await users(tx, 1);
      const photo = await tx.photo.create({ data: { authorId: ana.id, width: 1, height: 1 } });
      const other = await tx.photo.create({ data: { authorId: ana.id, width: 1, height: 1 } });
      const root = await createComment(tx, ana.id, { targetType: "photo", targetId: photo.id, body: "Raiz" });
      if (root.status !== "ok") throw new Error("root");

      expect(
        await createComment(tx, ana.id, { targetType: "photo", targetId: other.id, body: "x", parentId: root.comment.id }),
      ).toEqual({ status: "not_found" });
      await tx.comment.update({ where: { id: root.comment.id }, data: { status: "hidden" } });
      expect(
        await createComment(tx, ana.id, { targetType: "photo", targetId: photo.id, body: "x", parentId: root.comment.id }),
      ).toEqual({ status: "not_found" });
    }));
});
