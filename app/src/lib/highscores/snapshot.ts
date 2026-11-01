import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { allBoards, boardKey } from "./boards";
import { getRanking, SNAPSHOT_SIZE, type Db } from "./queries";

/** Snapshots older than this many days are deleted (the arrows only need the latest earlier one). */
export const SNAPSHOT_RETENTION_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Runs `fn` in a transaction: a new one on the app client, or the caller's when `db` already is a
 * transaction client (tests).
 */
function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return "$transaction" in db
    ? (db as typeof prisma).$transaction(fn, { timeout: 30_000, maxWait: 10_000 })
    : fn(db);
}

/**
 * Daily `highscores` cron: records the top `SNAPSHOT_SIZE` of every board for today (America/Sao_Paulo).
 * The first run of a day wins, so a snapshot is the ranking at the start of the day and tomorrow's
 * arrows compare with it. Each board is taken in its own transaction holding an advisory lock on
 * (board, day): two overlapping runs never mix two rankings in one snapshot (the second one waits,
 * then finds the board taken and skips it). Also prunes old snapshots (`prune: false` skips it).
 */
export async function takeRankSnapshots(
  now = new Date(),
  db: Db = prisma,
  { prune = true } = {},
): Promise<{ processed: number; rows: number; pruned: number }> {
  const day = toLocalDay(now);
  let rows = 0;
  const boards = allBoards();
  for (const board of boards) {
    const key = boardKey(board);
    rows += await inTransaction(db, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rank-snapshot:${key}:${day}`}))`;
      if (await tx.rankSnapshot.findFirst({ where: { board: key, day }, select: { rank: true } })) return 0;
      const ranking = await getRanking(board, SNAPSHOT_SIZE, tx);
      if (ranking.length === 0) return 0;
      const { count } = await tx.rankSnapshot.createMany({
        data: ranking.map((r) => ({ board: key, day, userId: r.userId, rank: r.rank })),
        skipDuplicates: true,
      });
      return count;
    });
  }
  let pruned = 0;
  if (prune) {
    const oldest = toLocalDay(new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * DAY_MS));
    ({ count: pruned } = await db.rankSnapshot.deleteMany({ where: { day: { lt: oldest } } }));
  }
  return { processed: boards.length, rows, pruned };
}
