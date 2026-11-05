import { prisma } from "@/lib/db";
import { rebuildListXp } from "@/lib/progression/list-xp";
import { RECENT_ATTEMPT_MS } from "@/lib/sync/first-import";
import { importKey, releaseImportKeys, renewImportKeys, reserveImportKeys } from "@/lib/sync/import-lease";
import { syncPlatformAccount } from "@/lib/sync/platform-user";
import { describeError } from "@/lib/worker/errors";
import { canonicalList } from "./lists";
import { userNumbers, type UserNumbers } from "./numbers";

/*
 * Phase (a) of the trophy lists, last step (scripts/trophy-lists-finish.ts), after the backfill
 * (backfill.ts) left multi-list PSN/Xbox games with empty lists and their old list-less rows:
 * 1. every active PSN and Xbox account is read again in full (`full: true`), holding the import
 *    lease so the cron and the import worker leave it alone; a pass cut short continues in the
 *    next one (the lists already recorded are skipped), up to `maxPasses`;
 * 2. guide notes on list-less rows of those games move to the row of the same apiName in the
 *    game's canonical list (the next oldest list that has the apiName when it does not);
 * 3. the list-less rows are deleted (their unlocks cascade): only when every account holding
 *    unlocks on them finished its resync complete and read every list of that game;
 * 4. the XP of every user is rebuilt from the lists (rebuildListXp; Steam is not touched);
 * 5. per-user numbers before and after.
 */

export type FinishPlatform = "psn" | "xbox";
const PLATFORMS: readonly FinishPlatform[] = ["psn", "xbox"];

/** Time limit of one resync pass of one account. */
export const PASS_BUDGET_MS = 30 * 60_000;
export const MAX_PASSES = 10;
/** The lease is renewed this often (it lasts IMPORT_WORKER_LEASE_MS, 15 min). */
const LEASE_RENEW_MS = 4 * 60_000;
/** Failure id of the played-games list (play time and concepts), not a trophy list. */
const PLAYED_GAMES = "played-games";

export type FinishOptions = {
  /** No resync and no writes: reports what would move and be deleted, and the current numbers. */
  dryRun?: boolean;
  /** Only these users are resynced and rebuilt (default: every user). */
  users?: string[];
  /** Only these games are cleaned up (tests; default: every PSN/Xbox game with lists and list-less rows). */
  gameIds?: string[];
  /**
   * Platforms whose accounts are resynced (default both). A platform left out (no credential
   * here) is not read: its list-less rows with unlocks stay.
   */
  platforms?: readonly FinishPlatform[];
  passBudgetMs?: number;
  maxPasses?: number;
  /** Titles read per pass at most (tests). */
  maxTitlesPerPass?: number;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * `done`: the last pass reached the end of the list (some titles may still have failed, see
 * failedTitles); `partial`: still cut short after the last pass; `busy`: the import worker (or
 * another job) holds the account; `failed`: the sync threw; `private`/`unlinked`: as the sync says.
 */
export type AccountOutcome = "done" | "partial" | "busy" | "failed" | "private" | "unlinked";

export type AccountResync = {
  userId: string;
  handle: string;
  platform: FinishPlatform;
  outcome: AccountOutcome;
  passes: number;
  newUnlocks: number;
  /** Titles still unread after the last pass (`played-games`: the play time list). */
  failedTitles: string[];
  error?: string;
};

export type CollapsedGame = {
  gameId: string;
  slug: string;
  platform: FinishPlatform;
  /** List-less Achievement rows. */
  rows: number;
  /** Unlocks on those rows. */
  unlocks: number;
  /** Handles of the users holding those unlocks. */
  holders: string[];
  /** Guide notes on those rows. */
  notes: number;
  action: "deleted" | "kept" | "would-delete";
  reason?: string;
};

export type FinishReport = {
  dryRun: boolean;
  accounts: AccountResync[];
  games: CollapsedGame[];
  /** `kept: <game slug> <platform> <reason>` for every game whose list-less rows stay. */
  kept: string[];
  /**
   * moved: notes now on their list row; replacedByExisting: the guide had a note on that row
   * already (kept, the old one deleted); withoutTarget: no list row of that apiName (the game's
   * rows are kept; in a dry run, before the resync writes the lists' rows).
   */
  notes: { moved: number; replacedByExisting: number; withoutTarget: number };
  deleted: { achievements: number; unlocks: number };
  rebuilt: { userId: string; handle: string; paid: number; voided: number }[];
  before: UserNumbers[];
  after: UserNumbers[];
};

type Account = { userId: string; handle: string; platform: FinishPlatform; lastSyncAttemptAt: Date | null };

export async function finishTrophyLists(options: FinishOptions = {}): Promise<FinishReport> {
  const {
    dryRun = false,
    platforms = PLATFORMS,
    passBudgetMs = PASS_BUDGET_MS,
    maxPasses = MAX_PASSES,
    log = () => {},
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;
  const userIds = options.users ?? (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);
  const handles = new Map(
    (await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, handle: true } })).map((u) => [u.id, u.handle]),
  );
  const before = await userNumbers(userIds);
  const report: FinishReport = {
    dryRun,
    accounts: [],
    games: [],
    kept: [],
    notes: { moved: 0, replacedByExisting: 0, withoutTarget: 0 },
    deleted: { achievements: 0, unlocks: 0 },
    rebuilt: [],
    before,
    after: before,
  };

  const accounts: Account[] = (
    await prisma.linkedAccount.findMany({
      where: { platform: { in: [...platforms] }, linkedAt: { not: null }, userId: { in: userIds } },
      select: { userId: true, platform: true, lastSyncAttemptAt: true },
    })
  )
    .map((a) => ({ ...a, platform: a.platform as FinishPlatform, handle: handles.get(a.userId) ?? a.userId }))
    .sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform) || a.handle.localeCompare(b.handle));

  if (dryRun) {
    report.games = await cleanUp(report, { dryRun, gameIds: options.gameIds, handles, platforms, resyncs: new Map(), log });
    return report;
  }

  // The accounts are reserved for the whole run (resync, cleanup, rebuild): the cron and the
  // import worker leave them alone until the end.
  const keys = accounts.map((a) => importKey(a.platform, a.userId));
  const { taken, held } = await reserveImportKeys(keys, now());
  const heldKeys = new Set(held);
  let renewing = Promise.resolve();
  const renew = setInterval(() => {
    renewing = renewing.then(() => renewImportKeys(taken, now())).catch((error) => log(`Could not renew the import lease: ${describeError(error)}`));
  }, LEASE_RENEW_MS);
  renew.unref?.();
  try {
    const resyncs = new Map<string, AccountResync>();
    for (const account of accounts) {
      const key = importKey(account.platform, account.userId);
      const result = heldKeys.has(key)
        ? busy(account)
        : await resync(account, { passBudgetMs, maxPasses, maxTitles: options.maxTitlesPerPass, log, now, sleep });
      resyncs.set(key, result);
      report.accounts.push(result);
      log(
        `${account.platform} ${account.handle}: ${result.outcome} after ${result.passes} pass(es), ${result.newUnlocks} new unlocks` +
          (result.failedTitles.length ? `, unread: ${result.failedTitles.join(", ")}` : "") +
          (result.error ? ` (${result.error})` : ""),
      );
    }

    report.games = await cleanUp(report, { dryRun, gameIds: options.gameIds, handles, platforms, resyncs, log });

    for (const userId of userIds) {
      const r = await rebuildListXp(userId, new Date(now()));
      report.rebuilt.push({ userId, handle: handles.get(userId) ?? userId, ...r });
      log(`XP of ${handles.get(userId)}: ${r.paid} entries paid, ${r.voided} voided`);
    }
  } finally {
    clearInterval(renew);
    await renewing;
    if (taken.length > 0) await releaseImportKeys(taken, now()).catch((error) => log(`Could not release the import lease: ${describeError(error)}`));
  }
  report.after = await userNumbers(userIds);
  return report;
}

const busy = (account: Account): AccountResync => ({
  userId: account.userId,
  handle: account.handle,
  platform: account.platform,
  outcome: "busy",
  passes: 0,
  newUnlocks: 0,
  failedTitles: [],
  error: "the import worker holds the account",
});

/**
 * Full resync of one account in passes: each pass skips the titles earlier passes recorded, so a
 * pass cut short by its budget continues where it stopped. Titles that failed get one more pass.
 */
async function resync(
  account: Account,
  opts: {
    passBudgetMs: number;
    maxPasses: number;
    maxTitles?: number;
    log: (message: string) => void;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<AccountResync> {
  const out: AccountResync = {
    userId: account.userId,
    handle: account.handle,
    platform: account.platform,
    outcome: "partial",
    passes: 0,
    newUnlocks: 0,
    failedTitles: [],
  };
  // A cron run that started on this account before the reservation may still be writing: its
  // attempt is recent. Wait it out, as the import worker does.
  const attempt = account.lastSyncAttemptAt?.getTime();
  if (attempt !== undefined && opts.now() - attempt < RECENT_ATTEMPT_MS) {
    const wait = attempt + RECENT_ATTEMPT_MS - opts.now();
    opts.log(`${account.platform} ${account.handle}: synced moments ago, waiting ${Math.ceil(wait / 1000)} s`);
    await opts.sleep(wait);
  }
  const recorded = new Set<string>();
  const failed = new Set<string>();
  let retriedFailures = false;
  try {
    while (out.passes < opts.maxPasses) {
      out.passes++;
      const r = await syncPlatformAccount(account.userId, account.platform, {
        full: true,
        deadline: opts.now() + opts.passBudgetMs,
        maxTitles: opts.maxTitles,
        skipTitles: recorded,
      });
      if (r.status !== "ok") {
        out.outcome = r.status;
        break;
      }
      out.newUnlocks += r.newUnlocks;
      for (const id of r.recordedTitles ?? []) {
        recorded.add(id);
        failed.delete(id);
      }
      failed.delete(PLAYED_GAMES);
      for (const id of r.failedTitles ?? []) failed.add(id);
      opts.log(
        `${account.platform} ${account.handle}: pass ${out.passes} read ${r.titles?.read ?? 0} titles` +
          `${r.partial ? " (cut short)" : ""}${r.failedTitles?.length ? `, ${r.failedTitles.length} failed` : ""}`,
      );
      if (r.partial) continue;
      out.outcome = "done";
      // Failed titles (an outage of a moment) are tried once more.
      if (failed.size > 0 && !retriedFailures && out.passes < opts.maxPasses) {
        retriedFailures = true;
        continue;
      }
      break;
    }
  } catch (error) {
    out.outcome = "failed";
    out.error = describeError(error);
  }
  out.failedTitles = [...failed].sort();
  return out;
}

const RESYNC_REASON: Record<Exclude<AccountOutcome, "done">, string> = {
  partial: "resync still partial",
  busy: "account busy (import worker)",
  failed: "resync failed",
  private: "profile private",
  unlinked: "account unlinked",
};

/** One note on a list-less row and where it goes. */
type NotePlan = { id: string; guideId: string; target: string | null };

async function cleanUp(
  report: FinishReport,
  ctx: {
    dryRun: boolean;
    gameIds?: string[];
    handles: Map<string, string>;
    platforms: readonly FinishPlatform[];
    resyncs: Map<string, AccountResync>;
    log: (message: string) => void;
  },
): Promise<CollapsedGame[]> {
  const groups = await prisma.achievement.groupBy({
    by: ["gameId", "platform"],
    where: { listId: null, platform: { in: [...PLATFORMS] }, ...(ctx.gameIds && { gameId: { in: ctx.gameIds } }) },
  });
  if (groups.length === 0) return [];
  const lists = await prisma.trophyList.findMany({
    where: { gameId: { in: [...new Set(groups.map((g) => g.gameId))] }, platform: { in: [...PLATFORMS] } },
    select: { id: true, gameId: true, platform: true, externalId: true, createdAt: true },
  });
  const games: CollapsedGame[] = [];
  for (const { gameId, platform: p } of groups.sort((a, b) => a.gameId.localeCompare(b.gameId) || a.platform.localeCompare(b.platform))) {
    const platform = p as FinishPlatform;
    const own = lists.filter((l) => l.gameId === gameId && l.platform === platform);
    // A game without a list on that platform keeps paying its list-less rows: not a collapsed game.
    if (own.length === 0) continue;
    games.push(await cleanGame(report, ctx, gameId, platform, own));
  }
  return games;
}

async function cleanGame(
  report: FinishReport,
  ctx: Parameters<typeof cleanUp>[1],
  gameId: string,
  platform: FinishPlatform,
  lists: { id: string; externalId: string; createdAt: Date }[],
): Promise<CollapsedGame> {
  const [game, rows, links] = await Promise.all([
    prisma.game.findUniqueOrThrow({ where: { id: gameId }, select: { slug: true } }),
    prisma.achievement.findMany({ where: { gameId, platform, listId: null }, select: { id: true, apiName: true } }),
    prisma.gamePlatformLink.findMany({ where: { gameId, platform }, select: { externalId: true } }),
  ]);
  const rowIds = rows.map((r) => r.id);
  const [unlocks, notes] = await Promise.all([
    prisma.userAchievement.findMany({ where: { achievementId: { in: rowIds } }, select: { userId: true } }),
    prisma.guideAchievementNote.findMany({
      where: { achievementId: { in: rowIds } },
      select: { id: true, guideId: true, achievementId: true },
    }),
  ]);
  const holders = [...new Set(unlocks.map((u) => u.userId))].sort();
  const entry: CollapsedGame = {
    gameId,
    slug: game.slug,
    platform,
    rows: rows.length,
    unlocks: unlocks.length,
    holders: holders.map((id) => ctx.handles.get(id) ?? id),
    notes: notes.length,
    action: "would-delete",
  };

  // Target of a note: the row of the same apiName in the canonical (oldest) list, else in the
  // next oldest list that has it.
  const ordered: typeof lists = [];
  for (let rest = [...lists]; rest.length > 0; ) {
    const next = canonicalList(rest);
    ordered.push(next);
    rest = rest.filter((l) => l !== next);
  }
  const listRows = await prisma.achievement.findMany({
    where: { listId: { in: lists.map((l) => l.id) }, apiName: { in: [...new Set(rows.map((r) => r.apiName))] } },
    select: { id: true, listId: true, apiName: true },
  });
  const apiNameOf = new Map(rows.map((r) => [r.id, r.apiName]));
  const targetOf = (apiName: string) => {
    for (const l of ordered) {
      const row = listRows.find((r) => r.listId === l.id && r.apiName === apiName);
      if (row) return row.id;
    }
    return null;
  };
  const plans: NotePlan[] = notes.map((n) => ({ id: n.id, guideId: n.guideId, target: targetOf(apiNameOf.get(n.achievementId)!) }));
  const withoutTarget = plans.filter((n) => n.target === null).length;

  const keep = (reason: string) => {
    entry.action = "kept";
    entry.reason = reason;
    report.kept.push(`kept: ${game.slug} ${platform} ${reason}`);
    ctx.log(`kept: ${game.slug} ${platform} ${reason}`);
    return entry;
  };

  if (ctx.dryRun) {
    report.notes.withoutTarget += withoutTarget;
    for (const n of plans.filter((x) => x.target !== null)) {
      const taken = await prisma.guideAchievementNote.findUnique({
        where: { guideId_achievementId: { guideId: n.guideId, achievementId: n.target! } },
        select: { id: true },
      });
      if (taken) report.notes.replacedByExisting++;
      else report.notes.moved++;
    }
    return entry;
  }

  // Every holder's account was read again whole, every list of this game included.
  const gameLists = new Set([...lists.map((l) => l.externalId), ...links.map((l) => l.externalId)]);
  for (const userId of holders) {
    const handle = ctx.handles.get(userId) ?? userId;
    const resync = ctx.resyncs.get(importKey(platform, userId));
    if (!resync) {
      return keep(
        ctx.platforms.includes(platform)
          ? `${handle} has no active ${platform} account resynced here`
          : `${platform} was not resynced (no credential)`,
      );
    }
    if (resync.outcome !== "done") return keep(`${handle}: ${RESYNC_REASON[resync.outcome]}`);
    const unread = resync.failedTitles.filter((id) => gameLists.has(id));
    if (unread.length > 0) return keep(`${handle}: could not read ${unread.join(", ")}`);
  }
  if (withoutTarget > 0) return keep(`${withoutTarget} guide note(s) without a list row of the same apiName`);

  const result = await prisma.$transaction(
    async (tx) => {
      let moved = 0;
      let replaced = 0;
      for (const n of plans) {
        const taken = await tx.guideAchievementNote.findUnique({
          where: { guideId_achievementId: { guideId: n.guideId, achievementId: n.target! } },
          select: { id: true },
        });
        if (taken) {
          await tx.guideAchievementNote.delete({ where: { id: n.id } });
          replaced++;
        } else {
          await tx.guideAchievementNote.update({ where: { id: n.id }, data: { achievementId: n.target! } });
          moved++;
        }
      }
      const unlockCount = await tx.userAchievement.count({ where: { achievementId: { in: rowIds } } });
      const deleted = await tx.achievement.deleteMany({ where: { id: { in: rowIds }, listId: null } });
      return { moved, replaced, unlockCount, deleted: deleted.count };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  report.notes.moved += result.moved;
  report.notes.replacedByExisting += result.replaced;
  report.deleted.achievements += result.deleted;
  report.deleted.unlocks += result.unlockCount;
  entry.action = "deleted";
  ctx.log(
    `deleted: ${game.slug} ${platform} ${result.deleted} list-less rows, ${result.unlockCount} unlocks; ` +
      `${result.moved} notes moved, ${result.replaced} replaced by an existing note`,
  );
  return entry;
}
