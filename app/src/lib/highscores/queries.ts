import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { boardKey, type Board, type StatMetric } from "./boards";

/** Any Prisma client; tests pass a transaction client to see uncommitted fixtures. */
export type Db = Prisma.TransactionClient;

/** Positions shown on the page. */
export const TOP_SIZE = 50;
/** Positions kept per board in each daily snapshot (arrows beyond it are not shown). */
export const SNAPSHOT_SIZE = 200;

/** Ordering of each UserRankStats board, most significant first (ties end on the handle). */
const STAT_FIELDS = {
  horas: ["playtimeMin"],
  conquistas: ["achievements"],
  raras: ["rareAchievements", "legendaryAchievements"],
  platinas: ["perfectGames", "achievements"],
  acervo: ["acervo", "gamesOwned"],
} as const satisfies Record<StatMetric, readonly string[]>;

type StatField = (typeof STAT_FIELDS)[StatMetric][number];

/** A skill counts for its genre ranking only once trained (level above 1 or any points). */
const TRAINED = { OR: [{ level: { gt: 1 } }, { points: { gt: 0 } }] };

const USER_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  avatarUrl: true,
  stats: { select: { vocation: true, level: true, totalXp: true } },
} as const;

type SelectedUser = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  stats: { vocation: string; level: number; totalXp: number } | null;
};

/** A ranked player, without position. */
export type RankedPlayer = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  vocation: string;
  /** Character level (every board shows it). */
  level: number;
  totalXp: number;
  /**
   * The ranked value: level (nivel), skill level (genero), minutes (horas), unlocks
   * (conquistas), rare unlocks (raras), 100% games (platinas), Acervo points (acervo).
   */
  value: number;
  /**
   * The tie-breaker shown beside it: total XP (nivel), skill points (genero), legendary unlocks
   * (raras), unlocks (platinas), owned games (acervo); 0 for horas and conquistas.
   */
  secondary: number;
  /** Acervo only: games played. */
  extra: number;
};

export type BoardRow = RankedPlayer & {
  rank: number;
  /** Rank in the reference snapshot; null when there is none or the player was not in it. */
  previousRank: number | null;
  /** The reference snapshot exists and the player entered its range since. */
  isNew: boolean;
};

export type BoardView = {
  key: string;
  rows: BoardRow[];
  /** Day (YYYY-MM-DD) of the snapshot the arrows compare with; null before the first one. */
  snapshotDay: string | null;
};

export type Standing = {
  row: BoardRow;
  /** The player right above (null at #1). */
  above: RankedPlayer | null;
};

function player(user: SelectedUser, value: number, secondary: number, extra = 0): RankedPlayer {
  return {
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    vocation: user.stats?.vocation ?? "Recruta",
    level: user.stats?.level ?? 1,
    totalXp: user.stats?.totalXp ?? 0,
    value,
    secondary,
    extra,
  };
}

/**
 * Prisma `where` for "ranks ahead of these values" on ordered `fields` (all descending), ties
 * broken by handle ascending: strictly greater on the first field that differs, or all equal and
 * an earlier handle.
 */
function aheadOf(fields: readonly string[], values: number[], handle: string) {
  const equal = (n: number) => Object.fromEntries(fields.slice(0, n).map((f, i) => [f, values[i]]));
  return {
    OR: [
      ...fields.map((field, i) => ({ ...equal(i), [field]: { gt: values[i] } })),
      { ...equal(fields.length), user: { handle: { lt: handle } } },
    ],
  };
}

/** Board order (`desc`), or its reverse (`asc`: the closest players ahead come first). */
const orderBy = (fields: readonly string[], direction: "asc" | "desc") => [
  ...fields.map((f) => ({ [f]: direction })),
  { user: { handle: direction === "desc" ? "asc" : "desc" } },
];

type Window = { where?: object; take: number; reverse?: boolean };

/** Ranked players of a board in order (or, reversed, the closest ones ahead first). */
async function playersOf(board: Board, window: Window, db: Db): Promise<RankedPlayer[]> {
  const direction = window.reverse ? "asc" : "desc";
  const publicUser = { user: { profilePublic: true } };

  if (board.metric === "nivel") {
    const fields = ["level", "totalXp"];
    const rows = await db.userStats.findMany({
      where: { AND: [publicUser, window.where ?? {}] },
      orderBy: orderBy(fields, direction) as Prisma.UserStatsOrderByWithRelationInput[],
      take: window.take,
      select: { level: true, totalXp: true, user: { select: USER_SELECT } },
    });
    return rows.map((r) => player(r.user, r.level, r.totalXp));
  }

  if (board.metric === "genero") {
    const fields = ["level", "points"];
    const rows = await db.skillProgress.findMany({
      where: { AND: [{ skill: board.skill }, publicUser, TRAINED, window.where ?? {}] },
      orderBy: orderBy(fields, direction) as Prisma.SkillProgressOrderByWithRelationInput[],
      take: window.take,
      select: { level: true, points: true, user: { select: USER_SELECT } },
    });
    return rows.map((r) => player(r.user, r.level, r.points));
  }

  const fields: readonly StatField[] = STAT_FIELDS[board.metric];
  const rows = await db.userRankStats.findMany({
    where: { AND: [{ scope: board.scope, [fields[0]]: { gt: 0 } }, publicUser, window.where ?? {}] },
    orderBy: orderBy(fields, direction) as Prisma.UserRankStatsOrderByWithRelationInput[],
    take: window.take,
    select: {
      playtimeMin: true,
      achievements: true,
      rareAchievements: true,
      legendaryAchievements: true,
      perfectGames: true,
      gamesOwned: true,
      gamesPlayed: true,
      acervo: true,
      user: { select: USER_SELECT },
    },
  });
  return rows.map((r) => {
    const [primary, second] = fields;
    return player(r.user, r[primary], second ? r[second] : 0, board.metric === "acervo" ? r.gamesPlayed : 0);
  });
}

/** The values a player is ranked by on a board (and Acervo's games played); null when unranked there. */
async function valuesOf(
  userId: string,
  board: Board,
  db: Db,
): Promise<{ values: number[]; extra: number } | null> {
  if (board.metric === "nivel") {
    const stats = await db.userStats.findUnique({ where: { userId } });
    return stats ? { values: [stats.level, stats.totalXp], extra: 0 } : null;
  }
  if (board.metric === "genero") {
    const progress = await db.skillProgress.findFirst({ where: { userId, skill: board.skill, ...TRAINED } });
    return progress ? { values: [progress.level, progress.points], extra: 0 } : null;
  }
  const fields = STAT_FIELDS[board.metric];
  const stats = await db.userRankStats.findUnique({
    where: { userId_scope: { userId, scope: board.scope } },
  });
  if (!stats || stats[fields[0]] <= 0) return null;
  return {
    values: fields.map((f) => stats[f]),
    extra: board.metric === "acervo" ? stats.gamesPlayed : 0,
  };
}

/** Count of public players ranked ahead of `values` on a board. */
async function countAhead(board: Board, values: number[], handle: string, db: Db): Promise<number> {
  const publicUser = { user: { profilePublic: true } };
  if (board.metric === "nivel") {
    return db.userStats.count({
      where: { AND: [publicUser, aheadOf(["level", "totalXp"], values, handle)] },
    });
  }
  if (board.metric === "genero") {
    return db.skillProgress.count({
      where: {
        AND: [{ skill: board.skill }, publicUser, TRAINED, aheadOf(["level", "points"], values, handle)],
      },
    });
  }
  const fields = STAT_FIELDS[board.metric];
  return db.userRankStats.count({
    where: { AND: [{ scope: board.scope, [fields[0]]: { gt: 0 } }, publicUser, aheadOf(fields, values, handle)] },
  });
}

function fieldsOf(board: Board): readonly string[] {
  if (board.metric === "nivel") return ["level", "totalXp"];
  if (board.metric === "genero") return ["level", "points"];
  return STAT_FIELDS[board.metric];
}

/**
 * The snapshot the arrows compare with: the latest one of an earlier day than `today`, and the
 * ranks it holds for `userIds`.
 */
export async function previousRanks(
  key: string,
  userIds: string[],
  today: string,
  db: Db = prisma,
): Promise<{ day: string | null; ranks: Map<string, number> }> {
  const ref = await db.rankSnapshot.findFirst({
    where: { board: key, day: { lt: today } },
    orderBy: { day: "desc" },
    select: { day: true },
  });
  if (!ref || userIds.length === 0) return { day: ref?.day ?? null, ranks: new Map() };
  const rows = await db.rankSnapshot.findMany({
    where: { board: key, day: ref.day, userId: { in: userIds } },
    select: { userId: true, rank: true },
  });
  return { day: ref.day, ranks: new Map(rows.map((r) => [r.userId, r.rank])) };
}

function withHistory(
  p: RankedPlayer,
  rank: number,
  history: { day: string | null; ranks: Map<string, number> },
): BoardRow {
  const previousRank = history.ranks.get(p.userId) ?? null;
  return {
    ...p,
    rank,
    previousRank,
    isNew: history.day !== null && previousRank === null && rank <= SNAPSHOT_SIZE,
  };
}

/** Ranked players of a board, best first, ranks 1..n, without history (the snapshot job). */
export async function getRanking(board: Board, limit: number, db: Db = prisma) {
  const players = await playersOf(board, { take: limit }, db);
  return players.map((p, i) => ({ ...p, rank: i + 1 }));
}

/** The top of a board with the rank changes since the reference snapshot. */
export async function getBoardView(
  board: Board,
  limit = TOP_SIZE,
  now = new Date(),
  db: Db = prisma,
): Promise<BoardView> {
  const key = boardKey(board);
  const players = await playersOf(board, { take: limit }, db);
  const history = await previousRanks(key, players.map((p) => p.userId), toLocalDay(now), db);
  return {
    key,
    rows: players.map((p, i) => withHistory(p, i + 1, history)),
    snapshotDay: history.day,
  };
}

/**
 * A player's rank on a board (among public profiles, same ordering as the list): two indexed
 * reads and a count. Null when the profile is private or unranked there. The character sheet's
 * "#N no ranking" uses it with Nível.
 */
export async function getRank(userId: string, board: Board, db: Db = prisma): Promise<number | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { handle: true, profilePublic: true } });
  if (!user?.profilePublic) return null;
  const ranked = await valuesOf(userId, board, db);
  if (!ranked) return null;
  return (await countAhead(board, ranked.values, user.handle, db)) + 1;
}

/**
 * Where a player stands on a board (real rank among public profiles, same ordering as the list),
 * with the player right above; null when the profile is private or unranked there. Computed live:
 * the cached top list it is shown with can be a few minutes older, so the two may briefly disagree.
 */
export async function getStanding(
  userId: string,
  board: Board,
  now = new Date(),
  db: Db = prisma,
): Promise<Standing | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { ...USER_SELECT, profilePublic: true },
  });
  if (!user?.profilePublic) return null;
  const ranked = await valuesOf(userId, board, db);
  if (!ranked) return null;
  const { values, extra } = ranked;

  const [ahead, aboveRows, history] = await Promise.all([
    countAhead(board, values, user.handle, db),
    playersOf(board, { where: aheadOf(fieldsOf(board), values, user.handle), take: 1, reverse: true }, db),
    previousRanks(boardKey(board), [userId], toLocalDay(now), db),
  ]);
  const me = player(user, values[0], values[1] ?? 0, extra);
  return { row: withHistory(me, ahead + 1, history), above: aboveRows[0] ?? null };
}
