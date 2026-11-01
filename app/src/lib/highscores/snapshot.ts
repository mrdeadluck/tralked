import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { allBoards, boardKey } from "./boards";
import { getRanking, SNAPSHOT_SIZE, type Db } from "./queries";

/** Snapshots older than this many days are deleted (the arrows only need the latest earlier one). */
export const SNAPSHOT_RETENTION_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Daily `highscores` cron: records the top `SNAPSHOT_SIZE` of every board for today (America/Sao_Paulo).
 * The first run of a day wins (a board already taken today is skipped), so a snapshot is the ranking
 * at the start of the day and tomorrow's arrows compare with it. Also prunes old snapshots.
 */
export async function takeRankSnapshots(
  now = new Date(),
  db: Db = prisma,
): Promise<{ processed: number; rows: number; pruned: number }> {
  const day = toLocalDay(now);
  let rows = 0;
  const boards = allBoards();
  for (const board of boards) {
    const key = boardKey(board);
    // One consistent ranking per board and day: a board already taken today is left alone.
    if (await db.rankSnapshot.findFirst({ where: { board: key, day }, select: { rank: true } })) continue;
    const ranking = await getRanking(board, SNAPSHOT_SIZE, db);
    if (ranking.length === 0) continue;
    const { count } = await db.rankSnapshot.createMany({
      data: ranking.map((r) => ({ board: key, day, userId: r.userId, rank: r.rank })),
      skipDuplicates: true,
    });
    rows += count;
  }
  const oldest = toLocalDay(new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * DAY_MS));
  const { count: pruned } = await db.rankSnapshot.deleteMany({ where: { day: { lt: oldest } } });
  return { processed: boards.length, rows, pruned };
}
