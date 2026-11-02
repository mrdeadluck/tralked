import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { toLocalDay } from "@/lib/engine/streak";
import { NOVATO_MAX_LEVEL } from "./boards";
import { passedPairs } from "./passed";
import type { Db } from "./queries";

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
const DAY_MS = 86_400_000;

class Rollback extends Error {}

async function inRollback(fn: (tx: Db) => Promise<void>) {
  const { prisma } = await import("@/lib/db");
  await prisma
    .$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 60_000 },
    )
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

async function players(tx: Db, n: number) {
  const tag = `rb${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      tx.user.create({ data: { handle: `${tag}-${i}`, displayName: `P ${i}`, profilePublic: true } }),
    ),
  );
}

describe("passedPairs", () => {
  it("names the closest player who climbed over each one who fell", () => {
    const before = new Map([
      ["ana", 1],
      ["bia", 2],
      ["caio", 3],
      ["duda", 4],
    ]);
    const after = new Map([
      ["duda", 1],
      ["ana", 2],
      ["bia", 3],
      ["caio", 4],
    ]);
    expect(passedPairs(before, after)).toEqual([
      { userId: "ana", passerId: "duda", from: 1, to: 2 },
      { userId: "bia", passerId: "duda", from: 2, to: 3 },
      { userId: "caio", passerId: "duda", from: 3, to: 4 },
    ]);
  });

  it("counts a newcomer as a passer and ignores players who held or rose", () => {
    expect(passedPairs(new Map([["ana", 1]]), new Map([["novo", 1], ["ana", 2]]))).toEqual([
      { userId: "ana", passerId: "novo", from: 1, to: 2 },
    ]);
    expect(passedPairs(new Map([["ana", 2], ["bia", 1]]), new Map([["ana", 1], ["bia", 2]]))).toEqual([
      { userId: "bia", passerId: "ana", from: 1, to: 2 },
    ]);
    expect(passedPairs(new Map([["ana", 1]]), new Map([["ana", 1]]))).toEqual([]);
  });
});

describe.skipIf(!reachable)("reward-loop boards and nudges (database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("Esta semana ranks the XP of the last 7 days only, voided entries left out", () =>
    inRollback(async (tx) => {
      const { getRanking, getStanding } = await import("./queries");
      const now = new Date();
      const [a, b, c] = await players(tx, 3);
      const entry = (userId: string, xp: number, daysAgo: number, key: string, voided = false) => ({
        userId,
        source: "test",
        sourceKey: key,
        xp,
        skills: [],
        createdAt: new Date(now.getTime() - daysAgo * DAY_MS),
        voidedAt: voided ? now : null,
      });
      await tx.xpLedgerEntry.createMany({
        data: [
          entry(a.id, 900_000_000, 1, "a1"), // huge: tops any seeded player
          entry(b.id, 800_000_000, 2, "b1"),
          entry(b.id, 200_000_000, 3, "b2"), // b: 1.000.000.000 this week
          entry(c.id, 950_000_000, 9, "c1"), // outside the window
          entry(c.id, 990_000_000, 1, "c2", true), // voided
        ],
      });
      const rows = await getRanking({ metric: "semana" }, 5, tx, now);
      expect(rows.slice(0, 2).map((r) => [r.handle, r.value])).toEqual([
        [b.handle, 1_000_000_000],
        [a.handle, 900_000_000],
      ]);
      expect(rows.some((r) => r.userId === c.id)).toBe(false);

      const standing = await getStanding(a.id, { metric: "semana" }, now, tx);
      expect(standing?.row.rank).toBe(2);
      expect(standing?.above?.handle).toBe(b.handle);
      expect(await getStanding(c.id, { metric: "semana" }, now, tx)).toBeNull();
    }));

  it("Novatos keeps only players up to the level cap", () =>
    inRollback(async (tx) => {
      const { getRanking, getStanding } = await import("./queries");
      const [rookie, veteran] = await players(tx, 2);
      await tx.userStats.createMany({
        data: [
          { userId: rookie.id, totalXp: 1, level: NOVATO_MAX_LEVEL, vocation: "Recruta" },
          { userId: veteran.id, totalXp: 2, level: NOVATO_MAX_LEVEL + 1, vocation: "Recruta" },
        ],
      });
      const rows = await getRanking({ metric: "novatos" }, 500, tx);
      expect(rows.every((r) => r.value <= NOVATO_MAX_LEVEL)).toBe(true);
      expect(rows.some((r) => r.userId === rookie.id)).toBe(true);
      expect(await getStanding(veteran.id, { metric: "novatos" }, new Date(), tx)).toBeNull();
    }));

  it("tells a passed player who passed them, once a day", () =>
    inRollback(async (tx) => {
      const { notifyRankPassed } = await import("./passed");
      const now = new Date();
      const today = toLocalDay(now);
      const yesterday = toLocalDay(new Date(now.getTime() - DAY_MS));
      const [ana, duda] = await players(tx, 2);
      const board = "conquistas:all";
      await tx.rankSnapshot.deleteMany({ where: { board, day: { in: [today, yesterday] } } });
      await tx.rankSnapshot.createMany({
        data: [
          { board, day: yesterday, userId: ana.id, rank: 1 },
          { board, day: yesterday, userId: duda.id, rank: 2 },
          { board, day: today, userId: duda.id, rank: 1 },
          { board, day: today, userId: ana.id, rank: 2 },
        ],
      });
      expect(await notifyRankPassed([board], now, tx)).toEqual({ processed: 1 });
      const [note] = await tx.notification.findMany({ where: { userId: ana.id, kind: "rank_passed" } });
      expect(note).toMatchObject({ title: `@${duda.handle} te passou em Conquistas`, href: "/highscores/conquistas" });
      // A second run the same day writes nothing.
      expect(await notifyRankPassed([board], now, tx)).toEqual({ processed: 0 });
    }));

  it("nudges players whose streak ends today, once", () =>
    inRollback(async (tx) => {
      const { notifyStreakRisk } = await import("@/lib/notifications/streak-risk");
      const now = new Date();
      const [atRisk, safe, shielded] = await players(tx, 3);
      const game = await tx.game.findFirstOrThrow({ select: { id: true } });
      const achievement = await tx.achievement.findFirstOrThrow({ where: { gameId: game.id }, select: { id: true } });
      await tx.userStats.createMany({
        data: [
          { userId: atRisk.id, totalXp: 1, level: 1, vocation: "Recruta", streakCurrent: 4 },
          { userId: safe.id, totalXp: 1, level: 1, vocation: "Recruta", streakCurrent: 4 },
          { userId: shielded.id, totalXp: 1, level: 1, vocation: "Recruta", streakCurrent: 9, shields: 1 },
        ],
      });
      const yesterdayNoon = new Date(`${toLocalDay(new Date(now.getTime() - DAY_MS))}T15:00:00Z`);
      await tx.userAchievement.createMany({
        data: [
          { userId: atRisk.id, achievementId: achievement.id, unlockedAt: yesterdayNoon },
          { userId: safe.id, achievementId: achievement.id, unlockedAt: now },
          { userId: shielded.id, achievementId: achievement.id, unlockedAt: yesterdayNoon },
        ],
      });
      await notifyStreakRisk(now, tx);
      const sent = await tx.notification.findMany({
        where: { kind: "streak_risk", userId: { in: [atRisk.id, safe.id, shielded.id] } },
      });
      expect(sent.map((n) => [n.userId, n.title])).toEqual([[atRisk.id, "Sua sequência de 4 dias acaba hoje"]]);
      await notifyStreakRisk(now, tx);
      expect(await tx.notification.count({ where: { kind: "streak_risk", userId: atRisk.id } })).toBe(1);
    }));
});
