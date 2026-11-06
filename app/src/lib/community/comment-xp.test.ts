import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { COMMENT_XP, COMMENT_XP_DAILY_CAP, FORUM_POST_XP } from "./rewards";

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

const newUser = (tx: Prisma.TransactionClient) => {
  const tag = `cxp${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  return tx.user.create({ data: { handle: tag, displayName: tag } });
};

const xpOf = (tx: Prisma.TransactionClient, userId: string) =>
  tx.xpLedgerEntry.findMany({ where: { userId }, select: { source: true, xp: true }, orderBy: { createdAt: "asc" } });

describe("comment and forum XP values (Lucas, 06/11)", () => {
  it("comments pay 5; forum threads and replies pay 10", () => {
    expect(COMMENT_XP).toBe(5);
    expect(FORUM_POST_XP).toBe(10);
  });
});

describe.skipIf(!reachable)("comment and forum XP (database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("a comment pays 5, a forum reply and a new thread pay 10 each", () =>
    inRollback(async (tx) => {
      const { awardCommentXp } = await import("./xp");
      const user = await newUser(tx);
      expect(await awardCommentXp(tx, user.id, "comment_posted", "c1")).toBe(true);
      expect(await awardCommentXp(tx, user.id, "forum_post", "p1")).toBe(true);
      expect(await awardCommentXp(tx, user.id, "forum_thread", "t1")).toBe(true);
      // Idempotent per item.
      expect(await awardCommentXp(tx, user.id, "forum_thread", "t1")).toBe(false);
      expect(await xpOf(tx, user.id)).toEqual([
        { source: "comment_posted", xp: 5 },
        { source: "forum_post", xp: 10 },
        { source: "forum_thread", xp: 10 },
      ]);
    }));

  it("threads, replies and comments share one daily cap", () =>
    inRollback(async (tx) => {
      const { awardCommentXp } = await import("./xp");
      const user = await newUser(tx);
      const now = new Date("2026-11-06T15:00:00Z");
      for (let i = 0; i < COMMENT_XP_DAILY_CAP; i++) {
        const source = (["comment_posted", "forum_post", "forum_thread"] as const)[i % 3];
        expect(await awardCommentXp(tx, user.id, source, `k${i}`, now)).toBe(true);
      }
      expect(await awardCommentXp(tx, user.id, "forum_thread", "over", now)).toBe(false);
      expect(await tx.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(COMMENT_XP_DAILY_CAP);
    }));
});
