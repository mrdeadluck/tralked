import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { expFor } from "@/lib/engine/xp";
import { REACTION_GIVEN_DAILY_CAP, REACTION_GIVEN_XP } from "./rewards";

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
      { timeout: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function users(tx: Prisma.TransactionClient, n: number) {
  const tag = `loop${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  return Promise.all(
    Array.from({ length: n }, (_, i) => tx.user.create({ data: { handle: `${tag}-${i}`, displayName: `User ${i}` } })),
  );
}

const notes = (tx: Prisma.TransactionClient, userId: string, kind: string) =>
  tx.notification.findMany({ where: { userId, kind }, orderBy: { createdAt: "asc" } });

describe.skipIf(!reachable)("reward loop (database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("aggregates likes on a comment into one unread notification", () =>
    inRollback(async (tx) => {
      const { react } = await import("./reactions");
      const [author, a, b, c] = await users(tx, 4);
      const photo = await tx.photo.create({ data: { authorId: author.id, width: 1, height: 1 } });
      const comment = await tx.comment.create({
        data: { authorId: author.id, targetType: "photo", targetId: photo.id, body: "Que chefe difícil" },
      });
      const t0 = new Date(Date.now() - 60_000);

      await react(tx, a.id, "comment", comment.id, 1, t0);
      let list = await notes(tx, author.id, "like");
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        title: `@${a.handle} curtiu seu comentário`,
        body: "Que chefe difícil",
        href: `/galeria/${photo.id}#comentario-${comment.id}`,
      });

      await react(tx, b.id, "comment", comment.id, 1, new Date(t0.getTime() + 1000));
      await react(tx, c.id, "comment", comment.id, 1, new Date(t0.getTime() + 2000));
      list = await notes(tx, author.id, "like");
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("3 pessoas curtiram seu comentário");

      // Undo and redo by someone who already liked: no new write.
      await react(tx, c.id, "comment", comment.id, 1, new Date(t0.getTime() + 3000));
      await react(tx, c.id, "comment", comment.id, 1, new Date(t0.getTime() + 4000));
      expect(await notes(tx, author.id, "like")).toHaveLength(1);

      // Once read, the next new liker starts a fresh notification.
      await tx.notification.updateMany({ where: { userId: author.id }, data: { readAt: new Date() } });
      const [d] = await users(tx, 1);
      await react(tx, d.id, "comment", comment.id, 1, new Date(t0.getTime() + 5000));
      list = await notes(tx, author.id, "like");
      expect(list).toHaveLength(2);
      expect(list[1].title).toBe(`@${d.handle} curtiu seu comentário`);

      // Dislikes notify nobody.
      const [e] = await users(tx, 1);
      await react(tx, e.id, "comment", comment.id, -1, new Date(t0.getTime() + 6000));
      expect(await notes(tx, author.id, "like")).toHaveLength(2);
    }));

  it("returns the reactor's level up and writes it to the bell", () =>
    inRollback(async (tx) => {
      const { react } = await import("./reactions");
      const [author, fan] = await users(tx, 2);
      // One XP short of level 3 after the reaction pays REACTION_GIVEN_XP.
      const totalXp = expFor(3) - REACTION_GIVEN_XP;
      await tx.userStats.create({ data: { userId: fan.id, totalXp, level: 2, vocation: "Recruta" } });
      const photo = await tx.photo.create({ data: { authorId: author.id, width: 1, height: 1 } });

      const result = await react(tx, fan.id, "photo", photo.id, 1);
      expect(result).toMatchObject({ status: "ok", xp: { given: REACTION_GIVEN_XP }, levelUp: { from: 2, to: 3 } });
      const [levelUp] = await notes(tx, fan.id, "level_up");
      expect(levelUp).toMatchObject({ title: "Você chegou ao nível 3", href: `/jogador/${fan.handle}` });
    }));

  it("promises reaction XP only where it would still be paid", () =>
    inRollback(async (tx) => {
      const { react, reactionXpOpen } = await import("./reactions");
      const [author, fan] = await users(tx, 2);
      const photos = await Promise.all(
        [0, 1].map(() => tx.photo.create({ data: { authorId: author.id, width: 1, height: 1 } })),
      );
      const ids = photos.map((p) => p.id);
      expect(await reactionXpOpen(tx, fan.id, "photo", ids)).toEqual(ids);

      await react(tx, fan.id, "photo", ids[0], 1);
      await react(tx, fan.id, "photo", ids[0], 1); // undone: paid anyway, never again
      expect(await reactionXpOpen(tx, fan.id, "photo", ids)).toEqual([ids[1]]);

      // Today's cap reached: nothing is promised.
      await tx.xpLedgerEntry.createMany({
        data: Array.from({ length: REACTION_GIVEN_DAILY_CAP }, (_, i) => ({
          userId: fan.id,
          source: "reaction_given",
          sourceKey: `photo:cap-${i}`,
          xp: REACTION_GIVEN_XP,
          skills: [],
        })),
      });
      expect(await reactionXpOpen(tx, fan.id, "photo", ids)).toEqual([]);
    }));
});
