import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { boardFromKey, boardHref, boardTitle } from "./boards";
import type { Db } from "./queries";

/**
 * Boards that can send "@x te passou em <quadro>", most important first: a player passed on
 * several boards the same day hears only about the first one.
 */
export const PASSED_BOARDS = [
  "nivel",
  "semana",
  "novatos",
  "conquistas:all",
  "horas:all",
  "raras:all",
  "platinas:all",
  "acervo:all",
] as const;

/** Most "te passou" notifications one run writes. */
export const PASSED_MAX_PER_RUN = 500;

type Snapshot = Map<string, number>;

/**
 * Who passed whom between two snapshots of one board: for every player who lost positions, the
 * closest player now right above them who was below them (or outside the top) before.
 * Pure, so it is easy to test.
 */
export function passedPairs(before: Snapshot, after: Snapshot): { userId: string; passerId: string; from: number; to: number }[] {
  const byRank = [...after].sort((a, b) => a[1] - b[1]);
  const pairs: { userId: string; passerId: string; from: number; to: number }[] = [];
  for (const [userId, to] of after) {
    const from = before.get(userId);
    if (from === undefined || to <= from) continue;
    // Closest above today: highest rank number still ahead of the player.
    for (let i = byRank.length - 1; i >= 0; i--) {
      const [passerId, passerRank] = byRank[i];
      if (passerRank >= to || passerId === userId) continue;
      const passerBefore = before.get(passerId);
      if (passerBefore === undefined || passerBefore > from) {
        pairs.push({ userId, passerId, from, to });
        break;
      }
    }
  }
  return pairs;
}

/**
 * After the daily snapshot: "@fulano te passou em Nível" for players who lost positions since
 * the previous snapshot. Rate limited: one per player per day (the first board of PASSED_BOARDS
 * that applies), at most PASSED_MAX_PER_RUN per run, only for boards whose snapshot this run took
 * (`fresh`), so a second run the same day sends nothing.
 */
export async function notifyRankPassed(
  fresh: string[],
  now: Date = new Date(),
  db: Db = prisma,
): Promise<{ processed: number }> {
  const today = toLocalDay(now);
  const boards = PASSED_BOARDS.filter((key) => fresh.includes(key));
  if (boards.length === 0) return { processed: 0 };

  const chosen = new Map<string, { passerId: string; board: string; from: number; to: number }>();
  for (const key of boards) {
    const ref = await db.rankSnapshot.findFirst({
      where: { board: key, day: { lt: today } },
      orderBy: { day: "desc" },
      select: { day: true },
    });
    if (!ref) continue;
    const [beforeRows, afterRows] = await Promise.all([
      db.rankSnapshot.findMany({ where: { board: key, day: ref.day }, select: { userId: true, rank: true } }),
      db.rankSnapshot.findMany({ where: { board: key, day: today }, select: { userId: true, rank: true } }),
    ]);
    const pairs = passedPairs(
      new Map(beforeRows.map((r) => [r.userId, r.rank])),
      new Map(afterRows.map((r) => [r.userId, r.rank])),
    );
    for (const pair of pairs) {
      if (!chosen.has(pair.userId)) chosen.set(pair.userId, { ...pair, board: key });
    }
  }
  if (chosen.size === 0) return { processed: 0 };

  const userIds = [...chosen.keys()];
  const [already, passers] = await Promise.all([
    db.notification.findMany({
      where: { userId: { in: userIds }, kind: "rank_passed", createdAt: { gte: new Date(now.getTime() - 20 * 3_600_000) } },
      select: { userId: true },
    }),
    db.user.findMany({
      where: { id: { in: [...new Set([...chosen.values()].map((c) => c.passerId))] } },
      select: { id: true, handle: true },
    }),
  ]);
  const skip = new Set(already.map((n) => n.userId));
  const handle = new Map(passers.map((p) => [p.id, p.handle]));

  const data = [...chosen]
    .filter(([userId, c]) => !skip.has(userId) && handle.has(c.passerId))
    .slice(0, PASSED_MAX_PER_RUN)
    .flatMap(([userId, c]) => {
      const board = boardFromKey(c.board);
      if (!board) return [];
      return [
        {
          userId,
          kind: "rank_passed",
          title: `@${handle.get(c.passerId)} te passou em ${boardTitle(board)}`,
          body: `Você foi do ${c.from}º para o ${c.to}º lugar. Dá tempo de recuperar.`,
          href: boardHref(board),
          createdAt: now,
        },
      ];
    });
  if (data.length === 0) return { processed: 0 };
  const { count } = await db.notification.createMany({ data });
  return { processed: count };
}
