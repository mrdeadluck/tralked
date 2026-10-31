import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findBursts, isSpeedPlatinum } from "@/lib/engine/fraud";
import { platformAvailable } from "@/lib/integrations/availability";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { platinumBonus } from "@/lib/engine/xp";
import { platinumSourceKey, recomputeUser } from "@/lib/progression/recompute";
import { loadNameIndex, resolvePlatformGame, type NameIndex } from "./platform-games";
import {
  CODE_PLATFORMS,
  readLibrary,
  type CodePlatform,
  type LibraryAchievement,
  type LibraryTitle,
  type PlaytimeTitle,
  type StoredProgress,
} from "./platform-library";
import { settlePlaytime } from "./playtime";

export type SyncPlatformResult = {
  /** `unlinked`: no active connection on that platform (never linked, unlinked or a pending claim). */
  status: "ok" | "private" | "unlinked";
  newUnlocks: number;
  levelBefore: number;
  levelAfter: number;
  /** Titles were left for the next run (time or title budget); the account is not marked synced. */
  partial: boolean;
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
};

const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

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
type KnownUnlock = { unlockedAt: Date; suspicious: boolean; hardcore: boolean; fraudReview: string | null };

const xpOf = (platform: CodePlatform, a: LibraryAchievement, hardcore: boolean) =>
  xpForPlatformAchievement({
    platform,
    globalPct: a.globalPct,
    points: a.points,
    trophyTier: a.trophyTier,
    hardcore,
  });

/**
 * Records one platform title in a single transaction: the platform's Achievement rows, the
 * UserGame of that platform, UserAchievement (with the anti-fraud verdict and the hardcore flag)
 * and ledger entries (`platform` set) for valid unlocks plus the completion bonus. Every insert
 * is idempotent and XP already in the ledger is never rewritten. A stored unlock date is never
 * rewritten either: an undated unlock keeps the time it was first seen (`seenAt`). Throws
 * AccountChangedError (writing nothing) when the account is no longer linked.
 * Returns how many unlocks were new.
 */
async function recordTitle(
  account: AccountSnapshot,
  gameId: string,
  title: LibraryTitle,
  known: Map<string, KnownUnlock>,
  bursts: Set<string>,
  seenAt: Date,
): Promise<number> {
  const { userId, platform } = account;
  const game = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
    select: { timeToBeatCompleteMin: true, skills: { select: { skill: true } } },
  });
  const gameSkills = game.skills.map((s) => s.skill);
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
    const existing = await tx.achievement.findMany({ where: { gameId, platform } });
    const byApiName = new Map(existing.map((r) => [r.apiName, r]));
    await tx.achievement.createMany({
      data: title.achievements
        .filter((a) => !byApiName.has(a.apiName))
        .map((a) => ({ gameId, platform, apiName: a.apiName, ...fields(a) })),
      skipDuplicates: true,
    });
    for (const a of title.achievements) {
      const row = byApiName.get(a.apiName);
      if (!row) continue;
      const next = fields(a);
      const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== row[k]);
      if (changed) await tx.achievement.update({ where: { id: row.id }, data: next });
    }
    const rows = await tx.achievement.findMany({
      where: { gameId, platform },
      select: { id: true, apiName: true },
    });
    const idOf = new Map(rows.map((r) => [r.apiName, r.id]));

    const unlocked = title.achievements.flatMap((a) => {
      const achievementId = idOf.get(a.apiName);
      if (!achievementId || !a.unlocked) return [];
      const unlockedAt = known.get(achievementId)?.unlockedAt ?? a.unlockedAt ?? seenAt;
      return [{ a, achievementId, unlockedAt }];
    });
    const complete = unlocked.length > 0 && unlocked.length >= title.achievements.length;
    const playtimeKnown = title.playtimeMin !== null && title.playtimeMin > 0;
    const speedRun =
      complete && playtimeKnown && isSpeedPlatinum(title.playtimeMin ?? 0, game.timeToBeatCompleteMin);

    const verdicts = unlocked.map((u) => {
      const before = known.get(u.achievementId);
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

    const playtimeMin = title.playtimeMin ?? 0;
    // RetroAchievements reports play time with each title: reading the title is reading it (even
    // when RA has none), so the row stops being re-read for it. PSN/Xbox play time comes from their
    // played-games lists (recordPlaytime).
    const playtimeFields = platform === "retro" ? { playtimeUpdatedAt: seenAt } : {};
    await tx.userGame.upsert({
      where: { userId_gameId_platform: { userId, gameId, platform } },
      create: { userId, gameId, platform, playtimeMin, unlockedCount: unlocked.length, completedAt, ...playtimeFields },
      update: {
        // Platforms without playtime keep whatever was recorded before.
        ...(title.playtimeMin !== null && { playtimeMin }),
        unlockedCount: unlocked.length,
        completedAt,
        ...playtimeFields,
      },
    });

    const created = await tx.userAchievement.createMany({
      data: verdicts
        .filter((v) => !known.has(v.achievementId))
        .map((v) => ({
          userId,
          achievementId: v.achievementId,
          unlockedAt: v.unlockedAt,
          suspicious: v.suspicious,
          hardcore: v.hardcore,
        })),
      skipDuplicates: true,
    });
    for (const v of verdicts) {
      const before = known.get(v.achievementId);
      if (before && (before.suspicious !== v.suspicious || before.hardcore !== v.hardcore)) {
        await tx.userAchievement.update({
          where: { userId_achievementId: { userId, achievementId: v.achievementId } },
          data: { suspicious: v.suspicious, hardcore: v.hardcore },
        });
      }
    }

    const ledger = verdicts
      .filter((v) => !v.suspicious)
      .map((v) => ({
        userId,
        source: "achievement",
        sourceKey: v.achievementId,
        platform,
        xp: xpOf(platform, v.a, v.hardcore),
        skills: gameSkills,
        createdAt: v.unlockedAt,
      }));
    if (validComplete && completedAt) {
      ledger.push({
        userId,
        source: "platinum",
        sourceKey: platinumSourceKey(platform, gameId),
        platform,
        xp: platinumBonus(title.achievements.map((a) => xpOf(platform, a, false))),
        skills: gameSkills,
        createdAt: completedAt,
      });
    }
    // Hours milestones (RetroAchievements play time comes with the title) are paid by
    // settlePlaytime at the end of the sync, within the per-user caps.
    await tx.xpLedgerEntry.createMany({ data: ledger, skipDuplicates: true });
    return created.count;
  }, TRANSACTION_OPTIONS);
}

/**
 * Records the play time of a platform's played-games list (PSN, Xbox): each title is mapped to its
 * catalog game without asking IGDB (a play-time-only title is matched by its platform link or
 * name, or created bare; the trophy sync and the catalog jobs fill in metadata), versions of one
 * game (PS4 and PS5) add up, and the platform's UserGame row gets the play time and last play
 * (created when the game has no trophies yet). Then, for every platform (RetroAchievements too,
 * whose play time came with its titles), the hours milestones due are paid within the per-user
 * caps (settlePlaytime). One transaction guarded like the titles'. Stops taking titles at
 * `deadline` (returns true: partial, the next run continues; the list is read whole every time).
 */
async function recordPlaytime(
  account: AccountSnapshot,
  titles: PlaytimeTitle[],
  names: NameIndex,
  now: Date,
  deadline?: number,
  clock: () => number = Date.now,
): Promise<boolean> {
  const { userId, platform } = account;
  const perGame = new Map<string, { playtimeMin: number; lastPlayedAt: Date | null }>();
  let partial = false;
  for (const title of titles) {
    if (!Number.isFinite(title.playtimeMin) || title.playtimeMin <= 0) continue;
    if (deadline !== undefined && clock() >= deadline) {
      partial = true;
      break;
    }
    const gameId = await resolvePlatformGame(platform, title, names, { igdb: false });
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
  return partial;
}

/**
 * SyncCursor key of the titles whose minutes were asked, per platform account and holder (an
 * account claimed by another profile starts from scratch there).
 */
const checkedKey = (platform: CodePlatform, externalId: string, userId: string) =>
  `minutes-checked:${platform}:${externalId}:${userId}`;

async function loadCheckedTitles(
  platform: CodePlatform,
  externalId: string,
  userId: string,
): Promise<Map<string, number>> {
  const row = await prisma.syncCursor.findUnique({ where: { key: checkedKey(platform, externalId, userId) } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  return new Map(
    Object.entries(value).flatMap(([id, ms]) => (typeof ms === "number" && Number.isFinite(ms) ? [[id, ms]] : [])),
  );
}

/** Remembers (merging) the titles asked this run, so 0-minute titles are not asked every sync. */
async function rememberCheckedTitles(
  platform: CodePlatform,
  externalId: string,
  userId: string,
  checked: Map<string, number>,
): Promise<void> {
  if (checked.size === 0) return;
  const merged = await loadCheckedTitles(platform, externalId, userId);
  for (const [id, ms] of checked) merged.set(id, ms);
  const key = checkedKey(platform, externalId, userId);
  const value = Object.fromEntries(merged);
  await prisma.syncCursor.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Per-title progress already in the database, keyed by the platform's title id: the UserGame
 * unlock count (and, for RetroAchievements, the hardcore unlock count). Persistent, so a run
 * cut short by the budget resumes where it stopped.
 */
async function storedProgress(
  userId: string,
  platform: CodePlatform,
): Promise<Map<string, StoredProgress>> {
  const games = await prisma.userGame.findMany({
    where: { userId, platform },
    select: { gameId: true, unlockedCount: true, playtimeUpdatedAt: true, lastPlayedAt: true },
  });
  if (games.length === 0) return new Map();
  const [links, hardcore] = await Promise.all([
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
  ]);
  const hardcoreByGame = new Map<string, number>();
  for (const h of hardcore) {
    hardcoreByGame.set(h.achievement.gameId, (hardcoreByGame.get(h.achievement.gameId) ?? 0) + 1);
  }
  const byGame = new Map(games.map((g) => [g.gameId, g]));
  return new Map(
    links.map((l) => {
      const game = byGame.get(l.gameId);
      return [
        l.externalId,
        {
          unlocked: game?.unlockedCount ?? 0,
          hardcore: hardcoreByGame.get(l.gameId) ?? 0,
          playtimeSynced: game?.playtimeUpdatedAt != null,
          lastPlayedAt: game?.lastPlayedAt ?? null,
        },
      ];
    }),
  );
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

  const library = await readLibrary(
    platform,
    { externalId: account.externalId, handle: account.handle },
    {
      stored: options.full ? undefined : await storedProgress(userId, platform),
      checkedTitles: options.full || platform !== "xbox" ? undefined : await loadCheckedTitles(platform, account.externalId, userId),
      deadline: options.deadline,
      maxTitles: options.maxTitles,
    },
  );
  if (library === "private") return unchanged("private");
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
  const resolved: { gameId: string; title: LibraryTitle }[] = [];
  for (const title of library.titles) {
    resolved.push({ gameId: await resolvePlatformGame(platform, title, names), title });
  }

  // Anti-fraud looks at all of the user's unlocks on this platform together (bursts can span
  // games). Undated unlocks are left out: their first-seen time says nothing about play.
  const known = new Map<string, KnownUnlock>(
    (
      await prisma.userAchievement.findMany({
        where: { userId, achievement: { platform } },
        select: { achievementId: true, unlockedAt: true, suspicious: true, hardcore: true, fraudReview: true },
      })
    ).map((r) => [r.achievementId, r]),
  );
  const ids = await prisma.achievement.findMany({
    where: { platform, gameId: { in: resolved.map((r) => r.gameId) } },
    select: { id: true, gameId: true, apiName: true },
  });
  const idByKey = new Map(ids.map((a) => [`${a.gameId}:${a.apiName}`, a.id]));
  const everyUnlock = new Map(
    [...known].map(([achievementId, k]) => [achievementId, { achievementId, unlockedAt: k.unlockedAt }]),
  );
  for (const { gameId, title } of resolved) {
    for (const a of title.achievements) {
      const id = idByKey.get(`${gameId}:${a.apiName}`);
      // Achievements new to the catalog get their id on record; they join the burst check next sync.
      if (!id || !a.unlocked) continue;
      if (!a.unlockedAt) everyUnlock.delete(id);
      else if (!known.has(id)) everyUnlock.set(id, { achievementId: id, unlockedAt: a.unlockedAt });
    }
  }
  const bursts = findBursts([...everyUnlock.values()]);

  const snapshot: AccountSnapshot = { userId, platform, externalId: account.externalId, linkedAt: account.linkedAt };
  let newUnlocks = 0;
  for (const { gameId, title } of resolved) {
    try {
      newUnlocks += await recordTitle(snapshot, gameId, title, known, bursts, startedAt);
    } catch (error) {
      // Unlinked while this run was reading: stop. Unlink already removed what was recorded and
      // recomputed; nothing more is written for this account.
      if (error instanceof AccountChangedError) return unchanged("unlinked");
      throw error;
    }
  }
  let playtimePartial = false;
  try {
    playtimePartial = await recordPlaytime(snapshot, library.playtime, names, startedAt, options.deadline);
  } catch (error) {
    if (error instanceof AccountChangedError) return unchanged("unlinked");
    throw error;
  }

  // Xbox: titles whose minutes were asked are remembered (even 0 or none), per account.
  if (library.checkedTitles) await rememberCheckedTitles(platform, account.externalId, userId, library.checkedTitles);

  await recomputeUser(userId);
  const partial = library.partial || playtimePartial;
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
  const accounts = await prisma.linkedAccount.findMany({
    where: { AND: [{ platform: { in: CODE_PLATFORMS.filter(platformAvailable) }, linkedAt: { not: null } }, where] },
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
