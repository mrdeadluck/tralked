import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { boardKey, NOVATO_MAX_LEVEL, WEEK_DAYS, type Board, type StatMetric } from "./boards";

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

const DAY_MS = 86_400_000;

/** Start of the Esta semana window (rolling 7 days). */
export const weekStart = (now: Date) => new Date(now.getTime() - WEEK_DAYS * DAY_MS);

/** Novatos: the level board among players up to NOVATO_MAX_LEVEL. */
const NOVATO = { level: { lte: NOVATO_MAX_LEVEL } };

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
   * The ranked value: level (nivel, novatos), XP of the last 7 days (semana), skill level (genero), minutes (horas), unlocks
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

type WeeklyRow = { userId: string; xp: number };

/**
 * XP of the last 7 days per public player (ledger entries by `createdAt`, voided ones left out),
 * most first; `above` keeps only totals over it (closest first when `reverse`). Indexed by
 * XpLedgerEntry(createdAt): only the window's entries are read.
 */
async function weeklyTotals(
  db: Db,
  now: Date,
  options: { take: number; above?: number; reverse?: boolean },
): Promise<WeeklyRow[]> {
  const groups = await db.xpLedgerEntry.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: weekStart(now), lte: now }, voidedAt: null, user: { profilePublic: true } },
    _sum: { xp: true },
    having: { xp: { _sum: { gt: options.above ?? 0 } } },
    orderBy: [{ _sum: { xp: options.reverse ? "asc" : "desc" } }, { userId: "asc" }],
    take: options.take,
  });
  return groups.map((g) => ({ userId: g.userId, xp: g._sum.xp ?? 0 }));
}

/** Ledger sources paid by the community: photos, comments, reactions, forum answers and guide tip votes. */
export const COMMUNITY_SOURCES = [
  "photo_approved",
  "comment_posted",
  "forum_post",
  "reaction_given",
  "reaction_received",
  "forum_solved",
  "guide_vote",
];

/** XP a player earned in the last 7 days (0 when none). */
export async function weeklyXpOf(userId: string, now: Date = new Date(), db: Db = prisma): Promise<number> {
  const sum = await db.xpLedgerEntry.aggregate({
    where: { userId, createdAt: { gte: weekStart(now), lte: now }, voidedAt: null },
    _sum: { xp: true },
  });
  return sum._sum.xp ?? 0;
}

/** The community part of each player's XP of the last 7 days (absent: none). */
async function weeklyCommunityXp(userIds: string[], now: Date, db: Db): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const groups = await db.xpLedgerEntry.groupBy({
    by: ["userId"],
    where: {
      userId: { in: userIds },
      source: { in: COMMUNITY_SOURCES },
      createdAt: { gte: weekStart(now), lte: now },
      voidedAt: null,
    },
    _sum: { xp: true },
  });
  return new Map(groups.map((g) => [g.userId, g._sum.xp ?? 0]));
}

/** A player's XP of the last 7 days and how much of it came from the community. */
export async function weeklyXpSplit(
  userId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<{ total: number; community: number }> {
  const [total, community] = await Promise.all([weeklyXpOf(userId, now, db), weeklyCommunityXp([userId], now, db)]);
  return { total, community: community.get(userId) ?? 0 };
}

/**
 * Players behind weekly totals, in the totals' order (ties on the handle, like every board).
 * `secondary` is the community part of the week (shown on the row, never ranked).
 */
async function weeklyPlayers(rows: WeeklyRow[], db: Db, now: Date): Promise<RankedPlayer[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.userId);
  const [users, community] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: USER_SELECT }),
    weeklyCommunityXp(ids, now, db),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows
    .flatMap((r) => {
      const user = byId.get(r.userId);
      return user ? [player(user, r.xp, community.get(r.userId) ?? 0)] : [];
    })
    .sort((a, b) => b.value - a.value || a.handle.localeCompare(b.handle));
}

/** Ranked players of a board in order (or, reversed, the closest ones ahead first). */
async function playersOf(board: Board, window: Window, db: Db, now = new Date()): Promise<RankedPlayer[]> {
  const direction = window.reverse ? "asc" : "desc";
  const publicUser = { user: { profilePublic: true } };

  if (board.metric === "semana") {
    return weeklyPlayers(await weeklyTotals(db, now, { take: window.take }), db, now);
  }

  if (board.metric === "nivel" || board.metric === "novatos") {
    const fields = ["level", "totalXp"];
    const rows = await db.userStats.findMany({
      where: { AND: [publicUser, board.metric === "novatos" ? NOVATO : {}, window.where ?? {}] },
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
  now = new Date(),
): Promise<{ values: number[]; extra: number } | null> {
  if (board.metric === "semana") {
    // The community part rides along as the second value: shown on the row, not ranked.
    const week = await weeklyXpSplit(userId, now, db);
    return week.total > 0 ? { values: [week.total, week.community], extra: 0 } : null;
  }
  if (board.metric === "nivel" || board.metric === "novatos") {
    const stats = await db.userStats.findUnique({ where: { userId } });
    if (!stats || (board.metric === "novatos" && stats.level > NOVATO_MAX_LEVEL)) return null;
    return { values: [stats.level, stats.totalXp], extra: 0 };
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
async function countAhead(board: Board, values: number[], handle: string, db: Db, now = new Date()): Promise<number> {
  const publicUser = { user: { profilePublic: true } };
  if (board.metric === "semana") {
    // Strictly more XP this week (a tie shares the rank; the list breaks it by handle).
    return (await weeklyTotals(db, now, { take: 10_000, above: values[0] })).length;
  }
  if (board.metric === "nivel" || board.metric === "novatos") {
    return db.userStats.count({
      where: {
        AND: [publicUser, board.metric === "novatos" ? NOVATO : {}, aheadOf(["level", "totalXp"], values, handle)],
      },
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
  if (board.metric === "nivel" || board.metric === "novatos") return ["level", "totalXp"];
  if (board.metric === "semana") return ["xp"];
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
export async function getRanking(board: Board, limit: number, db: Db = prisma, now = new Date()) {
  const players = await playersOf(board, { take: limit }, db, now);
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
  const players = await playersOf(board, { take: limit }, db, now);
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
  const ranked = await valuesOf(userId, board, db, now);
  if (!ranked) return null;
  const { values, extra } = ranked;

  const above =
    board.metric === "semana"
      ? weeklyTotals(db, now, { take: 1, above: values[0], reverse: true }).then((rows) => weeklyPlayers(rows, db, now))
      : playersOf(board, { where: aheadOf(fieldsOf(board), values, user.handle), take: 1, reverse: true }, db, now);
  const [ahead, aboveRows, history] = await Promise.all([
    countAhead(board, values, user.handle, db, now),
    above,
    previousRanks(boardKey(board), [userId], toLocalDay(now), db),
  ]);
  const me = player(user, values[0], values[1] ?? 0, extra);
  return { row: withHistory(me, ahead + 1, history), above: aboveRows[0] ?? null };
}
