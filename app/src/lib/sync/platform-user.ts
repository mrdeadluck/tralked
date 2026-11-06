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
   * cut short skips those an earlier pass recorded (`recordedTitles`). With it, a `full`
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

/** Burst-check key of an unlock whose trophy row does not exist yet (created by this run). */
const newKey = (externalId: string, apiName: string) => `new:${externalId}:${apiName}`;

/** What is stored about an unlock: its verdict (admin release included) is kept by a resync. */
type KnownUnlock = {
  achievementId: string;
  /** Never null for these platforms (they date every unlock); the column allows it for Steam. */
  unlockedAt: Date | null;
  suspicious: boolean;
  hardcore: boolean;
  fraudReview: string | null;
  fraudReviewedAt: Date | null;
};

/** The user's unlocks on one platform, as stored when the sync started, by listKey. */
type KnownUnlocks = Map<string, KnownUnlock>;

/** A trophy of one list: Achievement is unique by (listId, apiName). */
const listKey = (listId: string, apiName: string) => `${listId}:${apiName}`;

/**
 * Records one platform title (one trophy list) in a single transaction: its TrophyList, the list's
 * Achievement rows, UserAchievement (with the anti-fraud verdict and the hardcore flag), the
 * user's UserTrophyList of the list and the UserGame of the game on that platform (every list's
 * unlocks; completed when its first list was), then settles the game's XP by version
 * (settleListXp). Every insert is idempotent and XP already in the ledger is never rewritten. A
 * stored unlock date is never rewritten either: an undated unlock keeps the time it was first
 * seen (`seenAt`). Throws AccountChangedError (writing nothing) when the account is no longer
 * linked.
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
      const before = known.get(listKey(list.id, a.apiName));
      const unlockedAt = before?.unlockedAt ?? a.unlockedAt ?? seenAt;
      return [{ a, achievementId, unlockedAt, before }];
    });
    const complete = unlocked.length > 0 && unlocked.length >= title.achievements.length;
    const playtimeKnown = title.playtimeMin !== null && title.playtimeMin > 0;
    const speedRun =
      complete && playtimeKnown && isSpeedPlatinum(title.playtimeMin ?? 0, game.timeToBeatCompleteMin);

    const verdicts = unlocked.map((u) => ({
      ...u,
      // An unlock already stored keeps its stored verdict (suspicious stays suspicious, an
      // admin-released one stays clean): only unlocks seen for the first time are judged by the
      // burst and speed rules, so a resync never flags old bursts (save transfers, sibling lists).
      suspicious: u.before
        ? u.before.suspicious
        : bursts.has(u.achievementId) || bursts.has(newKey(title.externalId, u.a.apiName)) || speedRun,
      // A softcore unlock later redone in hardcore is upgraded, never downgraded.
      hardcore: u.a.hardcore || (u.before?.hardcore ?? false),
    }));
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

    // The game on that platform: every list's unlocks, completed when its first list was.
    const unlockedCount = await tx.userAchievement.count({
      where: { userId, achievement: { gameId: listGameId, platform } },
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

    // XP of the game's trophies and completions, by list (every regional list pays). Hours milestones
    // (RetroAchievements play time comes with the title) are paid by settlePlaytime at the end of
    // the sync, within the per-user caps.
    await settleListXp(tx, userId, platform, [listGameId], seenAt);
    return created.count;
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
 * Version of the remembered "read, no achievements" entries, per platform. Bump a platform's to make
 * its entries stale (the titles are read again). Xbox 2: Xbox 360 titles are read on their own
 * routes (before, the player route answered them empty, and they were remembered so).
 */
export const EMPTY_TITLES_VERSION: Record<CodePlatform, number> = { psn: 1, xbox: 2, retro: 1 };

/**
 * An Xbox 360 title whose read failed is tried again only this long after the failure: each try is
 * two requests on OpenXBL's quota (150 an hour, shared with every sync), and a title whose routes
 * disagree would otherwise spend them on every sync.
 */
export const X360_RETRY_MS = 24 * 3_600_000;

/**
 * SyncCursor of a connection's title memory (see rememberTitles): the listed counts of the titles
 * recorded, the empty titles (per platform version) and the failed Xbox 360 titles waiting
 * (X360_RETRY_MS).
 */
export const titleMemoryKey = (accountId: string) => `platform-titles:${accountId}`;

type TitleMemory = {
  /** Listed counts per title (recorded titles, and empty ones at the platform's current version). */
  counts: Map<string, RememberedCounts>;
  /** Titles whose read failed and waits (Xbox 360, see X360_RETRY_MS) → when it failed (ms). */
  failed: Map<string, number>;
};

/**
 * What is remembered for this connection's titles: nothing for another account or link on the
 * same row (a relink starts over).
 */
async function rememberedTitles(account: AccountSnapshot, accountId: string): Promise<TitleMemory> {
  const row = await prisma.syncCursor.findUnique({ where: { key: titleMemoryKey(accountId) } });
  const value = row?.value as { externalId?: unknown; linkedAt?: unknown; titles?: unknown; empty?: unknown; failed?: unknown } | undefined;
  if (
    !value ||
    value.externalId !== account.externalId ||
    value.linkedAt !== account.linkedAt.toISOString() ||
    !value.titles ||
    typeof value.titles !== "object"
  ) {
    return { counts: new Map(), failed: new Map() };
  }
  const fromCounts = (id: string, counts: unknown): [string, RememberedCounts][] =>
    Array.isArray(counts) && typeof counts[0] === "number"
      ? [[id, { unlocked: counts[0], ...(typeof counts[1] === "number" && { hardcore: counts[1] }) }]]
      : [];
  const objectOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  // Empty titles (read, no achievements) count only at the platform's current version; recorded titles win.
  const version = EMPTY_TITLES_VERSION[account.platform];
  const empty = Object.entries(objectOf(value.empty)).flatMap(([id, entry]) => {
    const e = entry as { c?: unknown; v?: unknown } | null;
    return e && e.v === version ? fromCounts(id, e.c) : [];
  });
  return {
    counts: new Map([...empty, ...Object.entries(value.titles as Record<string, unknown>).flatMap(([id, counts]) => fromCounts(id, counts))]),
    failed: new Map(
      Object.entries(objectOf(value.failed)).flatMap(([id, ms]) => (typeof ms === "number" && Number.isFinite(ms) ? [[id, ms] as const] : [])),
    ),
  };
}

/**
 * Remembers (merging) the counts the platform listed for each title recorded this run: the title
 * list and the trophy list can disagree (an Xbox unlock the achievement list does not show, RA's
 * sticky hardcore flags), and without this such a title was read again on every sync. Also the
 * titles read empty (`empties`, at the platform's EMPTY_TITLES_VERSION), so they are not read
 * again until their counts change, and when each `failed` title failed (`failedAt`, the Xbox 360
 * backoff), forgetting that of the titles read this run.
 * Guarded like the titles: nothing is written on a connection unlinked (or replaced) meanwhile.
 */
async function rememberTitles(
  account: AccountSnapshot,
  accountId: string,
  titles: readonly { externalId: string; listed?: RememberedCounts }[],
  empties: readonly { externalId: string; listed: RememberedCounts }[] = [],
  failed: readonly string[] = [],
  failedAt = Date.now(),
): Promise<void> {
  const counts = titles.flatMap((t) => (t.listed ? [[t.externalId, t.listed] as const] : []));
  if (counts.length === 0 && empties.length === 0 && failed.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const linked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LinkedAccount"
      WHERE id = ${accountId} AND "externalId" = ${account.externalId} AND "linkedAt" = ${account.linkedAt}
      FOR UPDATE`;
    if (linked.length === 0) return;
    const key = titleMemoryKey(accountId);
    const row = await tx.syncCursor.findUnique({ where: { key } });
    const before = row?.value as
      | {
          externalId?: unknown;
          linkedAt?: unknown;
          titles?: Record<string, unknown>;
          empty?: Record<string, unknown>;
          failed?: Record<string, unknown>;
        }
      | undefined;
    const same = before?.externalId === account.externalId && before?.linkedAt === account.linkedAt.toISOString();
    type JsonRecord = Prisma.InputJsonObject & Record<string, Prisma.InputJsonValue>;
    const merged = { ...(same && before?.titles ? before.titles : {}) } as JsonRecord;
    for (const [id, c] of counts) merged[id] = c.hardcore === undefined ? [c.unlocked] : [c.unlocked, c.hardcore];
    // Empty titles live apart, tagged with the version they were remembered under.
    const mergedEmpty = { ...(same && before?.empty ? before.empty : {}) } as JsonRecord;
    for (const [id] of counts) delete mergedEmpty[id];
    const version = EMPTY_TITLES_VERSION[account.platform];
    for (const e of empties) {
      mergedEmpty[e.externalId] = { c: e.listed.hardcore === undefined ? [e.listed.unlocked] : [e.listed.unlocked, e.listed.hardcore], v: version };
    }
    const mergedFailed = { ...(same && before?.failed ? before.failed : {}) } as JsonRecord;
    for (const id of [...counts.map(([id]) => id), ...empties.map((e) => e.externalId)]) delete mergedFailed[id];
    for (const id of failed) mergedFailed[id] = failedAt;
    const value = { externalId: account.externalId, linkedAt: account.linkedAt.toISOString(), titles: merged, empty: mergedEmpty, failed: mergedFailed };
    await tx.syncCursor.upsert({ where: { key }, create: { key, value }, update: { value } });
  }, TRANSACTION_OPTIONS);
}

/**
 * Per-title progress already in the database, keyed by the platform's title id: the counts of the
 * user's UserTrophyList of that list, with the listed counts remembered for it (see
 * StoredProgress.listed). A title without one carries no counts of its own (the game's UserGame
 * count is no list's progress): a list of a game with per-list progress gets no entry (read once:
 * reading it records its row); any other linked title of a game the user has on that platform
 * gets only its remembered counts and the game's play time (what the Xbox minutes and the
 * RetroAchievements play time are checked against), and the titles read empty their remembered
 * counts. Persistent, so a run cut short by the budget resumes where it stopped.
 */
async function storedProgress(
  userId: string,
  platform: CodePlatform,
  remembered: Map<string, RememberedCounts> = new Map(),
): Promise<Map<string, StoredProgress>> {
  const [games, lists] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId, platform },
      select: { gameId: true, playtimeUpdatedAt: true, lastPlayedAt: true },
    }),
    prisma.userTrophyList.findMany({
      where: { userId, list: { platform } },
      select: { unlockedCount: true, hardcoreCount: true, list: { select: { id: true, externalId: true, gameId: true } } },
    }),
  ]);
  if (games.length === 0 && lists.length === 0 && remembered.size === 0) return new Map();
  // A game with per-list progress counts by list only: a list of it without progress yet has no
  // entry and is read (once: reading it records its row).
  const onLists = new Set(lists.map((p) => p.list.gameId));
  const links = await prisma.gamePlatformLink.findMany({
    where: { platform, gameId: { in: games.map((g) => g.gameId) } },
    select: { gameId: true, externalId: true },
  });
  const byGame = new Map(games.map((g) => [g.gameId, g]));
  const stored = new Map<string, StoredProgress>(
    links
      .filter((l) => !onLists.has(l.gameId))
      .map((l) => {
        const game = byGame.get(l.gameId);
        return [
          l.externalId,
          {
            // No list progress: never equal to a listed count (titles are listed with unlocks).
            unlocked: -1,
            hardcore: -1,
            listed: remembered.get(l.externalId),
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
      const counts = definitions.get(t.listId) ?? tierCounts([]);
      if (t.trophyTier && t.trophyTier in counts) counts[t.trophyTier as keyof TierCounts] += t._count._all;
      definitions.set(t.listId, counts);
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
  const memory = await rememberedTitles(snapshot, account.id);
  // Xbox 360 titles that failed less than X360_RETRY_MS ago wait (even on a full resync).
  const waiting = [...memory.failed].filter(([, at]) => startedAt.getTime() - at < X360_RETRY_MS).map(([id]) => id);
  const skip = waiting.length > 0 ? new Set([...(options.skipTitles ?? []), ...waiting]) : options.skipTitles;
  const library = await readLibrary(
    platform,
    { externalId: account.externalId, handle: account.handle },
    {
      stored: options.full ? undefined : await storedProgress(userId, platform, memory.counts),
      // A resync in passes (skipTitles) keeps the titles whose minutes were asked: over 250 titles
      // (MAX_MINUTES_TITLES a run), a plain full read would leave every pass partial.
      checkedTitles:
        platform !== "xbox" || (options.full && !options.skipTitles) ? undefined : checkedTitlesOf(account.minutesChecked),
      linkedAccountId: platform === "psn" ? account.id : undefined,
      deadline: readDeadline,
      maxTitles: options.maxTitles,
      skip,
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
  const backoff = library.failures.filter((f) => f.backoff).map((f) => f.externalId);
  // Nothing readable at all (every title failed, none up to date): an outage, not a bad title. The
  // failed 360 titles still wait, so an account with nothing else does not spend the quota every run.
  if (library.titles.length === 0 && library.upToDate === 0 && library.failures.length > 0) {
    await rememberTitles(snapshot, account.id, [], [], backoff, startedAt.getTime());
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
  const known: KnownUnlocks = new Map(
    unlockRows.map(({ achievement: a, ...unlock }) => [listKey(a.listId, a.apiName), unlock]),
  );
  const lists = await prisma.trophyList.findMany({
    where: { platform, externalId: { in: resolved.map((r) => r.title.externalId) } },
    select: { id: true, externalId: true, gameId: true },
  });
  const listIdOf = new Map(lists.map((l) => [l.externalId, l.id]));
  const listGameOf = new Map(lists.map((l) => [l.externalId, l.gameId]));
  const ids = await prisma.achievement.findMany({
    where: { listId: { in: lists.map((l) => l.id) } },
    select: { id: true, listId: true, apiName: true },
  });
  const idByKey = new Map(ids.map((a) => [listKey(a.listId, a.apiName), a.id]));
  const everyUnlock = new Map<string, { achievementId: string; unlockedAt: Date; gameId: string; apiName: string }>();
  for (const { achievement: a, achievementId, unlockedAt } of unlockRows) {
    if (unlockedAt) everyUnlock.set(listKey(a.listId, a.apiName), { achievementId, unlockedAt, gameId: a.gameId, apiName: a.apiName });
  }
  for (const { title, gameId: resolvedGameId } of resolved) {
    const listId = listIdOf.get(title.externalId);
    const gameId = listGameOf.get(title.externalId) ?? resolvedGameId;
    for (const a of title.achievements) {
      if (!a.unlocked) continue;
      const key = listId ? listKey(listId, a.apiName) : undefined;
      const id = key ? idByKey.get(key) : undefined;
      if (!key || !id) {
        // A list or trophy new to the catalog has no row yet: its dated unlocks join the burst
        // check under a synthetic key, since recordTitle judges them (only) this run.
        if (a.unlockedAt) everyUnlock.set(newKey(title.externalId, a.apiName), { achievementId: newKey(title.externalId, a.apiName), unlockedAt: a.unlockedAt, gameId, apiName: a.apiName });
        continue;
      }
      if (!a.unlockedAt) everyUnlock.delete(key);
      else if (!known.has(key)) everyUnlock.set(key, { achievementId: id, unlockedAt: a.unlockedAt, gameId, apiName: a.apiName });
    }
  }
  // One trophy counts once however many sibling lists of the game hold it (cross-buy, cross-gen
  // copies earned at the same second): the density is of distinct trophies. Every key of a group
  // is in the burst when its kept twin is.
  const groups = new Map<string, typeof everyUnlock extends Map<string, infer V> ? V[] : never>();
  for (const u of everyUnlock.values()) {
    const group = `${u.gameId}:${u.apiName}:${Math.floor(u.unlockedAt.getTime() / 1000)}`;
    groups.set(group, [...(groups.get(group) ?? []), u]);
  }
  const burstOfKept = findBursts([...groups.values()].map((g) => g[0]));
  const bursts = new Set<string>();
  for (const g of groups.values()) {
    if (burstOfKept.has(g[0].achievementId)) for (const u of g) bursts.add(u.achievementId);
  }

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
  await rememberTitles(snapshot, account.id, resolved.map((r) => r.title), library.empty, backoff, startedAt.getTime());
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
