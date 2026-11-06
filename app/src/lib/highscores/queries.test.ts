import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { toLocalDay } from "@/lib/engine/streak";
import { allBoards, boardKey, type Board } from "./boards";
import { getBoardView, getRanking, getStanding, type Db } from "./queries";
import { SNAPSHOT_RETENTION_DAYS, takeRankSnapshots } from "./snapshot";

// These tests need Postgres up and seeded (see db.test.ts); skipped when unreachable.
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

/** Runs `fn` in a transaction that is always rolled back, so other tests never see its writes. */
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

describe.skipIf(!reachable)("highscores queries (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("recompute keeps UserRankStats in step with the library", async () => {
    const { prisma } = await import("@/lib/db");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const [stats, games] = await Promise.all([
      prisma.userRankStats.findMany({ where: { userId: lucas.id } }),
      prisma.userGame.findMany({ where: { userId: lucas.id }, select: { platform: true, playtimeMin: true } }),
    ]);
    expect(stats.map((s) => s.scope).sort()).toEqual(["all", "psn", "retro", "steam", "xbox"]);
    const sum = (rows: { playtimeMin: number }[]) => rows.reduce((acc, r) => acc + Math.max(0, r.playtimeMin), 0);
    expect(stats.find((s) => s.scope === "all")?.playtimeMin).toBe(sum(games));
    expect(stats.find((s) => s.scope === "steam")?.playtimeMin).toBe(sum(games.filter((g) => g.platform === "steam")));
  });

  it("every board is ordered, ranked 1..n, and each standing matches the listing", async () => {
    for (const board of allBoards()) {
      const rows = await getRanking(board, 500);
      expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
      for (let i = 1; i < rows.length; i++) {
        const [a, b] = [rows[i - 1], rows[i]];
        expect(a.value > b.value || (a.value === b.value && a.secondary >= b.secondary)).toBe(true);
      }
      if (board.metric !== "nivel" && board.metric !== "genero") {
        expect(rows.every((r) => r.value > 0)).toBe(true);
      }
      for (const row of rows.slice(0, 6)) {
        const standing = await getStanding(row.userId, board);
        expect(standing?.row.rank, `${boardKey(board)} @${row.handle}`).toBe(row.rank);
        expect(standing?.above?.handle ?? null).toBe(rows[row.rank - 2]?.handle ?? null);
      }
    }
  });

  it("the main boards have players in the seed", async () => {
    // The seed's sample players have hours and games but no unlocks: only lucas has achievements.
    const expected: [Board, number][] = [
      [{ metric: "nivel" }, 3],
      [{ metric: "horas", scope: "all" }, 3],
      [{ metric: "acervo", scope: "all" }, 3],
      [{ metric: "conquistas", scope: "all" }, 1],
      [{ metric: "raras", scope: "all" }, 1],
      [{ metric: "platinas", scope: "all" }, 1],
    ];
    for (const [board, min] of expected) {
      expect((await getRanking(board, 50)).length, boardKey(board)).toBeGreaterThanOrEqual(min);
    }
  });

  it("a private profile is neither listed nor ranked", async () => {
    const handle = `privado-hs-${Date.now()}`;
    const seen: Record<string, unknown> = {};
    await inRollback(async (tx) => {
      const user = await tx.user.create({
        data: {
          handle,
          displayName: handle,
          profilePublic: false,
          stats: { create: { totalXp: 999_999_999, level: 99, vocation: "Recruta" } },
          rankStats: { create: { scope: "all", playtimeMin: 99_999_999, acervo: 1 } },
        },
      });
      const horas = { metric: "horas", scope: "all" } as const;
      seen.listed = (await getRanking(horas, 500, tx)).some((r) => r.handle === handle);
      seen.standing = await getStanding(user.id, horas, new Date(), tx);
      await tx.user.update({ where: { id: user.id }, data: { profilePublic: true } });
      seen.top = (await getRanking(horas, 1, tx))[0]?.handle;
      seen.rank = (await getStanding(user.id, horas, new Date(), tx))?.row.rank;
      seen.nivelTop = (await getRanking({ metric: "nivel" }, 1, tx))[0]?.handle;
    });
    expect(seen).toEqual({ listed: false, standing: null, top: handle, rank: 1, nivelTop: handle });
  });

  it("'Esta semana' leaves out XP of unlocks of unknown date (recorded this week, not earned this week)", async () => {
    const handle = `semdata-hs-${Date.now()}`;
    const seen: Record<string, unknown> = {};
    await inRollback(async (tx) => {
      const now = new Date();
      const user = await tx.user.create({ data: { handle, displayName: handle, profilePublic: true } });
      const entry = { userId: user.id, source: "achievement", xp: 900_000_000, skills: [], createdAt: now };
      await tx.xpLedgerEntry.create({ data: { ...entry, sourceKey: "undated", dateUnknown: true } });
      const semana = { metric: "semana" } as const;
      seen.undatedListed = (await getRanking(semana, 500, tx, now)).some((r) => r.handle === handle);
      seen.undatedStanding = await getStanding(user.id, semana, now, tx);
      await tx.xpLedgerEntry.create({ data: { ...entry, sourceKey: "dated", xp: 5 } });
      seen.datedXp = (await getStanding(user.id, semana, now, tx))?.row.value;
    });
    expect(seen).toEqual({ undatedListed: false, undatedStanding: null, datedXp: 5 });
  });

  it("two overlapping snapshot runs write each board once, with one consistent ranking", async () => {
    const { prisma } = await import("@/lib/db");
    // A day no other test or cron touches; pruning off so nothing else is deleted.
    const now = new Date("2031-03-15T15:00:00Z");
    const day = toLocalDay(now);
    try {
      // Another run holds the "nivel" board of that day and has written (not yet committed) its row.
      const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const other = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rank-snapshot:nivel:${day}`}))`;
          await tx.rankSnapshot.create({ data: { board: "nivel", day, userId: lucas.id, rank: 99 } });
          locked();
          await released;
        },
        { timeout: 30_000 },
      );
      await isLocked;
      const run = takeRankSnapshots(now, prisma, { prune: false });
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      await other;
      const first = await run;
      // The run waited for the lock, then found the board taken: the other run's ranking stays whole.
      const nivel = await prisma.rankSnapshot.findMany({ where: { day, board: "nivel" } });
      expect(nivel.map((r) => r.rank)).toEqual([99]);

      // A second run the same day adds nothing; every other board holds one ranking 1..n.
      expect((await takeRankSnapshots(now, prisma, { prune: false })).rows).toBe(0);
      const rows = await prisma.rankSnapshot.findMany({ where: { day } });
      expect(first.rows).toBe(rows.length - 1);
      for (const board of allBoards().filter((b) => b.metric !== "nivel")) {
        const key = boardKey(board);
        const ranks = rows.filter((r) => r.board === key).map((r) => r.rank).sort((x, y) => x - y);
        expect(ranks, key).toEqual(ranks.map((_, i) => i + 1));
      }
    } finally {
      await prisma.rankSnapshot.deleteMany({ where: { day } });
    }
  });

  it("arrows compare with the latest earlier snapshot; the snapshot is once a day and pruned", async () => {
    const now = new Date("2026-11-20T15:00:00Z");
    const yesterday = new Date(now.getTime() - DAY_MS);
    const board = { metric: "horas", scope: "all" } as const;
    const key = boardKey(board);
    const seen: Record<string, unknown> = {};
    await inRollback(async (tx) => {
      // Older snapshots of other tests' runs must not interfere.
      await tx.rankSnapshot.deleteMany({});
      expect((await getBoardView(board, 50, now, tx)).snapshotDay).toBeNull();

      const first = await takeRankSnapshots(yesterday, tx);
      expect(first.rows).toBeGreaterThan(0);
      // A second run the same day changes nothing.
      expect((await takeRankSnapshots(yesterday, tx)).rows).toBe(0);

      const rows = (await getBoardView(board, 50, now, tx)).rows;
      const [leader, second] = rows;
      // Yesterday the leader was 4th, and the second place was not in the snapshot at all.
      await tx.rankSnapshot.update({
        where: { board_day_userId: { board: key, day: toLocalDay(yesterday), userId: leader.userId } },
        data: { rank: 4 },
      });
      await tx.rankSnapshot.delete({
        where: { board_day_userId: { board: key, day: toLocalDay(yesterday), userId: second.userId } },
      });
      const view = await getBoardView(board, 50, now, tx);
      seen.day = view.snapshotDay;
      seen.leader = { previousRank: view.rows[0].previousRank, isNew: view.rows[0].isNew };
      seen.second = { previousRank: view.rows[1].previousRank, isNew: view.rows[1].isNew };
      seen.standing = (await getStanding(leader.userId, board, now, tx))?.row.previousRank;
      // Today's own snapshot is not the reference (the arrows show the change since yesterday).
      await takeRankSnapshots(now, tx);
      seen.dayAfterToday = (await getBoardView(board, 50, now, tx)).snapshotDay;

      await tx.rankSnapshot.create({
        data: {
          board: key,
          day: toLocalDay(new Date(now.getTime() - (SNAPSHOT_RETENTION_DAYS + 3) * DAY_MS)),
          userId: leader.userId,
          rank: 1,
        },
      });
      seen.pruned = (await takeRankSnapshots(now, tx)).pruned;
    });
    expect(seen).toEqual({
      day: "2026-11-19",
      leader: { previousRank: 4, isNew: false },
      second: { previousRank: null, isNew: true },
      standing: 4,
      dayAfterToday: "2026-11-19",
      pruned: 1,
    });
  });
});
