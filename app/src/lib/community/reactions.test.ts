import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import {
  REACTION_GIVEN_DAILY_CAP,
  REACTION_GIVEN_XP,
  REACTION_RECEIVED_DAILY_CAP,
  REACTION_RECEIVED_XP,
} from "./rewards";

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
  const tag = `reac${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  return Promise.all(
    Array.from({ length: n }, (_, i) => tx.user.create({ data: { handle: `${tag}-${i}`, displayName: `User ${i}` } })),
  );
}

const ledger = (tx: Prisma.TransactionClient, userId: string, source: string) =>
  tx.xpLedgerEntry.findMany({ where: { userId, source }, select: { sourceKey: true, xp: true } });

/** A published article written by `userId` (through an Author linked to the user). */
async function articleBy(tx: Prisma.TransactionClient, userId: string) {
  const author = await tx.author.create({ data: { handle: `autor-${userId}`, userId } });
  return tx.article.create({
    data: {
      slug: `reacoes-${userId}`,
      title: "Matéria",
      body: "Texto",
      category: "GAMES",
      imageLabel: "x",
      authorId: author.id,
      status: "published",
    },
  });
}

describe.skipIf(!reachable)("reactions (database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("toggles and switches one reaction per user and item, with the counters mirroring the rows", () =>
    inRollback(async (tx) => {
      const { react } = await import("./reactions");
      const [author, fan, other] = await users(tx, 3);
      const photo = await tx.photo.create({ data: { authorId: author.id, width: 1, height: 1 } });

      expect(await react(tx, fan.id, "photo", photo.id, 1)).toMatchObject({ mine: 1, counts: { likes: 1, dislikes: 0 } });
      expect(await react(tx, other.id, "photo", photo.id, -1)).toMatchObject({ mine: -1, counts: { likes: 1, dislikes: 1 } });
      // Switch: still one row for the fan.
      expect(await react(tx, fan.id, "photo", photo.id, -1)).toMatchObject({ mine: -1, counts: { likes: 0, dislikes: 2 } });
      expect(await tx.reaction.count({ where: { userId: fan.id } })).toBe(1);
      // Same button again removes it.
      expect(await react(tx, fan.id, "photo", photo.id, -1)).toMatchObject({ mine: 0, counts: { likes: 0, dislikes: 1 } });
      expect(await tx.photo.findUniqueOrThrow({ where: { id: photo.id } })).toMatchObject({ likeCount: 0, dislikeCount: 1 });

      expect(await react(tx, fan.id, "photo", "missing", 1)).toEqual({ status: "not_found" });
      await tx.photo.update({ where: { id: photo.id }, data: { status: "hidden" } });
      expect(await react(tx, fan.id, "photo", photo.id, 1)).toEqual({ status: "not_found" });
    }));

  it("XP: a like pays both sides once per item; undo, redo and switching never pay again", () =>
    inRollback(async (tx) => {
      const { react } = await import("./reactions");
      const [writer, reader] = await users(tx, 2);
      const article = await articleBy(tx, writer.id);
      const now = new Date("2026-11-03T15:00:00Z");

      expect(await react(tx, reader.id, "article", article.id, 1, now)).toMatchObject({
        xp: { given: REACTION_GIVEN_XP, received: REACTION_RECEIVED_XP },
      });
      for (const value of [1, 1, -1, 1, -1, -1, 1] as const) {
        expect(await react(tx, reader.id, "article", article.id, value, now)).toMatchObject({ xp: { given: 0, received: 0 } });
      }
      expect(await ledger(tx, reader.id, "reaction_given")).toEqual([{ sourceKey: `article:${article.id}`, xp: REACTION_GIVEN_XP }]);
      expect(await ledger(tx, writer.id, "reaction_received")).toEqual([
        { sourceKey: `article:${article.id}:${reader.id}`, xp: REACTION_RECEIVED_XP },
      ]);
      expect(await tx.article.findUniqueOrThrow({ where: { id: article.id } })).toMatchObject({ likes: 1, dislikes: 0 });
    }));

  it("XP: a dislike pays only the one who dislikes; your own content pays nobody", () =>
    inRollback(async (tx) => {
      const { react } = await import("./reactions");
      const [writer, critic] = await users(tx, 2);
      const guide = await tx.guide.findFirstOrThrow({ where: { status: "published" } });
      await tx.guide.update({ where: { id: guide.id }, data: { authorId: writer.id } });

      expect(await react(tx, critic.id, "guide", guide.id, -1)).toMatchObject({ xp: { given: REACTION_GIVEN_XP, received: 0 } });
      // Turning it into a like pays the author (first like by this person), not the critic again.
      expect(await react(tx, critic.id, "guide", guide.id, 1)).toMatchObject({ xp: { given: 0, received: REACTION_RECEIVED_XP } });
      expect(await react(tx, writer.id, "guide", guide.id, 1)).toMatchObject({ xp: { given: 0, received: 0 } });
      expect(await ledger(tx, writer.id, "reaction_given")).toEqual([]);
      expect(await ledger(tx, critic.id, "reaction_given")).toHaveLength(1);
    }));

  it("XP: daily caps per side (Sao Paulo day); over the cap the reaction still counts", () =>
    inRollback(async (tx) => {
      const { react } = await import("./reactions");
      const [author, fan] = await users(tx, 2);
      const n = REACTION_GIVEN_DAILY_CAP + 1;
      await tx.photo.createMany({
        data: Array.from({ length: n + 1 }, (_, i) => ({ id: `cap-${fan.id}-${i}`, authorId: author.id, width: 1, height: 1 })),
      });
      const day1 = new Date("2026-11-03T13:00:00Z");
      const given: number[] = [];
      for (let i = 0; i < n; i++) {
        const r = await react(tx, fan.id, "photo", `cap-${fan.id}-${i}`, -1, new Date(day1.getTime() + i * 3_000));
        given.push(r.status === "ok" ? r.xp.given : -1);
      }
      expect(given.filter((xp) => xp === REACTION_GIVEN_XP)).toHaveLength(REACTION_GIVEN_DAILY_CAP);
      expect(given[n - 1]).toBe(0);
      expect(await tx.reaction.count({ where: { userId: fan.id } })).toBe(n);
      // The next local day pays again, even for the item that was over yesterday's cap.
      const day2 = new Date("2026-11-04T13:00:00Z");
      await react(tx, fan.id, "photo", `cap-${fan.id}-${n - 1}`, -1, day2);
      expect(await react(tx, fan.id, "photo", `cap-${fan.id}-${n - 1}`, -1, day2)).toMatchObject({
        xp: { given: REACTION_GIVEN_XP },
      });

      // Receiving: the author already got the day's maximum of likes.
      await tx.xpLedgerEntry.createMany({
        data: Array.from({ length: REACTION_RECEIVED_DAILY_CAP }, (_, i) => ({
          userId: author.id,
          source: "reaction_received",
          sourceKey: `fake:${i}`,
          xp: REACTION_RECEIVED_XP,
          skills: [],
          createdAt: day2,
        })),
      });
      expect(await react(tx, fan.id, "photo", `cap-${fan.id}-${n}`, 1, day2)).toMatchObject({
        xp: { given: REACTION_GIVEN_XP, received: 0 },
        counts: { likes: 1 },
      });
    }));

  it("credits the stats row in place (total XP and level)", () =>
    inRollback(async (tx) => {
      const { react } = await import("./reactions");
      const [author, fan] = await users(tx, 2);
      await tx.userStats.createMany({
        data: [
          { userId: author.id, totalXp: 95, level: 1, vocation: "x" },
          { userId: fan.id, totalXp: 0, level: 1, vocation: "x" },
        ],
      });
      const photo = await tx.photo.create({ data: { authorId: author.id, width: 1, height: 1 } });
      await react(tx, fan.id, "photo", photo.id, 1);
      expect(await tx.userStats.findUniqueOrThrow({ where: { userId: author.id } })).toMatchObject({
        totalXp: 95 + REACTION_RECEIVED_XP,
        level: 2,
      });
      expect(await tx.userStats.findUniqueOrThrow({ where: { userId: fan.id } })).toMatchObject({ totalXp: REACTION_GIVEN_XP });
    }));

  it("photo likes notify the author once per liker, ever; at most 30 new reactions a minute", () =>
    inRollback(async (tx) => {
      const { react } = await import("./reactions");
      const [author, fan] = await users(tx, 2);
      const photo = await tx.photo.create({ data: { authorId: author.id, width: 1, height: 1 } });
      for (let i = 0; i < 3; i++) {
        await react(tx, fan.id, "photo", photo.id, 1);
        await react(tx, fan.id, "photo", photo.id, 1);
      }
      await react(tx, fan.id, "photo", photo.id, -1);
      await react(tx, fan.id, "photo", photo.id, 1);
      await react(tx, author.id, "photo", photo.id, 1);
      expect(await tx.notification.count({ where: { userId: author.id, kind: "photo_like" } })).toBe(1);

      const now = new Date();
      await tx.photo.createMany({
        data: Array.from({ length: 31 }, (_, i) => ({ id: `rl-${fan.id}-${i}`, authorId: author.id, width: 1, height: 1 })),
      });
      // The fan's reaction to `photo` above was made `now` too: 29 more fit.
      for (let i = 0; i < 29; i++) expect((await react(tx, fan.id, "photo", `rl-${fan.id}-${i}`, 1, now)).status).toBe("ok");
      expect(await react(tx, fan.id, "photo", `rl-${fan.id}-30`, 1, now)).toEqual({ status: "rate_limited" });
      const later = new Date(now.getTime() + 61_000);
      expect((await react(tx, fan.id, "photo", `rl-${fan.id}-30`, 1, later)).status).toBe("ok");
    }));

  it("comments: only visible ones; profile counts of given and received reactions", () =>
    inRollback(async (tx) => {
      const { react, reactionStats, myReactions } = await import("./reactions");
      const [me, you] = await users(tx, 2);
      const mine = await tx.comment.create({ data: { authorId: me.id, targetType: "photo", targetId: "seed-photo-01", body: "a" } });
      const yours = await tx.comment.create({ data: { authorId: you.id, targetType: "photo", targetId: "seed-photo-01", body: "b" } });

      await react(tx, you.id, "comment", mine.id, 1);
      await react(tx, me.id, "comment", yours.id, -1);
      await react(tx, me.id, "comment", mine.id, 1);
      expect(await tx.comment.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ likes: 2, dislikes: 0 });
      expect(await myReactions(tx, me.id, "comment", [mine.id, yours.id, "x"])).toEqual({ [mine.id]: 1, [yours.id]: -1 });
      // A like on your own comment is not "received".
      expect(await reactionStats(me.id, tx)).toEqual({ likesGiven: 1, dislikesGiven: 1, likesReceived: 1 });
      expect(await reactionStats(you.id, tx)).toEqual({ likesGiven: 1, dislikesGiven: 0, likesReceived: 0 });

      await tx.comment.update({ where: { id: yours.id }, data: { status: "deleted", body: "" } });
      expect(await react(tx, me.id, "comment", yours.id, 1)).toEqual({ status: "not_found" });
    }));
});
