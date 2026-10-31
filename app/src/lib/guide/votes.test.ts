import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";

async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
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

/**
 * Runs `fn` in a transaction that is always rolled back. The seeded database is shared with
 * other test files (and other agents) that count rows, so nothing here may be committed.
 */
async function inRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  const { prisma } = await import("@/lib/db");
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function fixtures(tx: Prisma.TransactionClient, withAuthor = true) {
  const tag = `votetest${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const guide = await tx.guide.findFirstOrThrow({ where: { game: { slug: "hollow-knight" } } });
  const author = await tx.user.create({
    data: { steamId: `${tag}-a`, handle: `${tag}-a`, displayName: "Tip author" },
  });
  const voter = await tx.user.create({
    data: { steamId: `${tag}-v`, handle: `${tag}-v`, displayName: "Voter" },
  });
  const tip = await tx.guideTip.create({
    data: { guideId: guide.id, authorId: withAuthor ? author.id : null, body: "tip", votes: 0 },
  });
  return { author, voter, tip };
}

describe.skipIf(!reachable)("castTipVoteIn", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("voting twice creates one vote and one ledger entry for the tip author", () =>
    inRollback(async (tx) => {
      const { castTipVoteIn } = await import("./votes");
      const { author, voter, tip } = await fixtures(tx);

      const first = await castTipVoteIn(tx, tip.id, voter.id);
      const second = await castTipVoteIn(tx, tip.id, voter.id);

      expect(first).toEqual({ status: "voted", authorUserId: author.id, votes: 1 });
      expect(second.status).toBe("already_voted");

      expect(await tx.guideVote.count({ where: { tipId: tip.id } })).toBe(1);
      expect((await tx.guideTip.findUniqueOrThrow({ where: { id: tip.id } })).votes).toBe(1);

      const ledger = await tx.xpLedgerEntry.findMany({
        where: { source: "guide_vote", sourceKey: `${tip.id}:${voter.id}` },
      });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ userId: author.id, xp: 25, skills: ["sabio"] });
    }));

  it("does not let users vote on their own tip", () =>
    inRollback(async (tx) => {
      const { castTipVoteIn } = await import("./votes");
      const { author, tip } = await fixtures(tx);

      const result = await castTipVoteIn(tx, tip.id, author.id);

      expect(result.status).toBe("own_tip");
      expect(await tx.guideVote.count({ where: { tipId: tip.id } })).toBe(0);
      expect(await tx.xpLedgerEntry.count({ where: { userId: author.id } })).toBe(0);
    }));

  it("records the vote but no ledger entry when the tip author has no user", () =>
    inRollback(async (tx) => {
      const { castTipVoteIn } = await import("./votes");
      const { voter, tip } = await fixtures(tx, false);

      const result = await castTipVoteIn(tx, tip.id, voter.id);

      expect(result).toEqual({ status: "voted", authorUserId: null, votes: 1 });
      expect(await tx.guideVote.count({ where: { tipId: tip.id } })).toBe(1);
      expect(
        await tx.xpLedgerEntry.count({ where: { sourceKey: `${tip.id}:${voter.id}` } }),
      ).toBe(0);
    }));

  it("reports unknown tips", () =>
    inRollback(async (tx) => {
      const { castTipVoteIn } = await import("./votes");
      const { voter } = await fixtures(tx);
      expect((await castTipVoteIn(tx, "does-not-exist", voter.id)).status).toBe("not_found");
    }));
});
