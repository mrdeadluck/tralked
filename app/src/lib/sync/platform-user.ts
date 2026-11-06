import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findBursts, isSpeedPlatinum } from "@/lib/engine/fraud";
import { platformAvailable } from "@/lib/integrations/availability";
import { settleListXp } from "@/lib/progression/list-xp";
import { recomputeUser } from "@/lib/progression/recompute";
import { ensureTrophyList, regionOf } from "@/lib/trophies/lists";
import { tierCounts, type TierCounts } from "@/lib/trophies/psn-definitions";
import { loadNameIndex, resolvePlatformGame, type NameIndex, type ResolveOptions } from "./platform-games";
import {
  CODE_PLATFORMS,
  readLibrary,
  type CodePlatform,
  type LibraryAchievement,
  type LibraryTitle,
  type PlaytimeTitle,
  type PsnConcepts,
  type StoredProgress,
} from "./platform-library";
import { busyImports, busyPairs } from "./import-lease";
import { settlePlaytime } from "./playtime";

export type SyncPlatformResult = {
  /** `unlinked`: no active connection on that platform (never linked, unlinked or a pending claim). */
  status: "ok" | "private" | "unlinked";
  newUnlocks: number;
  levelBefore: number;
  levelAfter: number;
  /** Titles were left for the next run (time or title budget); the account is not marked synced. */
  partial: boolean;
  /** Titles read from the platform this run, and those skipped as already up to date. */
  titles?: { read: number; upToDate: number };
  /**
   * Platform ids of the titles this run finished with (recorded, or read and found empty): a
   * resync cut short passes them as `skipTitles` to its next pass.
   */
  recordedTitles?: string[];
  /** Platform ids of the titles that could not be read this run (`played-games`: the play time list). */
  failedTitles?: string[];
};

export type SyncPlatformOptions = {
  /** Time of this sync: first-seen time of undated unlocks and the new `lastSyncedAt`. */
  now?: Date;
  /** Epoch ms after which no further title is read. */
  deadline?: number;
  /** At most this many titles are read in this run. */
  maxTitles?: number;
  /** Reads every title, even those already up to date (default: incremental). */
  full?: boolean;
  /**
   * Titles (platform ids) not read this run, as if up to date: the next pass of a `full` resync
   * cut short skips those an earlier pass recorded (lib/trophies/finish.ts). With it, a `full`
   * Xbox read still leaves out the minutes already asked (LinkedAccount.minutesChecked), so the
   * passes move through more than MAX_MINUTES_TITLES titles.
   */
  skipTitles?: ReadonlySet<string>;
};

const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };
/** Share of a sync's budget that reading the platform may take; the rest resolves and writes. */
const READ_SHARE = 0.6;

/** The linked account a run started with: every title transaction re-checks it is still linked. */
/** `linkedAt` too: an unlink followed by a quick relink of the same account is another link. */
type AccountSnapshot = { userId: string; platform: CodePlatform; externalId: string; linkedAt: Date };

/** The account was unlinked (or claimed by another profile) while the sync ran. */
class AccountChangedError extends Error {
  constructor() {
    super("The linked account changed during the sync");
  }
}

/**
 * Locks the account row FOR SHARE until the title transaction ends and checks it is still the
 * active connection the run started with (verified or not). Unlinking or a claim by another
 * profile takes the same row FOR UPDATE (lib/accounts/link.ts releaseAccount), so an unlink
 * either waits for this title (and then removes it) or has already committed (and this aborts,
 * even when the same account was linked again meanwhile: its `linkedAt` differs).
 */
async function assertStillLinked(tx: Prisma.TransactionClient, account: AccountSnapshot): Promise<void> {
  const rows = await tx.$queryRaw<{ linkedAt: Date | null }[]>`
    SELECT "linkedAt" FROM "LinkedAccount"
    WHERE "userId" = ${account.userId} AND platform = ${account.platform}
      AND "externalId" = ${account.externalId} AND "linkedAt" IS NOT NULL
    FOR SHARE`;
  if (rows[0]?.linkedAt?.getTime() !== account.linkedAt.getTime()) throw new AccountChangedError();
}

/** `fraudReview` "cleared": an admin released the unlock, so the rules no longer flag it. */
type KnownUnlock = {
  achievementId: string;
  /** Never null for these platforms (they date every unlock); the column allows it for Steam. */
  unlockedAt: Date | null;
  suspicious: boolean;
  hardcore: boolean;
  fraudReview: string | null;
  fraudReviewedAt: Date | null;
};

/** The user's unlocks on one platform, as stored when the sync started. */
type KnownUnlocks = {
  /** Unlocks of trophy-list rows, by listKey. */
  byList: Map<string, KnownUnlock>;
  /**
   * Unlocks of rows written before trophy lists (listId null), by `${gameId}:${apiName}`. Several
   * lists of one game (PS4 and PS5) shared those rows, so one may hold another list's unlock.
   */
  legacy: Map<string, KnownUnlock>;
};

/** A trophy of one list: Achievement is unique by (listId, apiName). */
const listKey = (listId: string, apiName: string) => `${listId}:${apiName}`;

/**
 * Records one platform title (one trophy list) in a single transaction: its TrophyList, the list's
 * Achievement rows, UserAchievement (with the anti-fraud verdict and the hardcore flag), the
 * user's UserTrophyList of the list and the UserGame of the game on that platform (every list's
 * unlocks; completed when its first list was), then settles the game's XP by version
 * (settleListXp). Every insert is idempotent and XP already in the ledger is never rewritten. A
 * stored unlock date is never rewritten either: an undated unlock keeps the time it was first
 * seen (`seenAt`). An unlock of a list-less row of the same game and trophy (written before
 * trophy lists) passes on its verdict, and its date when the platform gives none. Throws
 * AccountChangedError (writing nothing) when the account is no longer linked.
 * Returns how many unlocks were new.
 */
async function recordTitle(
  account: AccountSnapshot,
  gameId: string,
  title: LibraryTitle,
  known: KnownUnlocks,
  bursts: Set<string>,
  seenAt: Date,
  conceptId: number | null = null,
): Promise<number> {
  const { userId, platform } = account;
  const game = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
    select: { timeToBeatCompleteMin: true },
  });
  const fields = (a: LibraryAchievement) => ({
    name: a.name,
    description: a.description,
    iconUrl: a.iconUrl,
    hidden: a.hidden,
    globalPct: a.globalPct,
    trophyTier: a.trophyTier,
    points: a.points,
  });

  return prisma.$transaction(async (tx) => {
    await assertStillLinked(tx, account);
    const list = await ensureTrophyList(tx, {
      gameId,
      platform,
      externalId: title.externalId,
      console: title.console,
      name: title.name,
      serviceName: title.serviceName,
      conceptId,
      trophyCount: title.achievements.length,
    });
    // A list never moves between games (ensureTrophyList): its rows and progress stay with its game.
    const listGameId = list.gameId;
    // List-less rows of the game written before trophy lists are this list's own rows (kept in
    // place, ids and ledger keys too) when the game has only this list on the platform (one PSN
    // `NPWR` link; one Xbox/RA link, and it is this title's) and always on RetroAchievements, whose
    // ids are unique across sets (as the game page's writer does, lib/sync/retro-achievements.ts).
    // Rows of a game with several lists mixed those lists' trophies, and rows of a game whose one
    // list link is another title are that title's: they stay as they are (the phase finish removes
    // the former) and the list gets rows of its own.
    const listLinks =
      platform === "retro"
        ? [{ externalId: title.externalId }]
        : await tx.gamePlatformLink.findMany({
            where: { gameId: listGameId, platform, ...(platform === "psn" && { externalId: { startsWith: "NPWR" } }) },
            select: { externalId: true },
            take: 2,
          });
    if (listLinks.length === 1 && listLinks[0].externalId === title.externalId) {
      const own = await tx.achievement.findMany({ where: { listId: list.id }, select: { apiName: true } });
      const held = new Set(own.map((r) => r.apiName));
      await tx.achievement.updateMany({
        where: {
          gameId: listGameId,
          platform,
          listId: null,
          apiName: { in: title.achievements.map((a) => a.apiName).filter((n) => !held.has(n)) },
        },
        data: { listId: list.id },
      });
    }
    const existing = await tx.achievement.findMany({ where: { listId: list.id } });
    const byApiName = new Map(existing.map((r) => [r.apiName, r]));
    await tx.achievement.createMany({
      data: title.achievements
        .filter((a) => !byApiName.has(a.apiName))
        .map((a) => ({ gameId: listGameId, platform, listId: list.id, apiName: a.apiName, ...fields(a) })),
      skipDuplicates: true,
    });
    for (const a of title.achievements) {
      const row = byApiName.get(a.apiName);
      if (!row) continue;
      const next = fields(a);
      const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== row[k]);
      if (changed) await tx.achievement.update({ where: { id: row.id }, data: next });
    }
    // PSN: the list is what Sony defines. Rows it does not have (a list once stored with another
    // list's trophies) go, unless someone unlocked them, a guide note is on them or the ledger
    // names them (scripts/trophy-lists-repair-psn.ts deals with those).
    if (platform === "psn") {
      const sony = new Set(title.achievements.map((a) => a.apiName));
      const extra = existing.filter((r) => !sony.has(r.apiName)).map((r) => r.id);
      if (extra.length > 0) {
        const keyed = await tx.xpLedgerEntry.findMany({ where: { source: "achievement", sourceKey: { in: extra } }, select: { sourceKey: true } });
        const kept = new Set(keyed.map((e) => e.sourceKey));
        await tx.achievement.deleteMany({
          where: { id: { in: extra.filter((id) => !kept.has(id)) }, listId: list.id, unlocks: { none: {} }, notes: { none: {} } },
        });
        // Rows that stay keep the list apart from Sony's (it is read again every sync): say so.
        const left = await tx.achievement.findMany({ where: { id: { in: extra } }, select: { apiName: true } });
        if (left.length > 0) {
          console.warn(
            `Platform sync: psn list ${title.externalId} keeps ${left.length} row(s) Sony does not have (unlocked, noted or in the ledger): ` +
              `${left.map((r) => r.apiName).sort().join(", ")}. See pnpm trophy-lists:repair-psn.`,
          );
        }
      }
    }
    const rows = await tx.achievement.findMany({
      where: { listId: list.id },
      select: { id: true, apiName: true },
    });
    const idOf = new Map(rows.map((r) => [r.apiName, r.id]));

    const unlocked = title.achievements.flatMap((a) => {
      const achievementId = idOf.get(a.apiName);
      if (!achievementId || !a.unlocked) return [];
      // The list-less row of the same game and apiName: on a game with several lists it stands for
      // every one of them, so its verdict carries over to that trophy in each list of the game.
      const listless = known.legacy.get(`${listGameId}:${a.apiName}`);
      // A list-less row this list just took over is the same row: same unlock.
      const before =
        known.byList.get(listKey(list.id, a.apiName)) ?? (listless?.achievementId === achievementId ? listless : undefined);
      const legacy = before ? undefined : listless;
      // The list-less row may hold another list's unlock: its date only stands in for a missing one.
      const unlockedAt = before?.unlockedAt ?? a.unlockedAt ?? legacy?.unlockedAt ?? seenAt;
      return [{ a, achievementId, unlockedAt, before, legacy }];
    });
    const complete = unlocked.length > 0 && unlocked.length >= title.achievements.length;
    const playtimeKnown = title.playtimeMin !== null && title.playtimeMin > 0;
    const speedRun =
      complete && playtimeKnown && isSpeedPlatinum(title.playtimeMin ?? 0, game.timeToBeatCompleteMin);

    const verdicts = unlocked.map((u) => {
      const before = u.before ?? u.legacy;
      return {
        ...u,
        // Sticky like the Steam sync: once suspicious (rule or admin), always suspicious. An unlock
        // an admin released keeps its stored flag: the rules are not re-applied to it.
        suspicious:
          before?.fraudReview === "cleared"
            ? before.suspicious
            : before?.suspicious || bursts.has(u.achievementId) || speedRun,
        // A softcore unlock later redone in hardcore is upgraded, never downgraded.
        hardcore: u.a.hardcore || (before?.hardcore ?? false),
      };
    });
    // A 100% with any suspicious unlock is not a completion (no Coleção, no platinum bonus).
    const validComplete = complete && verdicts.every((v) => !v.suspicious);
    const completedAt = validComplete
      ? new Date(Math.max(...verdicts.map((v) => v.unlockedAt.getTime())))
      : null;

    // A completion is sticky (as on Steam): trophies added to the list later (DLC, a revised RA
    // set) do not undo it. Only a suspicious unlock in the list clears it (anti-fraud).
    const prior = await tx.userTrophyList.findUnique({
      where: { userId_listId: { userId, listId: list.id } },
      select: { completedAt: true },
    });
    const progress = {
      unlockedCount: verdicts.length,
      hardcoreCount: verdicts.filter((v) => v.hardcore).length,
      completedAt: verdicts.some((v) => v.suspicious) ? null : (prior?.completedAt ?? completedAt),
    };
    await tx.userTrophyList.upsert({
      where: { userId_listId: { userId, listId: list.id } },
      create: { userId, listId: list.id, ...progress },
      update: progress,
    });

    const fresh = verdicts.filter((v) => !v.before);
    const created = await tx.userAchievement.createMany({
      data: fresh.map((v) => ({
        userId,
        achievementId: v.achievementId,
        unlockedAt: v.unlockedAt,
        suspicious: v.suspicious,
        hardcore: v.hardcore,
        // An admin's decision on the list-less unlock stands for this one.
        ...(v.legacy?.fraudReview && { fraudReview: v.legacy.fraudReview, fraudReviewedAt: v.legacy.fraudReviewedAt }),
      })),
      skipDuplicates: true,
    });
    for (const v of verdicts) {
      if (v.before && (v.before.suspicious !== v.suspicious || v.before.hardcore !== v.hardcore)) {
        await tx.userAchievement.update({
          where: { userId_achievementId: { userId, achievementId: v.achievementId } },
          data: { suspicious: v.suspicious, hardcore: v.hardcore },
        });
      }
    }

    // The game on that platform: every list's unlocks (list-less rows of older syncs left out: the
    // lists hold those unlocks again), completed when its first list was.
    const unlockedCount = await tx.userAchievement.count({
      where: { userId, achievement: { gameId: listGameId, platform, listId: { not: null } } },
    });
    const firstCompleted = await tx.userTrophyList.findFirst({
      where: { userId, completedAt: { not: null }, list: { gameId: listGameId, platform } },
      orderBy: { completedAt: "asc" },
      select: { completedAt: true },
    });
    const gameCompletedAt = firstCompleted?.completedAt ?? null;
    const playtimeMin = title.playtimeMin ?? 0;
    // RetroAchievements reports play time with each title: reading the title is reading it (even
    // when RA has none), so the row stops being re-read for it. PSN/Xbox play time comes from their
    // played-games lists (recordPlaytime).
    const playtimeFields = platform === "retro" ? { playtimeUpdatedAt: seenAt } : {};
    await tx.userGame.upsert({
      where: { userId_gameId_platform: { userId, gameId: listGameId, platform } },
      create: { userId, gameId: listGameId, platform, playtimeMin, unlockedCount, completedAt: gameCompletedAt, ...playtimeFields },
      update: {
        // Platforms without playtime keep whatever was recorded before.
        ...(title.playtimeMin !== null && { playtimeMin }),
        unlockedCount,
        completedAt: gameCompletedAt,
        ...playtimeFields,
      },
    });

    // XP of the game's trophies and completions, by version (once per console). Hours milestones
    // (RetroAchievements play time comes with the title) are paid by settlePlaytime at the end of
    // the sync, within the per-user caps.
    await settleListXp(tx, userId, platform, [listGameId], seenAt);
    // Unlocks carried over from list-less rows were known already.
    return Math.max(0, created.count - fresh.filter((v) => v.legacy).length);
  }, TRANSACTION_OPTIONS);
}

/** Resolve options of a PSN concept (see conceptResolver). */
type ConceptOptions = (conceptId: number | null | undefined) => ResolveOptions;

/**
 * Resolve options of a PSN concept: the concept, its ids (store title ids, and the trophy lists
 * known to be of it) and its name without Japanese or Korean script. Nothing for an unknown
 * concept: the title resolves as before.
 */
function conceptResolver(concepts: PsnConcepts | undefined): ConceptOptions {
  const listsOf = new Map<number, string[]>();
  for (const [list, c] of concepts?.npToConcept ?? []) listsOf.set(c, [...(listsOf.get(c) ?? []), list]);
  return (conceptId) => {
    if (!concepts || conceptId == null) return {};
    return {
      conceptId,
      conceptTitleIds: [...(concepts.conceptTitleIds.get(conceptId) ?? []), ...(listsOf.get(conceptId) ?? [])],
      conceptName: concepts.conceptNames.get(conceptId) ?? null,
    };
  };
}

/**
 * Records the play time of a platform's played-games list (PSN, Xbox): each title is mapped to its
 * catalog game without asking IGDB (a play-time-only title is matched by its platform link or
 * name, or created bare; the trophy sync and the catalog jobs fill in metadata), versions of one
 * game (PS4 and PS5) add up, and the platform's UserGame row gets the play time and last play
 * (created when the game has no trophies yet). Then, for every platform (RetroAchievements too,
 * whose play time came with its titles), the hours milestones due are paid within the per-user
 * caps (settlePlaytime). One transaction guarded like the titles'. Stops taking titles at
 * `deadline` (`partial`: the next run continues; the list is read whole every time) and returns
 * the titles it recorded.
 */
async function recordPlaytime(
  account: AccountSnapshot,
  titles: PlaytimeTitle[],
  names: NameIndex,
  now: Date,
  deadline?: number,
  clock: () => number = Date.now,
  conceptOptions: ConceptOptions = () => ({}),
): Promise<{ partial: boolean; written: Set<string> }> {
  const { userId, platform } = account;
  const perGame = new Map<string, { playtimeMin: number; lastPlayedAt: Date | null }>();
  /** Titles (platform ids) recorded by this call. */
  const written = new Set<string>();
  let partial = false;
  for (const title of titles) {
    if (!Number.isFinite(title.playtimeMin) || title.playtimeMin <= 0) continue;
    if (deadline !== undefined && clock() >= deadline) {
      partial = true;
      break;
    }
    written.add(title.externalId);
    const gameId = await resolvePlatformGame(platform, title, names, {
      igdb: false,
      ...conceptOptions(title.conceptId),
    });
    const acc = perGame.get(gameId) ?? { playtimeMin: 0, lastPlayedAt: null };
    acc.playtimeMin += Math.floor(title.playtimeMin);
    if (title.lastPlayedAt && (!acc.lastPlayedAt || title.lastPlayedAt > acc.lastPlayedAt)) {
      acc.lastPlayedAt = title.lastPlayedAt;
    }
    perGame.set(gameId, acc);
  }

  const gameIds = [...perGame.keys()];
  const stored = gameIds.length
    ? await prisma.userGame.findMany({
        where: { userId, platform, gameId: { in: gameIds } },
        select: { gameId: true, playtimeMin: true, lastPlayedAt: true, playtimeUpdatedAt: true },
      })
    : [];
  const before = new Map(stored.map((s) => [s.gameId, s]));
  const writes: { gameId: string; playtimeMin: number; lastPlayedAt: Date | null }[] = [];
  for (const [gameId, { playtimeMin, lastPlayedAt }] of perGame) {
    const row = before.get(gameId);
    const unchanged =
      row &&
      row.playtimeUpdatedAt !== null &&
      row.playtimeMin === playtimeMin &&
      (row.lastPlayedAt?.getTime() ?? null) === (lastPlayedAt?.getTime() ?? null);
    if (!unchanged) writes.push({ gameId, playtimeMin, lastPlayedAt });
  }

  await prisma.$transaction(async (tx) => {
    await assertStillLinked(tx, account);
    for (const w of writes) {
      const fields = { playtimeMin: w.playtimeMin, lastPlayedAt: w.lastPlayedAt, playtimeUpdatedAt: now };
      await tx.userGame.upsert({
        where: { userId_gameId_platform: { userId, gameId: w.gameId, platform } },
        create: { userId, gameId: w.gameId, platform, unlockedCount: 0, ...fields },
        update: fields,
      });
    }
    await settlePlaytime(tx, userId, platform, now);
  }, TRANSACTION_OPTIONS);
  return { partial, written };
}

/**
 * Titles whose minutes were asked (LinkedAccount.minutesChecked: titleId → last play then, ms).
 * It lives on the connection row, so unlinking clears it (releaseAccount), a claim by another
 * profile starts from scratch, and deleting the account removes it with the row.
 */
function checkedTitlesOf(value: unknown): Map<string, number> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return new Map(
    Object.entries(record).flatMap(([id, ms]) => (typeof ms === "number" && Number.isFinite(ms) ? [[id, ms]] : [])),
  );
}

/**
 * Remembers (merging) the titles asked this run, so titles without minutes are not asked every
 * sync. Guarded like the titles: nothing is written on a connection unlinked (or replaced) meanwhile.
 */
async function rememberCheckedTitles(
  account: AccountSnapshot,
  accountId: string,
  checked: Map<string, number>,
): Promise<void> {
  if (checked.size === 0) return;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ minutesChecked: unknown }[]>`
      SELECT "minutesChecked" FROM "LinkedAccount"
      WHERE id = ${accountId} AND "externalId" = ${account.externalId} AND "linkedAt" = ${account.linkedAt}
      FOR UPDATE`;
    if (rows.length === 0) return;
    const merged = checkedTitlesOf(rows[0].minutesChecked);
    for (const [id, ms] of checked) merged.set(id, ms);
    await tx.linkedAccount.update({ where: { id: accountId }, data: { minutesChecked: Object.fromEntries(merged) } });
  }, TRANSACTION_OPTIONS);
}

/** Listed counts of one title as last recorded: [unlocked, hardcore?]. */
type RememberedCounts = { unlocked: number; hardcore?: number };

/**
 * Version of the remembered "read, no achievements" entries. Bump it to make every such entry
 * stale (the titles are read again), e.g. after the Xbox 360 route is checked against the live API.
 */
export const EMPTY_TITLES_VERSION = 1;

/** SyncCursor holding a connection's remembered title counts (see rememberTitles). */
export const titleMemoryKey = (accountId: string) => `platform-titles:${accountId}`;

/**
 * Title counts remembered for this connection: empty for another account or link on the same
 * row (a relink starts over).
 */
async function rememberedTitles(account: AccountSnapshot, accountId: string): Promise<Map<string, RememberedCounts>> {
  const row = await prisma.syncCursor.findUnique({ where: { key: titleMemoryKey(accountId) } });
  const value = row?.value as { externalId?: unknown; linkedAt?: unknown; titles?: unknown; empty?: unknown } | undefined;
  if (
    !value ||
    value.externalId !== account.externalId ||
    value.linkedAt !== account.linkedAt.toISOString() ||
    !value.titles ||
    typeof value.titles !== "object"
  ) {
    return new Map();
  }
  const fromCounts = (id: string, counts: unknown): [string, RememberedCounts][] =>
    Array.isArray(counts) && typeof counts[0] === "number"
      ? [[id, { unlocked: counts[0], ...(typeof counts[1] === "number" && { hardcore: counts[1] }) }]]
      : [];
  // Empty titles (read, no achievements) count only at the current version; recorded titles win.
  const empty = Object.entries((value.empty && typeof value.empty === "object" ? value.empty : {}) as Record<string, unknown>).flatMap(
    ([id, entry]) => {
      const e = entry as { c?: unknown; v?: unknown } | null;
      return e && e.v === EMPTY_TITLES_VERSION ? fromCounts(id, e.c) : [];
    },
  );
  return new Map([
    ...empty,
    ...Object.entries(value.titles as Record<string, unknown>).flatMap(([id, counts]) => fromCounts(id, counts)),
  ]);
}

/**
 * Remembers (merging) the counts the platform listed for each title recorded this run. A game with
 * several lists (PS4 and PS5) has one UserGame row whose count matches at most one list: without
 * this, the other list was read again on every sync, and a big library never finished importing.
 * Guarded like the titles: nothing is written on a connection unlinked (or replaced) meanwhile.
 */
async function rememberTitles(
  account: AccountSnapshot,
  accountId: string,
  titles: readonly { externalId: string; listed?: RememberedCounts }[],
  empties: readonly { externalId: string; listed: RememberedCounts }[] = [],
): Promise<void> {
  const counts = titles.flatMap((t) => (t.listed ? [[t.externalId, t.listed] as const] : []));
  if (counts.length === 0 && empties.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const linked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LinkedAccount"
      WHERE id = ${accountId} AND "externalId" = ${account.externalId} AND "linkedAt" = ${account.linkedAt}
      FOR UPDATE`;
    if (linked.length === 0) return;
    const key = titleMemoryKey(accountId);
    const row = await tx.syncCursor.findUnique({ where: { key } });
    const before = row?.value as
      | { externalId?: unknown; linkedAt?: unknown; titles?: Record<string, unknown>; empty?: Record<string, unknown> }
      | undefined;
    const same = before?.externalId === account.externalId && before?.linkedAt === account.linkedAt.toISOString();
    const merged = { ...(same && before?.titles ? before.titles : {}) } as Prisma.InputJsonObject & Record<string, Prisma.InputJsonValue>;
    for (const [id, c] of counts) merged[id] = c.hardcore === undefined ? [c.unlocked] : [c.unlocked, c.hardcore];
    // Empty titles live apart, tagged with the version they were remembered under.
    const mergedEmpty = { ...(same && before?.empty ? before.empty : {}) } as Prisma.InputJsonObject & Record<string, Prisma.InputJsonValue>;
    for (const [id] of counts) delete mergedEmpty[id];
    for (const e of empties) {
      mergedEmpty[e.externalId] = { c: e.listed.hardcore === undefined ? [e.listed.unlocked] : [e.listed.unlocked, e.listed.hardcore], v: EMPTY_TITLES_VERSION };
    }
    const value = { externalId: account.externalId, linkedAt: account.linkedAt.toISOString(), titles: merged, empty: mergedEmpty };
    await tx.syncCursor.upsert({ where: { key }, create: { key, value }, update: { value } });
  }, TRANSACTION_OPTIONS);
}

/**
 * Per-title progress already in the database, keyed by the platform's title id: the counts of the
 * user's UserTrophyList of that list (with the listed counts remembered for it, see
 * StoredProgress.listed); a list without one of a game that has per-list progress, or of a game
 * whose unlocks are still on list-less rows only, gets no entry (read once); a title of a game
 * recorded only before trophy lists, the counts remembered for it
 * when it was last recorded (a game with several lists), else its game's UserGame unlock count
 * (and, for RetroAchievements, the game's hardcore unlock count). Persistent, so a run cut short
 * by the budget resumes where it stopped.
 */
async function storedProgress(
  userId: string,
  platform: CodePlatform,
  remembered: Map<string, RememberedCounts> = new Map(),
): Promise<Map<string, StoredProgress>> {
  const [games, lists] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId, platform },
      select: { gameId: true, unlockedCount: true, playtimeUpdatedAt: true, lastPlayedAt: true },
    }),
    prisma.userTrophyList.findMany({
      where: { userId, list: { platform } },
      select: { unlockedCount: true, hardcoreCount: true, list: { select: { id: true, externalId: true, gameId: true } } },
    }),
  ]);
  if (games.length === 0 && lists.length === 0 && remembered.size === 0) return new Map();
  // A game with per-list progress counts by list only: its game count adds every list up, so a
  // list of it without progress yet has no entry and is read (once: reading it records its row).
  const onLists = new Set(lists.map((p) => p.list.gameId));
  const [links, hardcore, listless] = await Promise.all([
    prisma.gamePlatformLink.findMany({
      where: { platform, gameId: { in: games.map((g) => g.gameId) } },
      select: { gameId: true, externalId: true },
    }),
    platform === "retro"
      ? prisma.userAchievement.findMany({
          where: { userId, hardcore: true, achievement: { platform } },
          select: { achievement: { select: { gameId: true } } },
        })
      : [],
    prisma.achievement.findMany({
      where: { platform, listId: null, gameId: { in: games.map((g) => g.gameId) }, unlocks: { some: { userId } } },
      select: { gameId: true },
      distinct: ["gameId"],
    }),
  ]);
  // A game whose unlocks are still on list-less rows (the backfill leaves a multi-list game so)
  // and none of whose lists was read for this user: its lists get no entry, so each is read once
  // and the game moves to its lists (reading a list records its UserTrophyList: no loop).
  const unread = listless.map((a) => a.gameId).filter((g) => !onLists.has(g));
  const unreadLists = new Set(
    unread.length
      ? (
          await prisma.trophyList.findMany({
            where: { platform, gameId: { in: unread } },
            select: { gameId: true, externalId: true },
          })
        ).map((l) => `${l.gameId}:${l.externalId}`)
      : [],
  );
  const hardcoreByGame = new Map<string, number>();
  for (const h of hardcore) {
    hardcoreByGame.set(h.achievement.gameId, (hardcoreByGame.get(h.achievement.gameId) ?? 0) + 1);
  }
  const byGame = new Map(games.map((g) => [g.gameId, g]));
  const stored = new Map<string, StoredProgress>(
    links
      .filter((l) => !onLists.has(l.gameId) && !unreadLists.has(`${l.gameId}:${l.externalId}`))
      .map((l) => {
      const game = byGame.get(l.gameId);
      const counts = remembered.get(l.externalId);
      return [
        l.externalId,
        {
          unlocked: counts?.unlocked ?? game?.unlockedCount ?? 0,
          hardcore: counts?.hardcore ?? hardcoreByGame.get(l.gameId) ?? 0,
          playtimeSynced: game?.playtimeUpdatedAt != null,
          lastPlayedAt: game?.lastPlayedAt ?? null,
        },
      ];
    }),
  );
  // PSN: the stored trophies of each list per tier, checked against what the list defines.
  const definitions = new Map<string, TierCounts>();
  if (platform === "psn" && lists.length > 0) {
    const tiers = await prisma.achievement.groupBy({
      by: ["listId", "trophyTier"],
      where: { listId: { in: lists.map((p) => p.list.id) } },
      _count: { _all: true },
    });
    for (const t of tiers) {
      const counts = definitions.get(t.listId!) ?? tierCounts([]);
      if (t.trophyTier && t.trophyTier in counts) counts[t.trophyTier as keyof TierCounts] += t._count._all;
      definitions.set(t.listId!, counts);
    }
  }
  for (const p of lists) {
    const game = byGame.get(p.list.gameId);
    stored.set(p.list.externalId, {
      unlocked: p.unlockedCount,
      hardcore: p.hardcoreCount,
      listed: remembered.get(p.list.externalId),
      playtimeSynced: game?.playtimeUpdatedAt != null,
      lastPlayedAt: game?.lastPlayedAt ?? null,
      ...(platform === "psn" && { definitions: definitions.get(p.list.id) ?? tierCounts([]) }),
    });
  }
  // Titles read that had no achievements have no list, game or link: only their remembered counts
  // stand for them (and, for RetroAchievements, which carries play time, nothing more to wait for).
  // A linked title missing here is a list of a game on lists still to be read once: left alone.
  const linked = new Set(links.map((l) => l.externalId));
  for (const [id, counts] of remembered) {
    if (stored.has(id) || linked.has(id)) continue;
    stored.set(id, { unlocked: -1, hardcore: -1, listed: counts, playtimeSynced: platform === "retro" });
  }
  return stored;
}

async function currentLevel(userId: string): Promise<number> {
  const stats = await prisma.userStats.findUnique({ where: { userId }, select: { level: true } });
  return stats?.level ?? 1;
}

/**
 * Imports the user's progress on one linked platform (PSN, Xbox or RetroAchievements): maps
 * every title to a catalog game, records unlocks with the anti-fraud rules, appends XP to the
 * ledger and recomputes level, skills, attributes, missions and streak. Every active connection
 * is read, verified (claimed with a code) or not (linked by typing the profile). Incremental and resumable: titles whose stored unlock counts already match the
 * platform's list are skipped, the rest is read oldest first, so a run cut short by the budget
 * continues where it stopped. `lastSyncedAt` moves when a run reaches the end of the list.
 * Idempotent: running it again changes nothing unless the platform has new unlocks.
 */
export async function syncPlatformAccount(
  userId: string,
  platform: CodePlatform,
  options: SyncPlatformOptions = {},
): Promise<SyncPlatformResult> {
  const startedAt = options.now ?? new Date();
  const levelBefore = await currentLevel(userId);
  const unchanged = (status: SyncPlatformResult["status"]): SyncPlatformResult => ({
    status,
    newUnlocks: 0,
    levelBefore,
    levelAfter: levelBefore,
    partial: false,
  });

  const account = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!account?.linkedAt) return unchanged("unlinked");
  // Recorded first so an account that keeps failing still rotates to the back of the cron queue.
  await prisma.linkedAccount.update({
    where: { id: account.id },
    data: { lastSyncAttemptAt: startedAt },
  });

  // A big first import can spend the whole budget reading, leaving no time to write anything, and the
  // next run would read the same titles again: reading stops at READ_SHARE of the budget, so what was
  // read is written and the next run starts after it.
  const readDeadline =
    options.deadline === undefined ? undefined : Date.now() + Math.max(0, options.deadline - Date.now()) * READ_SHARE;
  const snapshot: AccountSnapshot = { userId, platform, externalId: account.externalId, linkedAt: account.linkedAt };
  const library = await readLibrary(
    platform,
    { externalId: account.externalId, handle: account.handle },
    {
      stored: options.full ? undefined : await storedProgress(userId, platform, await rememberedTitles(snapshot, account.id)),
      // A resync in passes (skipTitles) keeps the titles whose minutes were asked: over 250 titles
      // (MAX_MINUTES_TITLES a run), a plain full read would leave every pass partial.
      checkedTitles:
        platform !== "xbox" || (options.full && !options.skipTitles) ? undefined : checkedTitlesOf(account.minutesChecked),
      linkedAccountId: platform === "psn" ? account.id : undefined,
      deadline: readDeadline,
      maxTitles: options.maxTitles,
      skip: options.skipTitles,
    },
  );
  if (library === "private") {
    // The platform refused the service account (HTTP 403): shown in the logs so a profile that looks
    // public elsewhere can be told apart from a bug here.
    console.warn(`Platform sync: ${platform} refused to show the library of user ${userId} (private)`);
    return unchanged("private");
  }
  for (const failure of library.failures) {
    console.error(
      `Platform sync: could not read ${platform} title ${failure.externalId} for user ${userId}`,
      failure.error,
    );
  }
  // Nothing readable at all (every title failed, none up to date): an outage, not a bad title.
  if (library.titles.length === 0 && library.upToDate === 0 && library.failures.length > 0) {
    throw library.failures[0].error;
  }

  const names = await loadNameIndex();
  const resolved: { gameId: string; title: LibraryTitle; conceptId: number | null }[] = [];
  let titlesPartial = false;
  const conceptOfList = (title: LibraryTitle) => library.concepts?.npToConcept.get(title.externalId) ?? null;
  const conceptOptions = conceptResolver(library.concepts);
  // A list of a known concept with a Japanese or Korean name resolves after the others: the
  // concept's other lists name (or create) the game first, and it joins that game.
  const ordered = [...library.titles].sort(
    (a, b) =>
      Number(conceptOfList(a) !== null && regionOf(a.name) !== null) -
      Number(conceptOfList(b) !== null && regionOf(b.name) !== null),
  );
  for (const title of ordered) {
    // Resolving an unknown title may ask IGDB: no new title after the deadline. The titles left
    // are not recorded, so they are still not up to date and the next run reads them again.
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      titlesPartial = true;
      break;
    }
    const conceptId = conceptOfList(title);
    const gameId = await resolvePlatformGame(platform, title, names, conceptOptions(conceptId));
    resolved.push({ gameId, title, conceptId });
  }

  // Anti-fraud looks at all of the user's unlocks on this platform together (bursts can span
  // games). Undated unlocks are left out: their first-seen time says nothing about play.
  const unlockRows = await prisma.userAchievement.findMany({
    where: { userId, achievement: { platform } },
    select: {
      achievementId: true,
      unlockedAt: true,
      suspicious: true,
      hardcore: true,
      fraudReview: true,
      fraudReviewedAt: true,
      achievement: { select: { listId: true, gameId: true, apiName: true } },
    },
  });
  const known: KnownUnlocks = { byList: new Map(), legacy: new Map() };
  for (const { achievement: a, ...unlock } of unlockRows) {
    if (a.listId) known.byList.set(listKey(a.listId, a.apiName), unlock);
    else known.legacy.set(`${a.gameId}:${a.apiName}`, unlock);
  }
  const lists = await prisma.trophyList.findMany({
    where: { platform, externalId: { in: resolved.map((r) => r.title.externalId) } },
    select: { id: true, externalId: true },
  });
  const listIdOf = new Map(lists.map((l) => [l.externalId, l.id]));
  const ids = await prisma.achievement.findMany({
    where: { listId: { in: lists.map((l) => l.id) } },
    select: { id: true, listId: true, apiName: true },
  });
  const idByKey = new Map(ids.map((a) => [listKey(a.listId!, a.apiName), a.id]));
  // A list-less unlock of a game that has (or gets, this run) trophy lists is held by a list row
  // too: left out, so one unlock does not count twice.
  const legacyGames = [...new Set(unlockRows.filter((r) => !r.achievement.listId).map((r) => r.achievement.gameId))];
  const listedGames = new Set([
    ...resolved.map((r) => r.gameId),
    ...(legacyGames.length
      ? await prisma.trophyList.findMany({
          where: { platform, gameId: { in: legacyGames } },
          select: { gameId: true },
          distinct: ["gameId"],
        })
      : []
    ).map((l) => l.gameId),
  ]);
  const everyUnlock = new Map<string, { achievementId: string; unlockedAt: Date }>();
  for (const { achievement: a, achievementId, unlockedAt } of unlockRows) {
    if (!unlockedAt) continue;
    if (a.listId) everyUnlock.set(listKey(a.listId, a.apiName), { achievementId, unlockedAt });
    else if (!listedGames.has(a.gameId)) everyUnlock.set(`${a.gameId}:${a.apiName}`, { achievementId, unlockedAt });
  }
  for (const { title } of resolved) {
    const listId = listIdOf.get(title.externalId);
    // Lists and achievements new to the catalog get their ids on record; they join the burst
    // check next sync.
    if (!listId) continue;
    for (const a of title.achievements) {
      const key = listKey(listId, a.apiName);
      const id = idByKey.get(key);
      if (!id || !a.unlocked) continue;
      if (!a.unlockedAt) everyUnlock.delete(key);
      else if (!known.byList.has(key)) everyUnlock.set(key, { achievementId: id, unlockedAt: a.unlockedAt });
    }
  }
  const bursts = findBursts([...everyUnlock.values()]);

  let newUnlocks = 0;
  for (const { gameId, title, conceptId } of resolved) {
    try {
      newUnlocks += await recordTitle(snapshot, gameId, title, known, bursts, startedAt, conceptId);
    } catch (error) {
      // Unlinked while this run was reading: stop. Unlink already removed what was recorded and
      // recomputed; nothing more is written for this account.
      if (error instanceof AccountChangedError) return unchanged("unlinked");
      throw error;
    }
  }
  await rememberTitles(snapshot, account.id, resolved.map((r) => r.title), library.empty);
  let playtime: { partial: boolean; written: Set<string> };
  try {
    playtime = await recordPlaytime(snapshot, library.playtime, names, startedAt, options.deadline, Date.now, conceptOptions);
  } catch (error) {
    if (error instanceof AccountChangedError) return unchanged("unlinked");
    throw error;
  }

  // Xbox: titles whose minutes were asked are remembered, so they are not asked again until
  // played again: those Xbox had no minutes for, and those written. A title with minutes the
  // deadline left unwritten is not remembered (the next run asks it again).
  if (library.checkedTitles) {
    const withMinutes = new Set(library.playtime.map((t) => t.externalId));
    const remembered = new Map(
      [...library.checkedTitles].filter(([id]) => !withMinutes.has(id) || playtime.written.has(id)),
    );
    await rememberCheckedTitles(snapshot, account.id, remembered);
  }

  await recomputeUser(userId);
  const partial = library.partial || titlesPartial || playtime.partial;
  // Guarded like the titles: an account unlinked meanwhile is not marked synced.
  await prisma.linkedAccount.updateMany({
    where: { id: account.id, externalId: account.externalId, linkedAt: account.linkedAt },
    data: {
      // The run reached the end of the list. Failing titles are retried by later runs (they are
      // not up to date) but do not hold this back.
      ...(!partial && { lastSyncedAt: startedAt }),
      ...(library.handle && { handle: library.handle }),
    },
  });
  return {
    status: "ok",
    newUnlocks,
    levelBefore,
    levelAfter: await currentLevel(userId),
    partial,
    titles: { read: library.titles.length + library.failures.length, upToDate: library.upToDate },
    recordedTitles: [...resolved.map((r) => r.title.externalId), ...library.empty.map((e) => e.externalId)],
    failedTitles: library.failures.map((f) => f.externalId),
  };
}

export type StaleSyncOptions = {
  limit?: number;
  /** Stop starting new work after this long (one serverless invocation). */
  budgetMs?: number;
  /** Narrows the candidates (tests). */
  where?: Prisma.LinkedAccountWhereInput;
  now?: () => number;
};

/**
 * Cron job: syncs at most `limit` active PSN/Xbox/RA connections, stalest attempt first (never
 * attempted first, so failing accounts cannot starve the batch), incrementally, and stops
 * starting accounts or titles once `budgetMs` is spent. Platforms that cannot be read (no
 * credential in production, see lib/integrations/availability.ts) are left out.
 */
export async function syncStalePlatformAccounts({
  limit = 5,
  budgetMs = 50_000,
  where = {},
  now = Date.now,
}: StaleSyncOptions = {}): Promise<{ processed: number; failed: number }> {
  const deadline = now() + budgetMs;
  // Accounts the first-import worker is importing right now are its own (no parallel syncs).
  const busy = busyPairs(await busyImports(now())).filter((b) => b.platform !== "steam");
  const accounts = await prisma.linkedAccount.findMany({
    where: {
      AND: [
        { platform: { in: CODE_PLATFORMS.filter(platformAvailable) }, linkedAt: { not: null } },
        ...(busy.length > 0 ? [{ NOT: { OR: busy } }] : []),
        where,
      ],
    },
    orderBy: { lastSyncAttemptAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { userId: true, platform: true },
  });
  let processed = 0;
  let failed = 0;
  for (const { userId, platform } of accounts) {
    if (now() >= deadline) break;
    try {
      await syncPlatformAccount(userId, platform as CodePlatform, { deadline });
      processed++;
    } catch (error) {
      failed++;
      console.error(`Cron: could not sync ${platform} account of user ${userId}`, error);
    }
  }
  return { processed, failed };
}
